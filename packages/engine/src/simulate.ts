import { createRng, type Rng } from "./prng.ts";
import { EventQueue, type Scheduled } from "./queue.ts";
import type {
	EngineInput,
	EngineRunResult,
	EventSink,
	FailureReason,
	FaultBehavior,
	Micros,
	RatePhase,
	SimEvent,
} from "./types.ts";

export const ENGINE_VERSION = "0.1.0";

/**
 * Same-time ordering. Lower runs first. This table is part of the reproducibility contract:
 * - Faults change the world before anything observes it.
 * - Probe results are applied before routing decisions at that instant.
 * - A response that lands exactly on the deadline counts as on time (completion before timeout).
 * - Completions free slots before new arrivals look for one.
 */
const PRIORITY = {
	fault: 0,
	probeResult: 1,
	serviceComplete: 2,
	timeout: 3,
	probeSend: 4,
	arrival: 5,
} as const;

type Pending = Scheduled &
	(
		| { type: "fault-down"; fault: number }
		| { type: "fault-up"; fault: number }
		| { type: "probe-result"; server: number; ok: boolean }
		| { type: "service-complete"; server: number; req: number; epoch: number }
		| { type: "timeout"; req: number }
		| { type: "probe-send" }
		| { type: "arrival" }
	);

type PendingInit = Pending extends infer P
	? P extends Pending
		? Omit<P, "seq">
		: never
	: never;

interface ServerState {
	up: boolean;
	/** Incremented on every crash so completions scheduled before the crash are ignored. */
	epoch: number;
	downBehavior: FaultBehavior;
	activeFault: number;
	inService: Set<number>;
	queue: number[];
	queueHead: number;
	rng: Rng;
	/** Load balancer's view of this backend. */
	healthy: boolean;
	consecutiveOk: number;
	consecutiveFail: number;
}

class EventLimitReached extends Error {}

/**
 * Runs one deterministic discrete-event simulation and streams every event into `sink`.
 *
 * Request lifecycle: arrival → routed → (service-start | enqueued → service-start) → service-end,
 * with exactly one terminal outcome (`succeeded` or `failed`) per request. A request whose client
 * deadline passes keeps occupying the backend (servers do not know clients gave up); its eventual
 * response is reported as `late-response` and never counted as a success.
 */
export function simulate(input: EngineInput, sink: EventSink): EngineRunResult {
	const queue = new EventQueue<Pending>();
	let seq = 0;
	const schedule = (item: PendingInit) => {
		queue.push({ ...item, seq: seq++ } as Pending);
	};

	let eventCount = 0;
	let now: Micros = 0;
	const emit = (event: SimEvent) => {
		if (eventCount >= input.maxEvents) throw new EventLimitReached();
		eventCount++;
		sink(event);
	};

	const servers: ServerState[] = input.servers.map((s) => ({
		up: true,
		epoch: 0,
		downBehavior: "refuse",
		activeFault: -1,
		inService: new Set(),
		queue: [],
		queueHead: 0,
		rng: createRng(input.seed, `service:${s.id}`),
		healthy: true,
		consecutiveOk: 0,
		consecutiveFail: 0,
	}));

	// Per-request state, indexed by request id.
	const arrivedAt: Micros[] = [];
	const terminal: boolean[] = [];
	const routedTo: number[] = [];
	let requests = 0;
	let rrPointer = 0;

	const arrivals = createArrivalSource(input.arrival, input.phases, input.seed);

	const finish = (
		req: number,
		t: Micros,
		server: number,
		outcome: { ok: true } | { ok: false; reason: FailureReason },
	) => {
		terminal[req] = true;
		const latencyUs = t - (arrivedAt[req] as number);
		if (outcome.ok) emit({ kind: "succeeded", t, req, server, latencyUs });
		else
			emit({
				kind: "failed",
				t,
				req,
				server,
				reason: outcome.reason,
				latencyUs,
			});
	};

	const serviceTime = (index: number): Micros => {
		const config = input.servers[index];
		const state = servers[index];
		if (!config || !state) throw new Error(`Unknown server index ${index}`);
		if (config.distribution === "fixed") return config.serviceTimeUs;
		return Math.max(1, Math.round(state.rng.exponential(config.serviceTimeUs)));
	};

	const startService = (
		index: number,
		req: number,
		t: Micros,
		queuedUs: Micros,
	) => {
		const state = servers[index] as ServerState;
		state.inService.add(req);
		emit({ kind: "service-start", t, req, server: index, queuedUs });
		schedule({
			type: "service-complete",
			t: t + serviceTime(index),
			priority: PRIORITY.serviceComplete,
			server: index,
			req,
			epoch: state.epoch,
		});
	};

	const pickBackend = (): number => {
		const n = servers.length;
		for (let step = 0; step < n; step++) {
			const index = (rrPointer + step) % n;
			const state = servers[index] as ServerState;
			if (input.healthCheck === null || state.healthy) {
				rrPointer = (index + 1) % n;
				return index;
			}
		}
		return -1;
	};

	const onArrival = (t: Micros) => {
		const req = requests++;
		arrivedAt[req] = t;
		terminal[req] = false;
		routedTo[req] = -1;
		emit({ kind: "arrival", t, req });

		const index = pickBackend();
		if (index === -1) {
			finish(req, t, -1, { ok: false, reason: "no-healthy-backend" });
			return;
		}
		routedTo[req] = index;
		emit({ kind: "routed", t, req, server: index });

		const state = servers[index] as ServerState;
		const config = input.servers[index];
		if (!config) throw new Error(`Unknown server index ${index}`);

		if (!state.up) {
			if (state.downBehavior === "refuse") {
				finish(req, t, index, { ok: false, reason: "backend-refused" });
				return;
			}
			// `hang`: the connection attempt never completes; only the client timeout ends it.
		} else if (state.inService.size < config.capacity) {
			startService(index, req, t, 0);
		} else if (state.queue.length - state.queueHead < config.queueCapacity) {
			state.queue.push(req);
			emit({
				kind: "enqueued",
				t,
				req,
				server: index,
				depth: state.queue.length - state.queueHead,
			});
		} else {
			finish(req, t, index, { ok: false, reason: "queue-full" });
			return;
		}

		schedule({
			type: "timeout",
			t: t + input.timeoutUs,
			priority: PRIORITY.timeout,
			req,
		});
	};

	const onServiceComplete = (
		index: number,
		req: number,
		epoch: number,
		t: Micros,
	) => {
		const state = servers[index] as ServerState;
		// Scheduled before a crash: the work was lost with the process.
		if (epoch !== state.epoch || !state.inService.has(req)) return;

		state.inService.delete(req);
		emit({ kind: "service-end", t, req, server: index });
		if (terminal[req]) emit({ kind: "late-response", t, req, server: index });
		else finish(req, t, index, { ok: true });

		if (state.queueHead < state.queue.length) {
			const next = state.queue[state.queueHead++] as number;
			if (state.queueHead > 1024 && state.queueHead * 2 > state.queue.length) {
				state.queue = state.queue.slice(state.queueHead);
				state.queueHead = 0;
			}
			startService(index, next, t, t - (arrivedAt[next] as number));
		}
	};

	const onFaultDown = (faultIndex: number, t: Micros) => {
		const fault = input.faults[faultIndex];
		if (!fault) return;
		const state = servers[fault.server] as ServerState;
		if (!state.up) return;

		state.up = false;
		state.epoch++;
		state.downBehavior = fault.behavior;
		state.activeFault = faultIndex;
		emit({ kind: "node-down", t, server: fault.server, fault: faultIndex });

		const evicted: Array<{ req: number; from: "queue" | "service" }> = [];
		for (const req of state.inService) evicted.push({ req, from: "service" });
		for (let i = state.queueHead; i < state.queue.length; i++)
			evicted.push({ req: state.queue[i] as number, from: "queue" });
		state.inService.clear();
		state.queue = [];
		state.queueHead = 0;

		for (const { req, from } of evicted) {
			emit({ kind: "evicted", t, req, server: fault.server, from });
			// With `refuse` the connection resets and the client learns at once; with `hang` the
			// client only finds out when its own deadline passes.
			if (fault.behavior === "refuse" && !terminal[req])
				finish(req, t, fault.server, { ok: false, reason: "server-crashed" });
		}
	};

	const onFaultUp = (faultIndex: number, t: Micros) => {
		const fault = input.faults[faultIndex];
		if (!fault) return;
		const state = servers[fault.server] as ServerState;
		if (state.up || state.activeFault !== faultIndex) return;
		state.up = true;
		state.activeFault = -1;
		emit({ kind: "node-up", t, server: fault.server, fault: faultIndex });
	};

	const onProbeSend = (t: Micros) => {
		const hc = input.healthCheck;
		if (!hc) return;
		servers.forEach((state, index) => {
			// Probes bypass the request queue and answer instantly when the backend is up; this is a
			// modeling simplification, not how every proxy implements active checks.
			if (state.up)
				schedule({
					type: "probe-result",
					t,
					priority: PRIORITY.probeResult,
					server: index,
					ok: true,
				});
			else
				schedule({
					type: "probe-result",
					t: state.downBehavior === "hang" ? t + hc.probeTimeoutUs : t,
					priority: PRIORITY.probeResult,
					server: index,
					ok: false,
				});
		});
		schedule({
			type: "probe-send",
			t: t + hc.intervalUs,
			priority: PRIORITY.probeSend,
		});
	};

	const onProbeResult = (index: number, ok: boolean, t: Micros) => {
		const hc = input.healthCheck;
		if (!hc) return;
		const state = servers[index] as ServerState;
		emit({ kind: "probe", t, server: index, ok });
		if (ok) {
			state.consecutiveOk++;
			state.consecutiveFail = 0;
			if (!state.healthy && state.consecutiveOk >= hc.healthyThreshold) {
				state.healthy = true;
				emit({
					kind: "health-changed",
					t,
					server: index,
					healthy: true,
					fault: state.activeFault,
				});
			}
		} else {
			state.consecutiveFail++;
			state.consecutiveOk = 0;
			if (state.healthy && state.consecutiveFail >= hc.unhealthyThreshold) {
				state.healthy = false;
				emit({
					kind: "health-changed",
					t,
					server: index,
					healthy: false,
					fault: state.activeFault,
				});
			}
		}
	};

	// Initial schedule, in a fixed order: faults (input order), probes, first arrival.
	input.faults.forEach((fault, index) => {
		schedule({
			type: "fault-down",
			t: fault.atUs,
			priority: PRIORITY.fault,
			fault: index,
		});
		if (fault.recoverAtUs !== null)
			schedule({
				type: "fault-up",
				t: fault.recoverAtUs,
				priority: PRIORITY.fault,
				fault: index,
			});
	});
	if (input.healthCheck)
		schedule({ type: "probe-send", t: 0, priority: PRIORITY.probeSend });
	const firstArrival = arrivals.next();
	if (firstArrival !== null)
		schedule({ type: "arrival", t: firstArrival, priority: PRIORITY.arrival });

	let status: EngineRunResult["status"] = "completed";
	try {
		for (;;) {
			const item = queue.peek();
			if (!item || item.t > input.horizonUs) break;
			queue.pop();
			now = item.t;
			switch (item.type) {
				case "fault-down":
					onFaultDown(item.fault, now);
					break;
				case "fault-up":
					onFaultUp(item.fault, now);
					break;
				case "probe-result":
					onProbeResult(item.server, item.ok, now);
					break;
				case "service-complete":
					onServiceComplete(item.server, item.req, item.epoch, now);
					break;
				case "timeout":
					if (!terminal[item.req])
						finish(item.req, now, routedTo[item.req] ?? -1, {
							ok: false,
							reason: "timeout",
						});
					break;
				case "probe-send":
					onProbeSend(now);
					break;
				case "arrival": {
					onArrival(now);
					const next = arrivals.next();
					if (next !== null)
						schedule({ type: "arrival", t: next, priority: PRIORITY.arrival });
					break;
				}
			}
		}
	} catch (error) {
		if (!(error instanceof EventLimitReached)) throw error;
		status = "event-limit";
	}

	return {
		status,
		eventCount,
		endUs: status === "completed" ? input.horizonUs : now,
		requests,
	};
}

interface ArrivalSource {
	next(): Micros | null;
}

/**
 * Lazily yields arrival times across rate phases.
 * - `constant`: arrival k of a phase is at `start + ceil(k * 1e6 / rps)`, so a phase of exactly
 *   `rps * seconds` length produces exactly `rps * seconds` arrivals.
 * - `poisson`: exponential inter-arrival gaps from the `arrivals` stream; at a phase boundary the
 *   process restarts from the boundary (valid because the exponential is memoryless).
 */
export function createArrivalSource(
	process: EngineInput["arrival"],
	phases: RatePhase[],
	seed: number,
): ArrivalSource {
	const rng = createRng(seed, "arrivals");
	let phaseIndex = 0;
	let k = 0;
	let cursor = phases[0]?.startUs ?? 0;

	return {
		next() {
			while (phaseIndex < phases.length) {
				const phase = phases[phaseIndex] as RatePhase;
				if (phase.rps > 0) {
					if (process === "constant") {
						const t = phase.startUs + Math.ceil((k * 1_000_000) / phase.rps);
						if (t < phase.endUs) {
							k++;
							return t;
						}
					} else {
						cursor = Math.max(cursor, phase.startUs);
						const gap = Math.max(
							1,
							Math.round(rng.exponential(1_000_000 / phase.rps)),
						);
						const t = cursor + gap;
						if (t < phase.endUs) {
							cursor = t;
							return t;
						}
					}
				}
				phaseIndex++;
				k = 0;
				cursor = phases[phaseIndex]?.startUs ?? cursor;
			}
			return null;
		},
	};
}

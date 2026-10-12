import { createRng, type Rng } from "./prng.ts";
import { EventQueue, type Scheduled } from "./queue.ts";
import type {
	EdgeInput,
	EngineInput,
	EngineRunResult,
	EventSink,
	FailureReason,
	FaultBehavior,
	FaultInput,
	Micros,
	NodeInput,
	RatePhase,
	SimEvent,
} from "./types.ts";

export const ENGINE_VERSION = "0.3.0";

/**
 * Same-time ordering. Lower runs first. This table is part of the reproducibility contract:
 * - Faults change the world before anything observes it.
 * - Probe results and breaker transitions are applied before routing decisions at that instant.
 * - Calls and responses in transit arrive before work completes at that instant.
 * - A response that lands exactly on the deadline counts as on time (completion before timeout).
 * - Completions free slots before new arrivals look for one.
 */
const PRIORITY = {
	fault: 0,
	probeResult: 1,
	breaker: 1,
	transfer: 2,
	serviceComplete: 3,
	timeout: 4,
	probeSend: 5,
	arrival: 6,
} as const;

type Pending = Scheduled &
	(
		| { type: "fault-on"; fault: number }
		| { type: "fault-off"; fault: number }
		| { type: "probe-result"; lb: number; node: number; ok: boolean }
		| { type: "breaker-half-open"; edge: number; generation: number }
		| { type: "deliver"; call: number }
		| {
				type: "respond";
				call: number;
				ok: boolean;
				reason: FailureReason | null;
				origin: number;
		  }
		| { type: "service-complete"; node: number; call: number; epoch: number }
		| { type: "job-complete"; node: number; job: number; epoch: number }
		| { type: "call-timeout"; call: number }
		| { type: "queue-timeout"; node: number; call: number; epoch: number }
		| { type: "cluster-detect"; cluster: number; edge: number; up: boolean }
		| { type: "deferred"; id: number }
		| { type: "deadline"; req: number }
		| { type: "probe-send"; lb: number }
		| { type: "arrival" }
	);

type PendingInit = Pending extends infer P
	? P extends Pending
		? Omit<P, "seq">
		: never
	: never;

type WorkerNode = Exclude<
	NodeInput,
	{ kind: "client" | "load-balancer" | "rate-limiter" | "db-cluster" }
>;
type ClusterNode = Extract<NodeInput, { kind: "db-cluster" }>;
type LimiterNode = Extract<NodeInput, { kind: "rate-limiter" }>;
type SlowdownFault = Extract<FaultInput, { kind: "slowdown" }>;

/** Exponential backoff never waits longer than this between two attempts. */
const MAX_BACKOFF_US = 30_000_000;
/** A retry budget never holds more than this many retries in reserve. */
const RETRY_BUDGET_CAP = 10;

type Outcome =
	| { ok: true }
	| { ok: false; reason: FailureReason; origin: number };

interface Call {
	id: number;
	req: number;
	edge: number;
	attempt: number;
	startedAt: Micros;
	/** The caller has learned an outcome (or given up); later completions are late. */
	done: boolean;
	onDone: (outcome: Outcome, t: Micros) => void;
	/** Set while the call occupies a slot or a queue position at the target. */
	queuedAt: Micros;
}

interface Job {
	id: number;
	req: number;
	node: number;
	storedAt: Micros;
}

interface WorkerState {
	up: boolean;
	/** Incremented on every crash so completions scheduled before the crash are ignored. */
	epoch: number;
	downBehavior: FaultBehavior;
	activeCrash: number;
	busy: Set<number>;
	/** FIFO of call (or job) ids; ids that left early stay in the array but not in `queued`. */
	waiting: number[];
	waitingHead: number;
	/** Calls currently waiting (not used by queue nodes, whose backlog never times out). */
	queued: Set<number>;
	rng: Rng;
	capacityOverride: number | null;
	/** Active slowdown faults, by fault index. */
	slowdowns: number[];
	errorRate: number;
	flushed: boolean;
}

interface ClusterState {
	/** Edge index of the current primary. */
	primary: number;
	/** Edges whose target the cluster has noticed is down. */
	knownDown: Set<number>;
	rr: number;
	rng: Rng;
}

interface LimiterState {
	tokens: number;
	lastUs: Micros;
}

interface BalancerState {
	rrPointer: number;
	rng: Rng;
	/** Per downstream edge index: the balancer's view of that backend. */
	healthy: Map<number, boolean>;
	consecutiveOk: Map<number, number>;
	consecutiveFail: Map<number, number>;
	outstanding: Map<number, number>;
}

interface BreakerState {
	state: "closed" | "open" | "half-open";
	failures: number;
	generation: number;
}

class EventLimitReached extends Error {}

/**
 * Runs one deterministic discrete-event simulation and streams every event into `sink`.
 *
 * A request is one client call over the client's outgoing edge. Each hop is a call: it may be
 * lost, delayed, refused, queued, served, retried or cut off by a timeout or circuit breaker. A
 * request has exactly one terminal outcome (`succeeded` or `failed`). Work a component finishes
 * after its caller gave up is reported as `late-response` and never counted as a success.
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

	const nodes = input.nodes;
	const edges = input.edges;
	const outgoing: number[][] = nodes.map(() => []);
	edges.forEach((e, i) => {
		(outgoing[e.source] as number[]).push(i);
	});

	const workers = new Map<number, WorkerState>();
	const balancers = new Map<number, BalancerState>();
	const clusters = new Map<number, ClusterState>();
	const limiters = new Map<number, LimiterState>();
	nodes.forEach((n, i) => {
		if (n.kind === "db-cluster")
			clusters.set(i, {
				primary: (outgoing[i] as number[])[0] ?? -1,
				knownDown: new Set(),
				rr: 0,
				rng: createRng(input.seed, `cluster:${n.id}`),
			});
		else if (n.kind === "rate-limiter")
			limiters.set(i, { tokens: n.burst, lastUs: 0 });
		else if (n.kind === "load-balancer") {
			const out = outgoing[i] as number[];
			balancers.set(i, {
				rrPointer: 0,
				rng: createRng(input.seed, `balancer:${n.id}`),
				healthy: new Map(out.map((e) => [e, true])),
				consecutiveOk: new Map(out.map((e) => [e, 0])),
				consecutiveFail: new Map(out.map((e) => [e, 0])),
				outstanding: new Map(out.map((e) => [e, 0])),
			});
		} else if (n.kind !== "client")
			workers.set(i, {
				up: true,
				epoch: 0,
				downBehavior: "refuse",
				activeCrash: -1,
				busy: new Set(),
				waiting: [],
				waitingHead: 0,
				queued: new Set(),
				rng: createRng(input.seed, `service:${n.id}`),
				capacityOverride: null,
				slowdowns: [],
				errorRate: 0,
				flushed: false,
			});
	});
	const breakers = new Map<number, BreakerState>();
	edges.forEach((e, i) => {
		if (e.circuitBreaker)
			breakers.set(i, { state: "closed", failures: 0, generation: 0 });
	});
	const retryBudget = new Map<number, number>();
	const deferred = new Map<number, () => void>();
	let deferredSeq = 0;
	/** Runs `fn` at simulated time `t`, in the transfer slot of the same-time order. */
	const defer = (t: Micros, fn: () => void) => {
		const id = deferredSeq++;
		deferred.set(id, fn);
		schedule({ type: "deferred", t, priority: PRIORITY.transfer, id });
	};
	const linkAddUs = new Map<number, Micros>();
	const linkLoss = new Map<number, number>();
	const linkRng = new Map<number, Rng>();
	const edgeRng = (i: number) => {
		let rng = linkRng.get(i);
		if (!rng) {
			rng = createRng(input.seed, `edge:${(edges[i] as EdgeInput).id}`);
			linkRng.set(i, rng);
		}
		return rng;
	};

	// Per-request state, indexed by request id.
	const arrivedAt: Micros[] = [];
	const terminal: boolean[] = [];
	/** Deepest node working on the request, for attributing a client timeout. */
	const lastNode: number[] = [];
	let requests = 0;
	const calls: Call[] = [];
	const jobs: Job[] = [];

	const arrivals = createArrivalSource(input.arrival, input.phases, input.seed);

	const finishRequest = (req: number, t: Micros, outcome: Outcome) => {
		if (terminal[req]) return;
		terminal[req] = true;
		const latencyUs = t - (arrivedAt[req] as number);
		if (outcome.ok) emit({ kind: "succeeded", t, req, latencyUs });
		else
			emit({
				kind: "failed",
				t,
				req,
				reason: outcome.reason,
				node: outcome.origin,
				latencyUs,
			});
	};

	// ---- Edges: calls, latency, loss, timeouts, retries, breakers ----------------------------

	const effectiveLatency = (edge: number) =>
		(edges[edge] as EdgeInput).latencyUs + (linkAddUs.get(edge) ?? 0);

	const breakerFailure = (edge: number, t: Micros) => {
		const b = breakers.get(edge);
		const config = (edges[edge] as EdgeInput).circuitBreaker;
		if (!b || !config) return;
		b.failures++;
		if (b.state === "closed" && b.failures < config.failureThreshold) return;
		if (b.state === "open") return;
		b.state = "open";
		b.generation++;
		emit({ kind: "breaker", t, edge, state: "open" });
		schedule({
			type: "breaker-half-open",
			t: t + config.openUs,
			priority: PRIORITY.breaker,
			edge,
			generation: b.generation,
		});
	};

	const breakerSuccess = (edge: number, t: Micros) => {
		const b = breakers.get(edge);
		if (!b) return;
		b.failures = 0;
		if (b.state !== "closed") {
			b.state = "closed";
			emit({ kind: "breaker", t, edge, state: "closed" });
		}
	};

	/** One attempt over an edge. Resolves exactly once through `onDone`. */
	const attemptCall = (
		edge: number,
		req: number,
		attempt: number,
		t: Micros,
		onDone: (outcome: Outcome, t: Micros) => void,
	) => {
		const config = edges[edge] as EdgeInput;
		const b = breakers.get(edge);
		if (b && b.state === "open") {
			onDone({ ok: false, reason: "circuit-open", origin: config.source }, t);
			return;
		}
		const call: Call = {
			id: calls.length,
			req,
			edge,
			attempt,
			startedAt: t,
			done: false,
			onDone: (outcome, at) => {
				if (call.done) return;
				call.done = true;
				emit({
					kind: "call-end",
					t: at,
					req,
					call: call.id,
					edge,
					ok: outcome.ok,
					reason: outcome.ok ? null : outcome.reason,
					latencyUs: at - t,
				});
				if (outcome.ok) breakerSuccess(edge, at);
				else breakerFailure(edge, at);
				onDone(outcome, at);
			},
			queuedAt: 0,
		};
		calls.push(call);
		emit({ kind: "call-start", t, req, call: call.id, edge, attempt });
		if (b && b.state === "half-open") {
			// Only the trial call passes; the next caller finds the breaker open again.
			b.state = "open";
			b.generation++;
			emit({ kind: "breaker", t, edge, state: "open" });
			schedule({
				type: "breaker-half-open",
				t: t + (config.circuitBreaker?.openUs ?? 0),
				priority: PRIORITY.breaker,
				edge,
				generation: b.generation,
			});
		}
		if (config.timeoutUs !== null)
			schedule({
				type: "call-timeout",
				t: t + config.timeoutUs,
				priority: PRIORITY.timeout,
				call: call.id,
			});

		const loss = linkLoss.get(edge) ?? 0;
		if (loss > 0 && edgeRng(edge).next() < loss) return; // lost: only a timeout ends it

		const latency = effectiveLatency(edge);
		if (latency === 0) deliver(call, t);
		else
			schedule({
				type: "deliver",
				t: t + latency,
				priority: PRIORITY.transfer,
				call: call.id,
			});
	};

	const backoffUs = (edge: number, attempt: number): Micros => {
		const config = edges[edge] as EdgeInput;
		if (config.retryBackoffUs <= 0) return 0;
		const base = Math.min(
			MAX_BACKOFF_US,
			config.retryBackoffUs * 2 ** (attempt - 1),
		);
		return config.retryJitter
			? Math.floor(edgeRng(edge).next() * base)
			: Math.round(base);
	};

	/** A call with the edge's retry policy: attempts, backoff, jitter and budget. */
	const callEdge = (
		edge: number,
		req: number,
		t: Micros,
		onDone: (outcome: Outcome, t: Micros) => void,
	) => {
		const config = edges[edge] as EdgeInput;
		const tryOnce = (attempt: number, at: Micros) => {
			if (attempt === 1 && config.retryBudget !== null)
				retryBudget.set(
					edge,
					Math.min(
						RETRY_BUDGET_CAP,
						(retryBudget.get(edge) ?? RETRY_BUDGET_CAP) + config.retryBudget,
					),
				);
			attemptCall(edge, req, attempt, at, (outcome, doneAt) => {
				if (outcome.ok || attempt > config.retries || terminal[req]) {
					onDone(outcome, doneAt);
					return;
				}
				if (config.retryBudget !== null) {
					const balance = retryBudget.get(edge) ?? RETRY_BUDGET_CAP;
					if (balance < 1) {
						onDone(outcome, doneAt); // budget spent: give up instead of piling on
						return;
					}
					retryBudget.set(edge, balance - 1);
				}
				const wait = backoffUs(edge, attempt);
				if (wait === 0) tryOnce(attempt + 1, doneAt);
				// The caller keeps its slot while it sleeps, as a blocking client would.
				else
					defer(doneAt + wait, () => {
						if (terminal[req]) onDone(outcome, now);
						else tryOnce(attempt + 1, now);
					});
			});
		};
		tryOnce(1, t);
	};

	/** The target finished the call: send the answer back over the edge. */
	const respond = (call: Call, outcome: Outcome, t: Micros) => {
		const target = (edges[call.edge] as EdgeInput).target;
		// The caller gave up on this call (edge timeout) or the client gave up on the request
		// (deadline): the answer is wasted work. Workers report it so the capacity it used is visible.
		if ((call.done || terminal[call.req]) && workers.has(target))
			emit({ kind: "late-response", t, req: call.req, node: target });
		// Nobody is waiting for a timed-out call any more. A terminal request's answer still travels
		// back, because every caller up the chain holds a slot until its own call returns.
		sendBack(call, outcome, t);
	};

	/** Returns an outcome to the caller over the edge, unless the caller already gave up. */
	const sendBack = (call: Call, outcome: Outcome, t: Micros) => {
		if (call.done) return;
		const latency = effectiveLatency(call.edge);
		if (latency === 0) call.onDone(outcome, t);
		else
			schedule({
				type: "respond",
				t: t + latency,
				priority: PRIORITY.transfer,
				call: call.id,
				ok: outcome.ok,
				reason: outcome.ok ? null : outcome.reason,
				origin: outcome.ok ? -1 : outcome.origin,
			});
	};

	// ---- Nodes ----------------------------------------------------------------------------

	const deliver = (call: Call, t: Micros) => {
		if (call.done) return;
		const node = (edges[call.edge] as EdgeInput).target;
		lastNode[call.req] = node;
		const config = nodes[node] as NodeInput;
		if (config.kind === "load-balancer") balance(node, call, t);
		else if (config.kind === "rate-limiter") limit(node, call, t);
		else if (config.kind === "db-cluster") routeCluster(node, call, t);
		else if (config.kind === "client")
			respond(call, { ok: false, reason: "refused", origin: node }, t);
		else admit(node, call, t);
	};

	const eligibleBackends = (lb: number): number[] => {
		const state = balancers.get(lb) as BalancerState;
		const config = nodes[lb] as Extract<NodeInput, { kind: "load-balancer" }>;
		return (outgoing[lb] as number[]).filter(
			(e) => config.healthCheck === null || state.healthy.get(e),
		);
	};

	const pickBackend = (lb: number, exclude: Set<number>): number => {
		const state = balancers.get(lb) as BalancerState;
		const config = nodes[lb] as Extract<NodeInput, { kind: "load-balancer" }>;
		const out = outgoing[lb] as number[];
		const candidates = eligibleBackends(lb).filter((e) => !exclude.has(e));
		if (candidates.length === 0) return -1;
		if (config.algorithm === "random")
			return candidates[
				Math.floor(state.rng.next() * candidates.length)
			] as number;
		if (config.algorithm === "least-connections") {
			let best = candidates[0] as number;
			for (const e of candidates)
				if (
					(state.outstanding.get(e) ?? 0) < (state.outstanding.get(best) ?? 0)
				)
					best = e;
			return best;
		}
		// Round robin walks the edge list from the pointer, skipping ineligible backends.
		for (let step = 0; step < out.length; step++) {
			const index = (state.rrPointer + step) % out.length;
			const e = out[index] as number;
			if (candidates.includes(e)) {
				state.rrPointer = (index + 1) % out.length;
				return e;
			}
		}
		return -1;
	};

	const balance = (lb: number, call: Call, t: Micros) => {
		const state = balancers.get(lb) as BalancerState;
		const config = nodes[lb] as Extract<NodeInput, { kind: "load-balancer" }>;
		const tried = new Set<number>();
		const next = (at: Micros, lastFailure: Outcome | null) => {
			const edge = pickBackend(lb, tried);
			if (edge === -1) {
				respond(
					call,
					lastFailure ?? {
						ok: false,
						reason: "no-healthy-backend",
						origin: lb,
					},
					at,
				);
				return;
			}
			tried.add(edge);
			emit({
				kind: "routed",
				t: at,
				req: call.req,
				call: call.id,
				node: lb,
				to: (edges[edge] as EdgeInput).target,
			});
			state.outstanding.set(edge, (state.outstanding.get(edge) ?? 0) + 1);
			callEdge(edge, call.req, at, (outcome, doneAt) => {
				state.outstanding.set(edge, (state.outstanding.get(edge) ?? 0) - 1);
				if (outcome.ok || tried.size > config.retries || terminal[call.req])
					respond(call, outcome, doneAt);
				else next(doneAt, outcome);
			});
		};
		next(t, null);
	};

	const limit = (node: number, call: Call, t: Micros) => {
		const state = limiters.get(node) as LimiterState;
		const config = nodes[node] as LimiterNode;
		state.tokens = Math.min(
			config.burst,
			state.tokens + ((t - state.lastUs) * config.ratePerSec) / 1_000_000,
		);
		state.lastUs = t;
		const edge = (outgoing[node] as number[])[0];
		if (state.tokens < 1 || edge === undefined) {
			respond(call, { ok: false, reason: "rate-limited", origin: node }, t);
			return;
		}
		state.tokens -= 1;
		callEdge(edge, call.req, t, (outcome, at) => respond(call, outcome, at));
	};

	const routeCluster = (node: number, call: Call, t: Micros) => {
		const state = clusters.get(node) as ClusterState;
		const config = nodes[node] as ClusterNode;
		const out = outgoing[node] as number[];
		// Always draw, so the read/write split does not depend on which nodes are down.
		const write = state.rng.next() < config.writeRatio;
		let edge = -1;
		if (write) {
			if (!state.knownDown.has(state.primary)) edge = state.primary;
		} else {
			const replicas = out.filter(
				(e) => e !== state.primary && !state.knownDown.has(e),
			);
			if (replicas.length > 0) {
				edge = replicas[state.rr % replicas.length] as number;
				state.rr++;
			} else if (!state.knownDown.has(state.primary)) edge = state.primary;
		}
		if (edge === -1) {
			respond(
				call,
				{ ok: false, reason: "no-healthy-backend", origin: node },
				t,
			);
			return;
		}
		emit({
			kind: "routed",
			t,
			req: call.req,
			call: call.id,
			node,
			to: (edges[edge] as EdgeInput).target,
		});
		callEdge(edge, call.req, t, (outcome, at) => respond(call, outcome, at));
	};

	const onClusterDetect = (
		cluster: number,
		edge: number,
		up: boolean,
		t: Micros,
	) => {
		const state = clusters.get(cluster) as ClusterState;
		const target = (edges[edge] as EdgeInput).target;
		const worker = workers.get(target);
		// The node changed state again before the cluster noticed; that change has its own check.
		if (!worker || worker.up !== up) return;
		if (!up) {
			if (state.knownDown.has(edge)) return;
			state.knownDown.add(edge);
			emit({
				kind: "health-changed",
				t,
				node: target,
				from: cluster,
				healthy: false,
				fault: worker.activeCrash,
			});
			if (edge === state.primary) {
				const next = (outgoing[cluster] as number[]).find(
					(e) => e !== edge && !state.knownDown.has(e),
				);
				if (next !== undefined) {
					state.primary = next;
					emit({
						kind: "promoted",
						t,
						node: cluster,
						from: target,
						to: (edges[next] as EdgeInput).target,
					});
				}
			}
		} else {
			if (!state.knownDown.delete(edge)) return;
			emit({
				kind: "health-changed",
				t,
				node: target,
				from: cluster,
				healthy: true,
				fault: worker.activeCrash,
			});
		}
	};

	/** Schedules every cluster in front of `node` to notice that it went down or came back. */
	const notifyClusters = (node: number, up: boolean, t: Micros) => {
		for (const [cluster] of clusters) {
			const config = nodes[cluster] as ClusterNode;
			for (const edge of outgoing[cluster] as number[])
				if ((edges[edge] as EdgeInput).target === node)
					schedule({
						type: "cluster-detect",
						t: t + config.failoverUs,
						priority: PRIORITY.probeResult,
						cluster,
						edge,
						up,
					});
		}
	};

	const effectiveCapacity = (node: number) => {
		const config = nodes[node] as WorkerNode;
		const state = workers.get(node) as WorkerState;
		return state.capacityOverride === null
			? config.capacity
			: Math.min(config.capacity, state.capacityOverride);
	};

	/** Own work for one call starting now; the node's busy set already includes it. */
	const ownTime = (node: number, t: Micros): Micros => {
		const config = nodes[node] as WorkerNode;
		const state = workers.get(node) as WorkerState;
		const base =
			config.distribution === "fixed"
				? config.serviceTimeUs
				: Math.max(1, Math.round(state.rng.exponential(config.serviceTimeUs)));
		let factor = 1;
		let addUs = 0;
		for (const index of state.slowdowns) {
			const f = input.faults[index] as SlowdownFault;
			const share =
				f.ramp && f.untilUs !== null && f.untilUs > f.atUs
					? Math.min(1, Math.max(0, (t - f.atUs) / (f.untilUs - f.atUs)))
					: 1;
			factor *= 1 + (f.factor - 1) * share;
			addUs += f.addUs * share;
		}
		const n = Math.max(1, state.busy.size);
		const usl =
			1 + config.contention * (n - 1) + config.coherency * n * (n - 1);
		return Math.max(1, Math.round(base * factor * usl + addUs));
	};

	/** The node gives up on a call without doing the work. */
	const abandon = (
		node: number,
		call: Call,
		reason: "queue-timeout" | "deadline",
		t: Micros,
	) => {
		emit({ kind: "abandoned", t, req: call.req, call: call.id, node, reason });
		sendBack(
			call,
			{
				ok: false,
				reason: reason === "deadline" ? "timeout" : "queue-timeout",
				origin: node,
			},
			t,
		);
	};

	const admit = (node: number, call: Call, t: Micros) => {
		const state = workers.get(node) as WorkerState;
		const config = nodes[node] as WorkerNode;
		if (!state.up) {
			if (state.downBehavior === "refuse")
				respond(call, { ok: false, reason: "refused", origin: node }, t);
			// `hang`: the connection attempt never completes; only a timeout ends it.
			return;
		}
		if (
			input.propagateDeadline &&
			terminal[call.req] &&
			config.kind !== "queue"
		) {
			abandon(node, call, "deadline", t);
			return;
		}
		if (state.errorRate > 0 && state.rng.next() < state.errorRate) {
			respond(call, { ok: false, reason: "injected-error", origin: node }, t);
			return;
		}
		if (config.kind === "queue") {
			if (state.busy.size < effectiveCapacity(node))
				startJob(node, call.req, t, t);
			else if (
				state.waiting.length - state.waitingHead <
				config.queueCapacity
			) {
				const job: Job = { id: jobs.length, req: call.req, node, storedAt: t };
				jobs.push(job);
				state.waiting.push(job.id);
				emit({
					kind: "enqueued",
					t,
					req: call.req,
					call: call.id,
					node,
					depth: state.waiting.length - state.waitingHead,
				});
			} else {
				respond(call, { ok: false, reason: "queue-full", origin: node }, t);
				return;
			}
			// Stored: the caller is acknowledged at once; the work happens asynchronously.
			respond(call, { ok: true }, t);
			return;
		}
		if (state.busy.size < effectiveCapacity(node))
			startService(node, call, t, 0);
		else if (state.queued.size < config.queueCapacity) {
			call.queuedAt = t;
			state.waiting.push(call.id);
			state.queued.add(call.id);
			emit({
				kind: "enqueued",
				t,
				req: call.req,
				call: call.id,
				node,
				depth: state.queued.size,
			});
			if (config.queueTimeoutUs !== null)
				schedule({
					type: "queue-timeout",
					t: t + config.queueTimeoutUs,
					priority: PRIORITY.timeout,
					node,
					call: call.id,
					epoch: state.epoch,
				});
		} else respond(call, { ok: false, reason: "queue-full", origin: node }, t);
	};

	const startService = (
		node: number,
		call: Call,
		t: Micros,
		queuedUs: Micros,
	) => {
		const state = workers.get(node) as WorkerState;
		state.busy.add(call.id);
		const workUs = ownTime(node, t);
		emit({
			kind: "service-start",
			t,
			req: call.req,
			call: call.id,
			node,
			queuedUs,
			workUs,
		});
		schedule({
			type: "service-complete",
			t: t + workUs,
			priority: PRIORITY.serviceComplete,
			node,
			call: call.id,
			epoch: state.epoch,
		});
	};

	const startJob = (node: number, req: number, t: Micros, storedAt: Micros) => {
		const state = workers.get(node) as WorkerState;
		const job: Job = { id: jobs.length, req, node, storedAt };
		jobs.push(job);
		state.busy.add(job.id);
		emit({
			kind: "job-start",
			t,
			req,
			job: job.id,
			node,
			waitedUs: t - storedAt,
		});
		schedule({
			type: "job-complete",
			t: t + ownTime(node, t),
			priority: PRIORITY.serviceComplete,
			node,
			job: job.id,
			epoch: state.epoch,
		});
	};

	const dispatchWaiting = (node: number, t: Micros) => {
		const state = workers.get(node) as WorkerState;
		const config = nodes[node] as WorkerNode;
		while (
			state.busy.size < effectiveCapacity(node) &&
			state.waitingHead < state.waiting.length
		) {
			const id = state.waiting[state.waitingHead++] as number;
			if (
				state.waitingHead > 1024 &&
				state.waitingHead * 2 > state.waiting.length
			) {
				state.waiting = state.waiting.slice(state.waitingHead);
				state.waitingHead = 0;
			}
			if (config.kind === "queue") {
				const job = jobs[id] as Job;
				state.busy.add(job.id);
				emit({
					kind: "job-start",
					t,
					req: job.req,
					job: job.id,
					node,
					waitedUs: t - job.storedAt,
				});
				schedule({
					type: "job-complete",
					t: t + ownTime(node, t),
					priority: PRIORITY.serviceComplete,
					node,
					job: job.id,
					epoch: state.epoch,
				});
			} else {
				if (!state.queued.delete(id)) continue; // already left the queue
				const call = calls[id] as Call;
				if (input.propagateDeadline && terminal[call.req]) {
					abandon(node, call, "deadline", t);
					continue;
				}
				startService(node, call, t, t - call.queuedAt);
			}
		}
	};

	/** Calls the node's downstream edges one after another; fails at the first failure. */
	const callDownstream = (
		node: number,
		req: number,
		t: Micros,
		onDone: (outcome: Outcome, t: Micros) => void,
	) => {
		const out = outgoing[node] as number[];
		const config = nodes[node] as WorkerNode;
		if (config.parallel && out.length > 1 && !terminal[req]) {
			let pending = out.length;
			let settled = false;
			for (const edge of out)
				callEdge(edge, req, t, (outcome, at) => {
					if (settled) return;
					if (!outcome.ok) {
						settled = true; // fail fast; the other calls finish on their own
						onDone(outcome, at);
					} else if (--pending === 0) {
						settled = true;
						onDone({ ok: true }, at);
					}
				});
			return;
		}
		const step = (i: number, at: Micros) => {
			if (i >= out.length || terminal[req]) {
				onDone({ ok: true }, at);
				return;
			}
			callEdge(out[i] as number, req, at, (outcome, doneAt) => {
				if (!outcome.ok) onDone(outcome, doneAt);
				else step(i + 1, doneAt);
			});
		};
		step(0, t);
	};

	const releaseSlot = (node: number, id: number, t: Micros) => {
		const state = workers.get(node) as WorkerState;
		state.busy.delete(id);
		dispatchWaiting(node, t);
	};

	const onServiceComplete = (
		node: number,
		callId: number,
		epoch: number,
		t: Micros,
	) => {
		const state = workers.get(node) as WorkerState;
		const call = calls[callId] as Call;
		if (epoch !== state.epoch || !state.busy.has(callId)) return; // lost with the crash
		const config = nodes[node] as NodeInput;
		const finish = (outcome: Outcome, at: Micros) => {
			if (state.epoch !== epoch || !state.busy.has(callId)) return; // crashed while waiting downstream
			emit({ kind: "service-end", t: at, req: call.req, call: callId, node });
			releaseSlot(node, callId, at);
			respond(call, outcome, at);
		};
		if (config.kind === "cache") {
			const hit =
				!state.flushed &&
				config.hitRatio > 0 &&
				state.rng.next() < config.hitRatio;
			emit({ kind: "cache-hit", t, req: call.req, call: callId, node, hit });
			if (hit) {
				finish({ ok: true }, t);
				return;
			}
		}
		callDownstream(node, call.req, t, finish);
	};

	const onJobComplete = (
		node: number,
		jobId: number,
		epoch: number,
		t: Micros,
	) => {
		const state = workers.get(node) as WorkerState;
		const job = jobs[jobId] as Job;
		if (epoch !== state.epoch || !state.busy.has(jobId)) return;
		callDownstream(node, job.req, t, (outcome, at) => {
			if (state.epoch !== epoch || !state.busy.has(jobId)) return;
			emit({
				kind: "job-done",
				t: at,
				req: job.req,
				job: jobId,
				node,
				ok: outcome.ok,
			});
			releaseSlot(node, jobId, at);
		});
	};

	// ---- Faults ----------------------------------------------------------------------------

	const onFaultOn = (index: number, t: Micros) => {
		const fault = input.faults[index] as FaultInput;
		if (fault.kind === "node-failure") {
			const state = workers.get(fault.node);
			if (!state || !state.up) return;
			state.up = false;
			state.epoch++;
			state.downBehavior = fault.behavior;
			state.activeCrash = index;
			emit({ kind: "node-down", t, node: fault.node, fault: index });
			const config = nodes[fault.node] as NodeInput;
			const busy = [...state.busy];
			const waiting = state.waiting
				.slice(state.waitingHead)
				.filter((id) => config.kind === "queue" || state.queued.has(id));
			state.busy.clear();
			state.waiting = [];
			state.waitingHead = 0;
			state.queued.clear();
			notifyClusters(fault.node, false, t);
			if (config.kind === "queue") {
				for (const id of [...busy, ...waiting]) {
					const job = jobs[id] as Job;
					emit({
						kind: "job-done",
						t,
						req: job.req,
						job: id,
						node: fault.node,
						ok: false,
					});
				}
				return;
			}
			for (const [list, from] of [
				[busy, "service"],
				[waiting, "queue"],
			] as const)
				for (const id of list) {
					const call = calls[id] as Call;
					emit({
						kind: "evicted",
						t,
						req: call.req,
						call: id,
						node: fault.node,
						from,
					});
					// With `refuse` the connection resets and the caller learns at once; with `hang` the
					// caller only finds out when its own timeout passes.
					if (fault.behavior === "refuse")
						respond(
							call,
							{ ok: false, reason: "lost-in-crash", origin: fault.node },
							t,
						);
				}
			return;
		}
		emit({ kind: "fault-start", t, fault: index });
		if (fault.kind === "link-latency")
			linkAddUs.set(fault.edge, (linkAddUs.get(fault.edge) ?? 0) + fault.addUs);
		else if (fault.kind === "link-loss")
			linkLoss.set(
				fault.edge,
				Math.min(1, (linkLoss.get(fault.edge) ?? 0) + fault.rate),
			);
		else {
			const state = workers.get(fault.node);
			if (!state) return;
			if (fault.kind === "slowdown") state.slowdowns.push(index);
			else if (fault.kind === "error-rate")
				state.errorRate = Math.min(1, state.errorRate + fault.rate);
			else if (fault.kind === "capacity")
				state.capacityOverride =
					state.capacityOverride === null
						? fault.capacity
						: Math.min(state.capacityOverride, fault.capacity);
			else if (fault.kind === "cache-flush") state.flushed = true;
		}
	};

	const onFaultOff = (index: number, t: Micros) => {
		const fault = input.faults[index] as FaultInput;
		if (fault.kind === "node-failure") {
			const state = workers.get(fault.node);
			if (!state || state.up || state.activeCrash !== index) return;
			state.up = true;
			state.activeCrash = -1;
			emit({ kind: "node-up", t, node: fault.node, fault: index });
			notifyClusters(fault.node, true, t);
			return;
		}
		emit({ kind: "fault-end", t, fault: index });
		if (fault.kind === "link-latency")
			linkAddUs.set(fault.edge, (linkAddUs.get(fault.edge) ?? 0) - fault.addUs);
		else if (fault.kind === "link-loss")
			linkLoss.set(
				fault.edge,
				Math.max(0, (linkLoss.get(fault.edge) ?? 0) - fault.rate),
			);
		else {
			const state = workers.get(fault.node);
			if (!state) return;
			if (fault.kind === "slowdown")
				state.slowdowns = state.slowdowns.filter((i) => i !== index);
			else if (fault.kind === "error-rate")
				state.errorRate = Math.max(0, state.errorRate - fault.rate);
			else if (fault.kind === "capacity") {
				// Recompute from the capacity faults still active on this node.
				const active = input.faults
					.map((f, i) => ({ f, i }))
					.filter(
						({ f, i }) =>
							f.kind === "capacity" &&
							f.node === fault.node &&
							i !== index &&
							f.atUs <= t &&
							(f.untilUs === null || f.untilUs > t),
					);
				state.capacityOverride = active.length
					? Math.min(
							...active.map(
								({ f }) =>
									(f as Extract<FaultInput, { kind: "capacity" }>).capacity,
							),
						)
					: null;
				dispatchWaiting(fault.node, t);
			} else if (fault.kind === "cache-flush") state.flushed = false;
		}
	};

	// ---- Health checks ---------------------------------------------------------------------

	const onProbeSend = (lb: number, t: Micros) => {
		const config = nodes[lb] as Extract<NodeInput, { kind: "load-balancer" }>;
		const hc = config.healthCheck;
		if (!hc) return;
		for (const edge of outgoing[lb] as number[]) {
			const target = (edges[edge] as EdgeInput).target;
			const state = workers.get(target);
			const up = state ? state.up : true;
			// Probes bypass the request queue and answer instantly when the backend is up; this is a
			// modeling simplification, not how every proxy implements active checks.
			schedule({
				type: "probe-result",
				t: up || state?.downBehavior !== "hang" ? t : t + hc.probeTimeoutUs,
				priority: PRIORITY.probeResult,
				lb,
				node: edge,
				ok: up,
			});
		}
		schedule({
			type: "probe-send",
			t: t + hc.intervalUs,
			priority: PRIORITY.probeSend,
			lb,
		});
	};

	const onProbeResult = (lb: number, edge: number, ok: boolean, t: Micros) => {
		const config = nodes[lb] as Extract<NodeInput, { kind: "load-balancer" }>;
		const hc = config.healthCheck;
		if (!hc) return;
		const state = balancers.get(lb) as BalancerState;
		const target = (edges[edge] as EdgeInput).target;
		const worker = workers.get(target);
		emit({ kind: "probe", t, node: target, from: lb, ok });
		if (ok) {
			state.consecutiveOk.set(edge, (state.consecutiveOk.get(edge) ?? 0) + 1);
			state.consecutiveFail.set(edge, 0);
			if (
				!state.healthy.get(edge) &&
				(state.consecutiveOk.get(edge) ?? 0) >= hc.healthyThreshold
			) {
				state.healthy.set(edge, true);
				emit({
					kind: "health-changed",
					t,
					node: target,
					from: lb,
					healthy: true,
					fault: worker?.activeCrash ?? -1,
				});
			}
		} else {
			state.consecutiveFail.set(
				edge,
				(state.consecutiveFail.get(edge) ?? 0) + 1,
			);
			state.consecutiveOk.set(edge, 0);
			if (
				state.healthy.get(edge) &&
				(state.consecutiveFail.get(edge) ?? 0) >= hc.unhealthyThreshold
			) {
				state.healthy.set(edge, false);
				emit({
					kind: "health-changed",
					t,
					node: target,
					from: lb,
					healthy: false,
					fault: worker?.activeCrash ?? -1,
				});
			}
		}
	};

	// ---- Requests --------------------------------------------------------------------------

	const clientEdge = (outgoing[input.client] as number[])[0];

	const onArrival = (t: Micros) => {
		const req = requests++;
		arrivedAt[req] = t;
		terminal[req] = false;
		lastNode[req] = -1;
		emit({ kind: "arrival", t, req });
		schedule({
			type: "deadline",
			t: t + input.timeoutUs,
			priority: PRIORITY.timeout,
			req,
		});
		if (clientEdge === undefined) {
			finishRequest(req, t, {
				ok: false,
				reason: "no-healthy-backend",
				origin: input.client,
			});
			return;
		}
		callEdge(clientEdge, req, t, (outcome, at) =>
			finishRequest(req, at, outcome),
		);
	};

	// Initial schedule, in a fixed order: faults (input order), probes, first arrival.
	input.faults.forEach((fault, index) => {
		schedule({
			type: "fault-on",
			t: fault.atUs,
			priority: PRIORITY.fault,
			fault: index,
		});
		const off =
			fault.kind === "node-failure" ? fault.recoverAtUs : fault.untilUs;
		if (off !== null)
			schedule({
				type: "fault-off",
				t: off,
				priority: PRIORITY.fault,
				fault: index,
			});
	});
	for (const [lb, _] of balancers)
		if (
			(nodes[lb] as Extract<NodeInput, { kind: "load-balancer" }>).healthCheck
		)
			schedule({ type: "probe-send", t: 0, priority: PRIORITY.probeSend, lb });
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
				case "fault-on":
					onFaultOn(item.fault, now);
					break;
				case "fault-off":
					onFaultOff(item.fault, now);
					break;
				case "probe-result":
					onProbeResult(item.lb, item.node, item.ok, now);
					break;
				case "breaker-half-open": {
					const b = breakers.get(item.edge);
					if (b && b.state === "open" && b.generation === item.generation) {
						b.state = "half-open";
						emit({
							kind: "breaker",
							t: now,
							edge: item.edge,
							state: "half-open",
						});
					}
					break;
				}
				case "deliver":
					deliver(calls[item.call] as Call, now);
					break;
				case "respond": {
					const call = calls[item.call] as Call;
					call.onDone(
						item.ok
							? { ok: true }
							: {
									ok: false,
									reason: item.reason as FailureReason,
									origin: item.origin,
								},
						now,
					);
					break;
				}
				case "service-complete":
					onServiceComplete(item.node, item.call, item.epoch, now);
					break;
				case "job-complete":
					onJobComplete(item.node, item.job, item.epoch, now);
					break;
				case "call-timeout": {
					const call = calls[item.call] as Call;
					if (!call.done && !terminal[call.req])
						call.onDone(
							{
								ok: false,
								reason: "timeout",
								origin: (edges[call.edge] as EdgeInput).target,
							},
							now,
						);
					break;
				}
				case "queue-timeout": {
					const state = workers.get(item.node);
					const call = calls[item.call] as Call;
					if (
						state &&
						state.epoch === item.epoch &&
						state.queued.delete(item.call)
					)
						abandon(item.node, call, "queue-timeout", now);
					break;
				}
				case "cluster-detect":
					onClusterDetect(item.cluster, item.edge, item.up, now);
					break;
				case "deferred": {
					const fn = deferred.get(item.id);
					deferred.delete(item.id);
					fn?.();
					break;
				}
				case "deadline":
					if (!terminal[item.req])
						finishRequest(item.req, now, {
							ok: false,
							reason: "timeout",
							origin: lastNode[item.req] ?? -1,
						});
					break;
				case "probe-send":
					onProbeSend(item.lb, now);
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

import {
	type EngineInput,
	type EngineRunResult,
	FAILURE_REASONS,
	type FailureReason,
	type SimEvent,
} from "@faultworks/engine";
import { EVENT_KIND_INDEX } from "./log.ts";
import { latencyStats, nearestRank, SampleBuffer } from "./percentile.ts";
import type {
	FaultSummary,
	InvariantCheck,
	RunMetrics,
	ServerSummary,
	TimeSeries,
	Transition,
} from "./types.ts";

const zeroReasons = (): Record<FailureReason, number> =>
	Object.fromEntries(FAILURE_REASONS.map((r) => [r, 0])) as Record<
		FailureReason,
		number
	>;

export interface RecorderOptions {
	/** Display labels in server order. */
	labels: string[];
	windowMs: number;
}

export interface RunRecorder {
	push(event: SimEvent): void;
	finish(result: EngineRunResult): RunMetrics;
}

/**
 * Reduces the event stream of one run into summary metrics, windowed time series, transitions,
 * invariant checks and a trace fingerprint. It only looks at typed events, never at engine
 * internals, so it doubles as an independent check of the engine's bookkeeping.
 */
export function createRunRecorder(
	input: EngineInput,
	options: RecorderOptions,
): RunRecorder {
	const serverCount = input.servers.length;
	const windowUs = options.windowMs * 1000;
	const windowCount = Math.max(1, Math.ceil(input.horizonUs / windowUs));
	const windowOf = (t: number) =>
		Math.min(windowCount - 1, Math.floor(t / windowUs));

	const perWindow = () => new Array<number>(windowCount).fill(0);
	const perServerWindow = () => Array.from({ length: serverCount }, perWindow);
	const series: TimeSeries = {
		windowMs: options.windowMs,
		startMs: Array.from(
			{ length: windowCount },
			(_, i) => (i * windowUs) / 1000,
		),
		offered: perWindow(),
		succeeded: perWindow(),
		failed: perWindow(),
		failedByReason: Object.fromEntries(
			FAILURE_REASONS.map((r) => [r, perWindow()]),
		) as Record<FailureReason, number[]>,
		p50Ms: new Array(windowCount).fill(null),
		p95Ms: new Array(windowCount).fill(null),
		samples: perWindow(),
		endedP95Ms: new Array(windowCount).fill(null),
		inFlight: perWindow(),
		queueDepth: perServerWindow(),
		busy: perServerWindow(),
		routed: perServerWindow(),
		up: Array.from({ length: serverCount }, () =>
			new Array(windowCount).fill(true),
		),
		healthy: Array.from({ length: serverCount }, () =>
			new Array(windowCount).fill(true),
		),
	};
	const windowSamples: number[][] = Array.from(
		{ length: windowCount },
		() => [],
	);
	const windowEnded: number[][] = Array.from({ length: windowCount }, () => []);

	// Per-request state, indexed by request id (ids are dense and increasing).
	const arrivalUs: number[] = [];
	const routedAtUs: number[] = [];
	const terminalCount: number[] = [];
	const evictedBy: number[] = [];
	const waiting = new Set<number>();

	let offered = 0;
	let admitted = 0;
	let succeeded = 0;
	let failed = 0;
	let lateResponses = 0;
	let probes = 0;
	let inFlight = 0;
	const failedByReason = zeroReasons();
	const successSamples = new SampleBuffer();
	const completedSamples = new SampleBuffer();
	let failedWaitUs = 0;

	const servers = input.servers.map((s, i) => ({
		id: s.id,
		label: options.labels[i] ?? s.id,
		capacity: s.capacity,
		queueCapacity: s.queueCapacity,
		routed: 0,
		succeeded: 0,
		failed: 0,
		failedByReason: zeroReasons(),
		lateResponses: 0,
		peakQueue: 0,
		peakBusy: 0,
		queue: 0,
		busy: 0,
		busyArea: 0,
		lastChangeUs: 0,
		up: true,
		healthy: true,
		activeFault: -1,
		lastFault: -1,
	}));

	const faults = input.faults.map((f) => ({
		id: f.id,
		server: f.server,
		behavior: f.behavior,
		failedAtUs: null as number | null,
		recoveredAtUs: null as number | null,
		detectedAtUs: null as number | null,
		restoredAtUs: null as number | null,
		failedWhileUndetected: 0,
	}));
	const transitions: Transition[] = [];

	const violations = {
		conservation: [] as string[],
		"single-terminal": [] as string[],
		capacity: [] as string[],
		"queue-bounds": [] as string[],
		"monotonic-time": [] as string[],
	};
	const violate = (id: keyof typeof violations, message: string) => {
		if (violations[id].length < 5) violations[id].push(message);
	};

	// Window bookkeeping: carry the current level into windows with no events.
	let currentWindow = 0;
	const touchLevels = (w: number) => {
		servers.forEach((s, i) => {
			const q = series.queueDepth[i] as number[];
			const b = series.busy[i] as number[];
			q[w] = Math.max(q[w] as number, s.queue);
			b[w] = Math.max(b[w] as number, s.busy);
		});
	};
	const closeWindow = (w: number) => {
		series.inFlight[w] = inFlight;
		servers.forEach((s, i) => {
			(series.up[i] as boolean[])[w] = s.up;
			(series.healthy[i] as boolean[])[w] = s.healthy;
		});
	};
	const advanceTo = (t: number) => {
		const w = windowOf(t);
		while (currentWindow < w) {
			closeWindow(currentWindow);
			currentWindow++;
			touchLevels(currentWindow);
		}
	};
	touchLevels(0);

	const accrueBusy = (s: (typeof servers)[number], t: number) => {
		s.busyArea += s.busy * (t - s.lastChangeUs);
		s.lastChangeUs = t;
	};

	// Trace fingerprint: two FNV-1a lanes over 32-bit words.
	let h1 = 0x811c9dc5;
	let h2 = 0x050c5d1f;
	const mix = (v: number) => {
		const word = v >>> 0;
		for (let shift = 0; shift < 32; shift += 8) {
			const byte = (word >>> shift) & 0xff;
			h1 = Math.imul(h1 ^ byte, 0x01000193);
			h2 = Math.imul(h2 ^ byte, 0x01000193);
		}
		h2 = Math.imul(h2 ^ (h2 >>> 15), 0x2c1b3c6d);
	};

	let lastT = 0;
	let eventCount = 0;

	const terminal = (req: number, t: number) => {
		const count = (terminalCount[req] ?? 0) + 1;
		terminalCount[req] = count;
		if (count > 1)
			violate(
				"single-terminal",
				`request ${req} ended twice (at ${t / 1000} ms)`,
			);
		else inFlight--;
	};

	const push = (e: SimEvent) => {
		eventCount++;
		if (e.t < lastT)
			violate("monotonic-time", `event at ${e.t} µs after ${lastT} µs`);
		lastT = e.t;
		advanceTo(e.t);
		const w = currentWindow;

		mix(EVENT_KIND_INDEX[e.kind]);
		mix(e.t);
		if ("req" in e) mix(e.req);
		if ("server" in e) mix(e.server);

		switch (e.kind) {
			case "arrival":
				offered++;
				inFlight++;
				arrivalUs[e.req] = e.t;
				series.offered[w] = (series.offered[w] as number) + 1;
				break;
			case "routed": {
				routedAtUs[e.req] = e.t;
				const s = servers[e.server];
				if (s) s.routed++;
				const r = series.routed[e.server];
				if (r) r[w] = (r[w] as number) + 1;
				break;
			}
			case "enqueued": {
				mix(e.depth);
				const s = servers[e.server];
				if (!s) break;
				admitted++;
				waiting.add(e.req);
				s.queue++;
				if (s.queue !== e.depth)
					violate(
						"queue-bounds",
						`queue depth mismatch on ${s.id} at ${e.t / 1000} ms`,
					);
				if (s.queue > s.queueCapacity)
					violate(
						"queue-bounds",
						`${s.id} queue ${s.queue} > ${s.queueCapacity}`,
					);
				s.peakQueue = Math.max(s.peakQueue, s.queue);
				touchLevels(w);
				break;
			}
			case "service-start": {
				mix(e.queuedUs);
				const s = servers[e.server];
				if (!s) break;
				if (waiting.delete(e.req)) s.queue--;
				else admitted++;
				if (s.queue < 0) violate("queue-bounds", `${s.id} queue went negative`);
				accrueBusy(s, e.t);
				s.busy++;
				if (s.busy > s.capacity)
					violate(
						"capacity",
						`${s.id} had ${s.busy} busy slots of ${s.capacity}`,
					);
				s.peakBusy = Math.max(s.peakBusy, s.busy);
				touchLevels(w);
				break;
			}
			case "service-end": {
				const s = servers[e.server];
				if (!s) break;
				accrueBusy(s, e.t);
				s.busy--;
				if (s.busy < 0) violate("capacity", `${s.id} busy slots went negative`);
				break;
			}
			case "evicted": {
				mix(e.from === "queue" ? 0 : 1);
				const s = servers[e.server];
				if (!s) break;
				evictedBy[e.req] = s.activeFault;
				if (e.from === "service") {
					accrueBusy(s, e.t);
					s.busy--;
				} else if (waiting.delete(e.req)) s.queue--;
				break;
			}
			case "succeeded": {
				mix(e.latencyUs);
				terminal(e.req, e.t);
				succeeded++;
				successSamples.push(e.latencyUs);
				completedSamples.push(e.latencyUs);
				(windowSamples[w] as number[]).push(e.latencyUs);
				(windowEnded[w] as number[]).push(e.latencyUs);
				series.succeeded[w] = (series.succeeded[w] as number) + 1;
				const s = servers[e.server];
				if (s) s.succeeded++;
				break;
			}
			case "failed": {
				mix(FAILURE_REASONS.indexOf(e.reason));
				mix(e.latencyUs);
				terminal(e.req, e.t);
				failed++;
				failedByReason[e.reason]++;
				failedWaitUs += e.latencyUs;
				completedSamples.push(e.latencyUs);
				(windowEnded[w] as number[]).push(e.latencyUs);
				series.failed[w] = (series.failed[w] as number) + 1;
				const byReason = series.failedByReason[e.reason];
				byReason[w] = (byReason[w] as number) + 1;
				const s = servers[e.server];
				if (s) {
					s.failed++;
					s.failedByReason[e.reason]++;
					attributeToFault(e.req, e.server);
				}
				break;
			}
			case "late-response": {
				if ((terminalCount[e.req] ?? 0) !== 1)
					violate(
						"single-terminal",
						`late response for request ${e.req} that had not ended`,
					);
				lateResponses++;
				const s = servers[e.server];
				if (s) s.lateResponses++;
				break;
			}
			case "node-down": {
				mix(e.fault);
				const s = servers[e.server];
				const f = faults[e.fault];
				if (!s || !f) break;
				s.up = false;
				s.activeFault = e.fault;
				s.lastFault = e.fault;
				f.failedAtUs = e.t;
				transitions.push({
					tMs: e.t / 1000,
					server: e.server,
					kind: "down",
					fault: e.fault,
				});
				break;
			}
			case "node-up": {
				mix(e.fault);
				const s = servers[e.server];
				const f = faults[e.fault];
				if (!s || !f) break;
				s.up = true;
				s.activeFault = -1;
				f.recoveredAtUs = e.t;
				// Without health checks the load balancer never stopped routing here.
				if (input.healthCheck === null) f.restoredAtUs = e.t;
				transitions.push({
					tMs: e.t / 1000,
					server: e.server,
					kind: "up",
					fault: e.fault,
				});
				break;
			}
			case "probe":
				mix(e.ok ? 1 : 0);
				probes++;
				break;
			case "health-changed": {
				mix(e.healthy ? 1 : 0);
				mix(e.fault);
				const s = servers[e.server];
				if (!s) break;
				s.healthy = e.healthy;
				const faultIndex = e.fault !== -1 ? e.fault : s.lastFault;
				const f = faults[faultIndex];
				if (f) {
					if (!e.healthy && f.detectedAtUs === null && e.fault !== -1)
						f.detectedAtUs = e.t;
					if (e.healthy && f.recoveredAtUs !== null && f.restoredAtUs === null)
						f.restoredAtUs = e.t;
				}
				transitions.push({
					tMs: e.t / 1000,
					server: e.server,
					kind: e.healthy ? "healthy" : "unhealthy",
					fault: faultIndex,
				});
				break;
			}
		}
	};

	/**
	 * A failure counts against a fault when the request was lost in that crash, or was routed to the
	 * server while it was down and the load balancer had not yet noticed.
	 */
	function attributeToFault(req: number, server: number) {
		const evicted = evictedBy[req];
		if (evicted !== undefined && evicted !== -1) {
			const f = faults[evicted];
			if (f) f.failedWhileUndetected++;
			return;
		}
		const routedAt = routedAtUs[req];
		if (routedAt === undefined) return;
		for (const f of faults) {
			if (f.server !== server || f.failedAtUs === null) continue;
			const end = Math.min(
				f.recoveredAtUs ?? Number.POSITIVE_INFINITY,
				f.detectedAtUs ?? Number.POSITIVE_INFINITY,
			);
			if (routedAt >= f.failedAtUs && routedAt < end) {
				f.failedWhileUndetected++;
				return;
			}
		}
	}

	/**
	 * Probes run every interval from time 0. A crash just after a probe waits almost a full
	 * interval for the first failed probe; one exactly on a tick is probed at once. A hanging server
	 * adds one probe timeout before each probe counts as failed.
	 */
	const possibleDetection = (behavior: "refuse" | "hang") => {
		const hc = input.healthCheck;
		if (!hc) return null;
		const extra = behavior === "hang" ? hc.probeTimeoutUs : 0;
		return {
			min: ((hc.unhealthyThreshold - 1) * hc.intervalUs + extra) / 1000,
			max: (hc.unhealthyThreshold * hc.intervalUs + extra) / 1000,
		};
	};

	const finish = (result: EngineRunResult): RunMetrics => {
		const endUs = result.endUs;
		advanceTo(endUs);
		for (let w = currentWindow; w < windowCount; w++) {
			if (w > currentWindow) touchLevels(w);
			closeWindow(w);
		}
		for (const s of servers) accrueBusy(s, endUs);

		windowSamples.forEach((samples, w) => {
			series.samples[w] = samples.length;
			if (samples.length === 0) return;
			const sorted = Float64Array.from(samples).sort();
			series.p50Ms[w] = nearestRank(sorted, 50) / 1000;
			series.p95Ms[w] = nearestRank(sorted, 95) / 1000;
		});
		windowEnded.forEach((samples, w) => {
			if (samples.length === 0) return;
			const sorted = Float64Array.from(samples).sort();
			series.endedP95Ms[w] = nearestRank(sorted, 95) / 1000;
		});

		let stillOpen = 0;
		for (let req = 0; req < offered; req++)
			if (!terminalCount[req]) stillOpen++;
		if (stillOpen !== inFlight)
			violate(
				"conservation",
				`in-flight count ${inFlight} disagrees with ${stillOpen} open requests`,
			);
		if (offered !== succeeded + failed + stillOpen)
			violate(
				"conservation",
				`offered ${offered} ≠ succeeded ${succeeded} + failed ${failed} + in flight ${stillOpen}`,
			);
		if (offered !== result.requests)
			violate(
				"conservation",
				`engine created ${result.requests} requests, saw ${offered} arrivals`,
			);

		const measuredMs = endUs / 1000;
		const seconds = endUs / 1_000_000;

		const serverSummaries: ServerSummary[] = servers.map((s) => ({
			id: s.id,
			label: s.label,
			routed: s.routed,
			succeeded: s.succeeded,
			failed: s.failed,
			failedByReason: s.failedByReason,
			lateResponses: s.lateResponses,
			peakQueue: s.peakQueue,
			peakBusy: s.peakBusy,
			capacity: s.capacity,
			queueCapacity: s.queueCapacity,
			utilization: endUs > 0 ? s.busyArea / (s.capacity * endUs) : 0,
		}));

		const faultSummaries: FaultSummary[] = faults
			.filter((f) => f.failedAtUs !== null)
			.map((f) => {
				const s = servers[f.server];
				const failedAtMs = (f.failedAtUs as number) / 1000;
				const detectedAtMs =
					f.detectedAtUs === null ? null : f.detectedAtUs / 1000;
				return {
					id: f.id,
					serverId: s?.id ?? "",
					serverLabel: s?.label ?? "",
					behavior: f.behavior,
					failedAtMs,
					recoveredAtMs:
						f.recoveredAtUs === null ? null : f.recoveredAtUs / 1000,
					detectedAtMs,
					detectionDelayMs:
						detectedAtMs === null ? null : detectedAtMs - failedAtMs,
					restoredAtMs: f.restoredAtUs === null ? null : f.restoredAtUs / 1000,
					failedWhileUndetected: f.failedWhileUndetected,
					possibleDetectionMs: possibleDetection(f.behavior),
					crashOnProbeTick:
						input.healthCheck !== null &&
						(f.failedAtUs as number) % input.healthCheck.intervalUs === 0,
				};
			});

		const checkDefs: Array<[InvariantCheck["id"], string, string]> = [
			[
				"conservation",
				"Every request is accounted for",
				"offered = succeeded + failed + in flight",
			],
			[
				"single-terminal",
				"Each request ends exactly once",
				"no double outcomes, late responses discarded",
			],
			[
				"capacity",
				"Busy slots never exceed concurrency",
				"per server, at every event",
			],
			[
				"queue-bounds",
				"Queues stay between 0 and their size",
				"per server, at every event",
			],
			[
				"monotonic-time",
				"Simulated time never goes backwards",
				"event timestamps are non-decreasing",
			],
		];
		const checks: InvariantCheck[] = checkDefs.map(([id, label, detail]) => ({
			id,
			label,
			passed: violations[id].length === 0,
			detail: violations[id].length === 0 ? detail : violations[id].join("; "),
		}));

		const hex = (v: number) => (v >>> 0).toString(16).padStart(8, "0");
		return {
			summary: {
				status: result.status,
				measuredMs,
				offered,
				admitted,
				succeeded,
				failed,
				failedByReason,
				inFlight: stillOpen,
				lateResponses,
				successLatency: latencyStats(successSamples.view()),
				completedLatency: latencyStats(completedSamples.view()),
				failedWaitMs: failedWaitUs / 1000,
				throughputRps: seconds > 0 ? (succeeded + failed) / seconds : 0,
				successRateRps: seconds > 0 ? succeeded / seconds : 0,
				servers: serverSummaries,
				faults: faultSummaries,
				probes,
			},
			series,
			transitions,
			checks,
			traceDigest: `${hex(h1)}${hex(h2)}`,
			eventCount,
		};
	};

	return { push, finish };
}

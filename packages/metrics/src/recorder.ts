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
	LinkSummary,
	NodeSummary,
	RunMetrics,
	TimeSeries,
	Transition,
} from "./types.ts";

const zeroReasons = (): Record<FailureReason, number> =>
	Object.fromEntries(FAILURE_REASONS.map((r) => [r, 0])) as Record<
		FailureReason,
		number
	>;

export interface RecorderOptions {
	/** Display labels in node order. */
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
	const nodeCount = input.nodes.length;
	const edgeCount = input.edges.length;
	const windowUs = options.windowMs * 1000;
	const windowCount = Math.max(1, Math.ceil(input.horizonUs / windowUs));
	const windowOf = (t: number) =>
		Math.min(windowCount - 1, Math.floor(t / windowUs));

	const perWindow = () => new Array<number>(windowCount).fill(0);
	const perNodeWindow = () => Array.from({ length: nodeCount }, perWindow);
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
		queueDepth: perNodeWindow(),
		busy: perNodeWindow(),
		calls: perNodeWindow(),
		nodeFailed: perNodeWindow(),
		up: Array.from({ length: nodeCount }, () =>
			new Array(windowCount).fill(true),
		),
		healthy: Array.from({ length: nodeCount }, () =>
			new Array(windowCount).fill(true),
		),
		linkCalls: Array.from({ length: edgeCount }, perWindow),
	};
	const windowSamples: number[][] = Array.from(
		{ length: windowCount },
		() => [],
	);
	const windowEnded: number[][] = Array.from({ length: windowCount }, () => []);

	// Per-request state, indexed by request id (ids are dense and increasing).
	const arrivalUs: number[] = [];
	const terminalCount: number[] = [];
	// Per-call state.
	const callStartUs: number[] = [];
	const callDeliveredAt = new Map<number, number>();
	const waiting = new Set<number>();

	let offered = 0;
	let succeeded = 0;
	let failed = 0;
	let lateResponses = 0;
	let probes = 0;
	let inFlight = 0;
	let failedWaitUs = 0;
	const failedByReason = zeroReasons();
	const failedByOrigin = new Map<number, number>();
	const successSamples = new SampleBuffer();
	const completedSamples = new SampleBuffer();

	const nodes = input.nodes.map((n, i) => ({
		id: n.id,
		kind: n.kind,
		label: options.labels[i] ?? n.id,
		capacity: "capacity" in n ? n.capacity : 0,
		queueCapacity: "queueCapacity" in n ? n.queueCapacity : 0,
		calls: 0,
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
		activeCrash: -1,
		lastCrash: -1,
		callLatency: new SampleBuffer(),
		hits: 0,
		lookups: 0,
		jobsDone: 0,
		jobsFailed: 0,
		jobWaitUs: [] as number[],
		activeJobs: new Set<number>(),
	}));
	const links = input.edges.map((e) => ({
		id: e.id,
		source: e.source,
		target: e.target,
		calls: 0,
		retries: 0,
		failed: 0,
		breakerOpens: 0,
	}));

	const faults = input.faults.map((f) => ({
		id: f.id,
		kind: f.kind,
		node: "node" in f ? f.node : -1,
		edge: "edge" in f ? f.edge : -1,
		behavior: f.kind === "node-failure" ? f.behavior : null,
		startedAtUs: null as number | null,
		endedAtUs: null as number | null,
		detectedAtUs: null as number | null,
		restoredAtUs: null as number | null,
		failedWhileUndetected: 0,
	}));
	const transitions: Transition[] = [];
	const balancerWatching = new Map<number, number[]>();
	input.edges.forEach((e) => {
		const src = input.nodes[e.source];
		if (src?.kind === "load-balancer" && src.healthCheck)
			balancerWatching.set(e.target, [
				...(balancerWatching.get(e.target) ?? []),
				e.source,
			]);
	});

	const violations: Record<InvariantCheck["id"], string[]> = {
		conservation: [],
		"single-terminal": [],
		capacity: [],
		"queue-bounds": [],
		"monotonic-time": [],
	};
	const violate = (id: InvariantCheck["id"], message: string) => {
		if (violations[id].length < 5) violations[id].push(message);
	};

	let currentWindow = 0;
	const touchLevels = (w: number) => {
		nodes.forEach((n, i) => {
			const q = series.queueDepth[i] as number[];
			const b = series.busy[i] as number[];
			q[w] = Math.max(q[w] as number, n.queue);
			b[w] = Math.max(b[w] as number, n.busy);
		});
	};
	const closeWindow = (w: number) => {
		series.inFlight[w] = inFlight;
		nodes.forEach((n, i) => {
			(series.up[i] as boolean[])[w] = n.up;
			(series.healthy[i] as boolean[])[w] = n.healthy;
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

	const accrueBusy = (n: (typeof nodes)[number], t: number) => {
		n.busyArea += n.busy * (t - n.lastChangeUs);
		n.lastChangeUs = t;
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

	const bump = (rows: number[][], i: number, w: number) => {
		const r = rows[i];
		if (r) r[w] = (r[w] as number) + 1;
	};

	/** A crash counts a failure when the request reached the node after it died and before detection or recovery. */
	const attributeToCrash = (node: number, t: number) => {
		for (const f of faults) {
			if (
				f.kind !== "node-failure" ||
				f.node !== node ||
				f.startedAtUs === null
			)
				continue;
			const end = Math.min(
				f.endedAtUs ?? Number.POSITIVE_INFINITY,
				f.detectedAtUs ?? Number.POSITIVE_INFINITY,
			);
			if (t >= f.startedAtUs && (t < end || t === f.startedAtUs)) {
				f.failedWhileUndetected++;
				return;
			}
		}
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
		if ("node" in e) mix(e.node);
		if ("edge" in e) mix(e.edge);
		if ("call" in e) mix(e.call);

		switch (e.kind) {
			case "arrival":
				offered++;
				inFlight++;
				arrivalUs[e.req] = e.t;
				series.offered[w] = (series.offered[w] as number) + 1;
				break;
			case "succeeded":
				mix(e.latencyUs);
				terminal(e.req, e.t);
				succeeded++;
				successSamples.push(e.latencyUs);
				completedSamples.push(e.latencyUs);
				(windowSamples[w] as number[]).push(e.latencyUs);
				(windowEnded[w] as number[]).push(e.latencyUs);
				series.succeeded[w] = (series.succeeded[w] as number) + 1;
				break;
			case "failed": {
				mix(FAILURE_REASONS.indexOf(e.reason));
				mix(e.latencyUs);
				terminal(e.req, e.t);
				failed++;
				failedByReason[e.reason]++;
				failedWaitUs += e.latencyUs;
				failedByOrigin.set(e.node, (failedByOrigin.get(e.node) ?? 0) + 1);
				completedSamples.push(e.latencyUs);
				(windowEnded[w] as number[]).push(e.latencyUs);
				series.failed[w] = (series.failed[w] as number) + 1;
				bump([series.failedByReason[e.reason]], 0, w);
				const n = nodes[e.node];
				if (n) {
					n.failed++;
					n.failedByReason[e.reason]++;
					bump(series.nodeFailed, e.node, w);
					// A refusal or a crash loss happens the moment the node is reached; a timeout means the
					// request reached the hung node roughly when it was routed, one timeout earlier.
					if (e.reason === "refused" || e.reason === "lost-in-crash")
						attributeToCrash(e.node, e.t);
					else if (e.reason === "timeout")
						attributeToCrash(e.node, e.t - e.latencyUs);
				}
				break;
			}
			case "late-response":
				lateResponses++;
				{
					const n = nodes[e.node];
					if (n) n.lateResponses++;
				}
				break;
			case "call-start": {
				mix(e.attempt);
				callStartUs[e.call] = e.t;
				const l = links[e.edge];
				if (l) {
					l.calls++;
					if (e.attempt > 1) l.retries++;
				}
				bump(series.linkCalls, e.edge, w);
				break;
			}
			case "call-end": {
				mix(e.ok ? 1 : 0);
				mix(e.latencyUs);
				const edge = input.edges[e.edge];
				const l = links[e.edge];
				if (l && !e.ok) l.failed++;
				const target = edge ? nodes[edge.target] : undefined;
				if (target) {
					target.callLatency.push(e.latencyUs);
					if (e.ok) target.succeeded++;
				}
				break;
			}
			case "routed":
				mix(e.to);
				break;
			case "enqueued": {
				mix(e.depth);
				const n = nodes[e.node];
				if (!n) break;
				if (!callDeliveredAt.has(e.call)) {
					callDeliveredAt.set(e.call, e.t);
					n.calls++;
					bump(series.calls, e.node, w);
				}
				if (n.kind !== "queue") waiting.add(e.call);
				n.queue++;
				if (n.queue !== e.depth)
					violate(
						"queue-bounds",
						`queue depth mismatch on ${n.id} at ${e.t / 1000} ms`,
					);
				if (n.queue > n.queueCapacity)
					violate(
						"queue-bounds",
						`${n.id} queue ${n.queue} > ${n.queueCapacity}`,
					);
				n.peakQueue = Math.max(n.peakQueue, n.queue);
				touchLevels(w);
				break;
			}
			case "service-start": {
				mix(e.queuedUs);
				const n = nodes[e.node];
				if (!n) break;
				if (!callDeliveredAt.has(e.call)) {
					callDeliveredAt.set(e.call, e.t);
					n.calls++;
					bump(series.calls, e.node, w);
				}
				if (waiting.delete(e.call)) n.queue--;
				if (n.queue < 0) violate("queue-bounds", `${n.id} queue went negative`);
				accrueBusy(n, e.t);
				n.busy++;
				if (n.busy > n.capacity)
					violate(
						"capacity",
						`${n.id} had ${n.busy} busy slots of ${n.capacity}`,
					);
				n.peakBusy = Math.max(n.peakBusy, n.busy);
				touchLevels(w);
				break;
			}
			case "service-end": {
				const n = nodes[e.node];
				if (!n) break;
				accrueBusy(n, e.t);
				n.busy--;
				if (n.busy < 0) violate("capacity", `${n.id} busy slots went negative`);
				break;
			}
			case "evicted": {
				mix(e.from === "queue" ? 0 : 1);
				const n = nodes[e.node];
				if (!n) break;
				if (e.from === "service") {
					accrueBusy(n, e.t);
					n.busy--;
				} else if (waiting.delete(e.call)) n.queue--;
				break;
			}
			case "cache-hit": {
				mix(e.hit ? 1 : 0);
				const n = nodes[e.node];
				if (!n) break;
				n.lookups++;
				if (e.hit) n.hits++;
				break;
			}
			case "job-start": {
				mix(e.waitedUs);
				const n = nodes[e.node];
				if (!n) break;
				if (e.waitedUs > 0) n.queue = Math.max(0, n.queue - 1);
				n.jobWaitUs.push(e.waitedUs);
				n.activeJobs.add(e.job);
				accrueBusy(n, e.t);
				n.busy++;
				if (n.busy > n.capacity)
					violate(
						"capacity",
						`${n.id} had ${n.busy} busy consumers of ${n.capacity}`,
					);
				n.peakBusy = Math.max(n.peakBusy, n.busy);
				touchLevels(w);
				break;
			}
			case "job-done": {
				mix(e.ok ? 1 : 0);
				mix(e.job);
				const n = nodes[e.node];
				if (!n) break;
				if (e.ok) n.jobsDone++;
				else n.jobsFailed++;
				if (n.activeJobs.delete(e.job)) {
					accrueBusy(n, e.t);
					n.busy--;
				} else n.queue = Math.max(0, n.queue - 1); // dropped from the backlog by a crash
				break;
			}
			case "node-down": {
				mix(e.fault);
				const n = nodes[e.node];
				const f = faults[e.fault];
				if (!n || !f) break;
				n.up = false;
				n.activeCrash = e.fault;
				n.lastCrash = e.fault;
				f.startedAtUs = e.t;
				// The engine follows with `evicted` and `job-done` events for the work it drops.
				transitions.push({
					tMs: e.t / 1000,
					kind: "down",
					node: e.node,
					fault: e.fault,
				});
				break;
			}
			case "node-up": {
				mix(e.fault);
				const n = nodes[e.node];
				const f = faults[e.fault];
				if (!n || !f) break;
				n.up = true;
				n.activeCrash = -1;
				f.endedAtUs = e.t;
				if (!balancerWatching.has(e.node)) f.restoredAtUs = e.t;
				transitions.push({
					tMs: e.t / 1000,
					kind: "up",
					node: e.node,
					fault: e.fault,
				});
				break;
			}
			case "fault-start": {
				mix(e.fault);
				const f = faults[e.fault];
				if (f) f.startedAtUs = e.t;
				transitions.push({
					tMs: e.t / 1000,
					kind: "fault-start",
					fault: e.fault,
				});
				break;
			}
			case "fault-end": {
				mix(e.fault);
				const f = faults[e.fault];
				if (f) f.endedAtUs = e.t;
				transitions.push({
					tMs: e.t / 1000,
					kind: "fault-end",
					fault: e.fault,
				});
				break;
			}
			case "probe":
				mix(e.ok ? 1 : 0);
				mix(e.from);
				probes++;
				break;
			case "health-changed": {
				mix(e.healthy ? 1 : 0);
				mix(e.fault);
				mix(e.from);
				const n = nodes[e.node];
				if (!n) break;
				n.healthy = e.healthy;
				const f = faults[e.fault !== -1 ? e.fault : n.lastCrash];
				if (f) {
					if (!e.healthy && f.detectedAtUs === null && e.fault !== -1)
						f.detectedAtUs = e.t;
					if (e.healthy && f.endedAtUs !== null && f.restoredAtUs === null)
						f.restoredAtUs = e.t;
				}
				transitions.push({
					tMs: e.t / 1000,
					kind: e.healthy ? "healthy" : "unhealthy",
					node: e.node,
					fault: e.fault !== -1 ? e.fault : n.lastCrash,
				});
				break;
			}
			case "breaker": {
				mix(e.state === "open" ? 0 : e.state === "half-open" ? 1 : 2);
				const l = links[e.edge];
				if (l && e.state === "open") l.breakerOpens++;
				transitions.push({
					tMs: e.t / 1000,
					kind: "breaker",
					edge: e.edge,
					state: e.state,
				});
				break;
			}
		}
	};

	const possibleDetection = (node: number, behavior: "refuse" | "hang") => {
		const lbs = balancerWatching.get(node) ?? [];
		const lb = lbs[0];
		if (lb === undefined) return null;
		const cfg = input.nodes[lb];
		if (cfg?.kind !== "load-balancer" || !cfg.healthCheck) return null;
		const hc = cfg.healthCheck;
		const extra = behavior === "hang" ? hc.probeTimeoutUs : 0;
		return {
			min: ((hc.unhealthyThreshold - 1) * hc.intervalUs + extra) / 1000,
			max: (hc.unhealthyThreshold * hc.intervalUs + extra) / 1000,
			intervalUs: hc.intervalUs,
		};
	};

	const finish = (result: EngineRunResult): RunMetrics => {
		const endUs = result.endUs;
		advanceTo(endUs);
		for (let w = currentWindow; w < windowCount; w++) {
			if (w > currentWindow) touchLevels(w);
			closeWindow(w);
		}
		for (const n of nodes) accrueBusy(n, endUs);

		windowSamples.forEach((samples, w) => {
			series.samples[w] = samples.length;
			if (samples.length === 0) return;
			const sorted = Float64Array.from(samples).sort();
			series.p50Ms[w] = nearestRank(sorted, 50) / 1000;
			series.p95Ms[w] = nearestRank(sorted, 95) / 1000;
		});
		windowEnded.forEach((samples, w) => {
			if (samples.length === 0) return;
			series.endedP95Ms[w] =
				nearestRank(Float64Array.from(samples).sort(), 95) / 1000;
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

		const seconds = endUs / 1_000_000;
		const nodeSummaries: NodeSummary[] = nodes.map((n) => ({
			id: n.id,
			label: n.label,
			kind: n.kind,
			calls: n.calls,
			succeeded: n.succeeded,
			failed: n.failed,
			failedByReason: n.failedByReason,
			lateResponses: n.lateResponses,
			peakQueue: n.peakQueue,
			peakBusy: n.peakBusy,
			capacity: n.capacity,
			queueCapacity: n.queueCapacity,
			utilization:
				endUs > 0 && n.capacity > 0 ? n.busyArea / (n.capacity * endUs) : 0,
			callLatency: latencyStats(n.callLatency.view()),
			hitRatio:
				n.kind === "cache" ? (n.lookups > 0 ? n.hits / n.lookups : 0) : null,
			jobs:
				n.kind === "queue"
					? {
							done: n.jobsDone,
							failed: n.jobsFailed,
							maxWaitMs: n.jobWaitUs.length
								? Math.max(...n.jobWaitUs) / 1000
								: 0,
							meanWaitMs: n.jobWaitUs.length
								? n.jobWaitUs.reduce((a, b) => a + b, 0) /
									n.jobWaitUs.length /
									1000
								: 0,
						}
					: null,
		}));
		const linkSummaries: LinkSummary[] = links.map((l) => ({ ...l }));

		const faultSummaries: FaultSummary[] = faults
			.filter((f) => f.startedAtUs !== null)
			.map((f) => {
				const startedAtMs = (f.startedAtUs as number) / 1000;
				const detectedAtMs =
					f.detectedAtUs === null ? null : f.detectedAtUs / 1000;
				const range =
					f.kind === "node-failure"
						? possibleDetection(f.node, f.behavior as "refuse" | "hang")
						: null;
				return {
					id: f.id,
					kind: f.kind,
					node: f.node,
					nodeLabel:
						f.node === -1
							? links[f.edge]
								? `${nodes[links[f.edge]?.source ?? 0]?.label} → ${nodes[links[f.edge]?.target ?? 0]?.label}`
								: ""
							: (nodes[f.node]?.label ?? ""),
					edge: f.edge,
					startedAtMs,
					endedAtMs: f.endedAtUs === null ? null : f.endedAtUs / 1000,
					behavior: f.behavior,
					detectedAtMs,
					detectionDelayMs:
						detectedAtMs === null ? null : detectedAtMs - startedAtMs,
					restoredAtMs: f.restoredAtUs === null ? null : f.restoredAtUs / 1000,
					failedWhileUndetected: f.failedWhileUndetected,
					possibleDetectionMs: range
						? { min: range.min, max: range.max }
						: null,
					crashOnProbeTick:
						range !== null &&
						(f.startedAtUs as number) % range.intervalUs === 0,
				};
			});

		const checks: InvariantCheck[] = (
			[
				"conservation",
				"single-terminal",
				"capacity",
				"queue-bounds",
				"monotonic-time",
			] as const
		).map((id) => ({
			id,
			passed: violations[id].length === 0,
			detail:
				violations[id].length === 0
					? { key: `checks.${id}.ok` }
					: {
							key: "checks.failed",
							params: { detail: violations[id].join("; ") },
						},
		}));

		const hex = (v: number) => (v >>> 0).toString(16).padStart(8, "0");
		return {
			summary: {
				status: result.status,
				measuredMs: endUs / 1000,
				offered,
				succeeded,
				failed,
				failedByReason,
				failedByOrigin: [...failedByOrigin.entries()]
					.map(([node, count]) => ({ node, count }))
					.sort((a, b) => b.count - a.count),
				inFlight: stillOpen,
				lateResponses,
				successLatency: latencyStats(successSamples.view()),
				completedLatency: latencyStats(completedSamples.view()),
				failedWaitMs: failedWaitUs / 1000,
				throughputRps: seconds > 0 ? (succeeded + failed) / seconds : 0,
				successRateRps: seconds > 0 ? succeeded / seconds : 0,
				nodes: nodeSummaries,
				links: linkSummaries,
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

import type {
	FailureReason,
	FaultKind,
	NodeKind,
	RunStatus,
} from "@faultworks/engine";

export const METRIC_DEFINITIONS_VERSION = "0.2.0";

export interface LatencyStats {
	/** Number of samples behind the percentiles. */
	n: number;
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	meanMs: number;
	maxMs: number;
}

export interface NodeSummary {
	id: string;
	label: string;
	kind: NodeKind;
	/** Calls that reached this node (after routing, latency and loss). */
	calls: number;
	succeeded: number;
	/** Calls that failed with this node as the origin of the failure. */
	failed: number;
	failedByReason: Record<FailureReason, number>;
	lateResponses: number;
	peakQueue: number;
	peakBusy: number;
	capacity: number;
	queueCapacity: number;
	/** Busy slot-time divided by capacity × measured time, 0–1. */
	utilization: number;
	/** Latency of calls answered by this node, measured at its callers. */
	callLatency: LatencyStats | null;
	/** Cache only: lookups answered from memory over all lookups. */
	hitRatio: number | null;
	/** Queue only: jobs processed, failed, and the longest wait between storing and finishing. */
	jobs: {
		done: number;
		failed: number;
		maxWaitMs: number;
		meanWaitMs: number;
	} | null;
}

export interface LinkSummary {
	id: string;
	source: number;
	target: number;
	calls: number;
	/** Calls that were retries (attempt > 1). */
	retries: number;
	failed: number;
	breakerOpens: number;
}

export interface FaultSummary {
	id: string;
	kind: FaultKind;
	/** Node index, or -1 for link faults. */
	node: number;
	nodeLabel: string;
	/** Edge index, or -1 for node faults. */
	edge: number;
	startedAtMs: number;
	/** `null` when the fault lasts until the horizon. */
	endedAtMs: number | null;
	behavior: "refuse" | "hang" | null;
	/** Crash faults only: when a balancer marked the node unhealthy; `null` if none did. */
	detectedAtMs: number | null;
	detectionDelayMs: number | null;
	/** When a balancer routed to the node again after recovery. */
	restoredAtMs: number | null;
	/** Requests that failed because of this crash before it was detected or recovered. */
	failedWhileUndetected: number;
	/** Detection delays the health-check settings allow for this crash; `null` without checks. */
	possibleDetectionMs: { min: number; max: number } | null;
	crashOnProbeTick: boolean;
}

export interface RunSummary {
	status: RunStatus;
	measuredMs: number;
	offered: number;
	succeeded: number;
	failed: number;
	failedByReason: Record<FailureReason, number>;
	/** Failed requests by the node where the failure originated (-1: client deadline with no node). */
	failedByOrigin: Array<{ node: number; count: number }>;
	/** Not terminal at the horizon (censored): neither success nor failure. */
	inFlight: number;
	lateResponses: number;
	/** Latency of successful requests. */
	successLatency: LatencyStats | null;
	/** Latency of all terminal requests; timeouts contribute exactly the timeout. */
	completedLatency: LatencyStats | null;
	/** Total time clients waited on requests that ended in failure, in ms. */
	failedWaitMs: number;
	throughputRps: number;
	successRateRps: number;
	nodes: NodeSummary[];
	links: LinkSummary[];
	faults: FaultSummary[];
	probes: number;
}

export interface TimeSeries {
	windowMs: number;
	startMs: number[];
	offered: number[];
	succeeded: number[];
	failed: number[];
	failedByReason: Record<FailureReason, number[]>;
	p50Ms: Array<number | null>;
	p95Ms: Array<number | null>;
	samples: number[];
	endedP95Ms: Array<number | null>;
	inFlight: number[];
	/** Per node (outer index) per window. Client rows are zero. */
	queueDepth: number[][];
	busy: number[][];
	/** Calls delivered to the node in the window. */
	calls: number[][];
	/** Calls that failed with the node as origin, in the window. */
	nodeFailed: number[][];
	/** Node state at the end of the window. */
	up: boolean[][];
	/** For nodes behind a balancer: in rotation at the end of the window (true otherwise). */
	healthy: boolean[][];
	/** Per edge per window: calls started. */
	linkCalls: number[][];
}

/** State changes with exact times, for bands on charts and the replay. */
export type Transition =
	| {
			tMs: number;
			kind: "down" | "up" | "unhealthy" | "healthy";
			node: number;
			fault: number;
	  }
	| { tMs: number; kind: "fault-start" | "fault-end"; fault: number }
	| {
			tMs: number;
			kind: "breaker";
			edge: number;
			state: "open" | "half-open" | "closed";
	  };

export interface InvariantCheck {
	id:
		| "conservation"
		| "single-terminal"
		| "capacity"
		| "queue-bounds"
		| "monotonic-time";
	passed: boolean;
	/** Translatable detail: a key and parameters. */
	detail: { key: string; params?: Record<string, string | number> };
}

export interface RunMetrics {
	summary: RunSummary;
	series: TimeSeries;
	transitions: Transition[];
	checks: InvariantCheck[];
	/** Non-cryptographic fingerprint of the full event trace (two FNV-1a 32 lanes). */
	traceDigest: string;
	eventCount: number;
}

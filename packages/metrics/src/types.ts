import type {
	FailureReason,
	FaultBehavior,
	RunStatus,
} from "@faultworks/engine";

export const METRIC_DEFINITIONS_VERSION = "0.1.0";

export interface LatencyStats {
	/** Number of samples behind the percentiles. */
	n: number;
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	meanMs: number;
	maxMs: number;
}

export interface ServerSummary {
	id: string;
	label: string;
	routed: number;
	succeeded: number;
	failed: number;
	failedByReason: Record<FailureReason, number>;
	lateResponses: number;
	peakQueue: number;
	peakBusy: number;
	capacity: number;
	queueCapacity: number;
	/** Busy slot-time divided by capacity × measured time, 0–1. */
	utilization: number;
}

export interface FaultSummary {
	id: string;
	serverId: string;
	serverLabel: string;
	behavior: FaultBehavior;
	failedAtMs: number;
	/** `null` when the server stays down until the horizon. */
	recoveredAtMs: number | null;
	/** When the load balancer marked the server unhealthy for this fault; `null` if it never did. */
	detectedAtMs: number | null;
	detectionDelayMs: number | null;
	/** When the load balancer routed to the server again after recovery. */
	restoredAtMs: number | null;
	/** Requests that failed at or because of this server between the crash and detection/recovery. */
	failedWhileUndetected: number;
}

export interface RunSummary {
	status: RunStatus;
	measuredMs: number;
	offered: number;
	/** Requests a backend accepted (started service or joined a queue). */
	admitted: number;
	succeeded: number;
	failed: number;
	failedByReason: Record<FailureReason, number>;
	/** Not terminal at the horizon (censored): neither success nor failure. */
	inFlight: number;
	lateResponses: number;
	/** Latency of successful requests. */
	successLatency: LatencyStats | null;
	/** Latency of all terminal requests; timeouts contribute exactly the timeout. */
	completedLatency: LatencyStats | null;
	/** Terminal requests (success + failure) per simulated second. */
	throughputRps: number;
	/** Successful completions per simulated second (no SLO is declared, so this is not "goodput"). */
	successRateRps: number;
	servers: ServerSummary[];
	faults: FaultSummary[];
	probes: number;
}

export interface TimeSeries {
	windowMs: number;
	/** Window start times in ms. */
	startMs: number[];
	offered: number[];
	succeeded: number[];
	failed: number[];
	failedByReason: Record<FailureReason, number[]>;
	/** Successful-request latency percentiles of completions in the window; null without samples. */
	p50Ms: Array<number | null>;
	p95Ms: Array<number | null>;
	samples: number[];
	/** p95 over every request that ended in the window, failures included (timeouts count as the timeout). */
	endedP95Ms: Array<number | null>;
	/** Requests not yet terminal at the end of the window. */
	inFlight: number[];
	/** Per server (outer index) per window: peak queue depth, peak busy slots, requests routed. */
	queueDepth: number[][];
	busy: number[][];
	routed: number[][];
	/** Per server per window, state at the end of the window. */
	up: boolean[][];
	healthy: boolean[][];
}

/** State changes with exact times, for bands on charts and the playback canvas. */
export interface Transition {
	tMs: number;
	server: number;
	kind: "down" | "up" | "unhealthy" | "healthy";
	fault: number;
}

export interface InvariantCheck {
	id:
		| "conservation"
		| "single-terminal"
		| "capacity"
		| "queue-bounds"
		| "monotonic-time";
	label: string;
	passed: boolean;
	detail: string;
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

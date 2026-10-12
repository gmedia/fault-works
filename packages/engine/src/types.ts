/**
 * Engine contract (v0.1). Everything the engine consumes is already validated and compiled by
 * `@faultworks/experiment`: units are integer microseconds, servers are referenced by index in the
 * order they appear in `servers`, and nothing here knows about React, the DOM or canvas layout.
 */

/** Integer simulated microseconds. Max safe horizon is far beyond the 15-minute product limit. */
export type Micros = number;

export type ArrivalProcess = "constant" | "poisson";
export type ServiceTimeDistribution = "fixed" | "exponential";

/**
 * What a crashed backend does to new connections and probes.
 * - `refuse`: the host is up but the process is gone, so connections fail immediately (RST).
 * - `hang`: the host is unreachable, so connections and probes wait until their timeout.
 */
export type FaultBehavior = "refuse" | "hang";

export type FailureReason =
	| "no-healthy-backend"
	| "backend-refused"
	| "queue-full"
	| "server-crashed"
	| "timeout";

export const FAILURE_REASONS: readonly FailureReason[] = [
	"no-healthy-backend",
	"backend-refused",
	"queue-full",
	"server-crashed",
	"timeout",
];

export interface HealthCheckInput {
	intervalUs: Micros;
	probeTimeoutUs: Micros;
	/** Consecutive failed probes before the LB stops routing to a backend. */
	unhealthyThreshold: number;
	/** Consecutive successful probes before the LB routes to a backend again. */
	healthyThreshold: number;
}

export interface ServerInput {
	id: string;
	/** Concurrent service slots. */
	capacity: number;
	/** FIFO waiting room; 0 means requests are rejected when every slot is busy. */
	queueCapacity: number;
	/** Mean service time. */
	serviceTimeUs: Micros;
	distribution: ServiceTimeDistribution;
}

/** A half-open interval [startUs, endUs) with a constant offered rate. Phases never overlap. */
export interface RatePhase {
	startUs: Micros;
	endUs: Micros;
	rps: number;
}

export interface FaultInput {
	id: string;
	/** Index into `EngineInput.servers`. */
	server: number;
	atUs: Micros;
	recoverAtUs: Micros | null;
	behavior: FaultBehavior;
}

export interface EngineInput {
	seed: number;
	horizonUs: Micros;
	/** Hard ceiling on emitted events so a bad input cannot lock up a browser tab. */
	maxEvents: number;
	/** `null` means the load balancer never checks backends and routes to all of them. */
	healthCheck: HealthCheckInput | null;
	servers: ServerInput[];
	arrival: ArrivalProcess;
	phases: RatePhase[];
	/** Client deadline per request, measured from arrival. */
	timeoutUs: Micros;
	faults: FaultInput[];
}

/**
 * Events in emission order. Emission order is the trace order: the same input, seed and engine
 * version always produce the same sequence. `server` is an index into `EngineInput.servers`.
 */
export type SimEvent =
	| { kind: "arrival"; t: Micros; req: number }
	| { kind: "routed"; t: Micros; req: number; server: number }
	| { kind: "enqueued"; t: Micros; req: number; server: number; depth: number }
	| {
			kind: "service-start";
			t: Micros;
			req: number;
			server: number;
			queuedUs: Micros;
	  }
	| { kind: "service-end"; t: Micros; req: number; server: number }
	| {
			kind: "evicted";
			t: Micros;
			req: number;
			server: number;
			from: "queue" | "service";
	  }
	| {
			kind: "succeeded";
			t: Micros;
			req: number;
			server: number;
			latencyUs: Micros;
	  }
	| {
			kind: "failed";
			t: Micros;
			req: number;
			/** -1 when the request never reached a backend. */
			server: number;
			reason: FailureReason;
			latencyUs: Micros;
	  }
	| { kind: "late-response"; t: Micros; req: number; server: number }
	| { kind: "node-down"; t: Micros; server: number; fault: number }
	| { kind: "node-up"; t: Micros; server: number; fault: number }
	| { kind: "probe"; t: Micros; server: number; ok: boolean }
	| {
			kind: "health-changed";
			t: Micros;
			server: number;
			healthy: boolean;
			/** Index of the fault this change detects or clears, -1 if none was active. */
			fault: number;
	  };

export type SimEventKind = SimEvent["kind"];

export const EVENT_KINDS: readonly SimEventKind[] = [
	"arrival",
	"routed",
	"enqueued",
	"service-start",
	"service-end",
	"evicted",
	"succeeded",
	"failed",
	"late-response",
	"node-down",
	"node-up",
	"probe",
	"health-changed",
];

export type EventSink = (event: SimEvent) => void;

export type RunStatus = "completed" | "event-limit";

export interface EngineRunResult {
	status: RunStatus;
	eventCount: number;
	/** Simulated time the run stopped at: the horizon, or the time of the last event on abort. */
	endUs: Micros;
	requests: number;
}

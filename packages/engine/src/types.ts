/**
 * Engine contract (v0.3). Everything the engine consumes is already validated and compiled by
 * `@faultworks/experiment`: units are integer microseconds and nodes, edges and faults are
 * referenced by index. Nothing here knows about React, the DOM or canvas layout.
 *
 * The model is a directed graph of components. One client sends requests along its outgoing
 * edge; load balancers forward to one downstream; services, caches and databases occupy a slot,
 * do their own work and call their downstream edges in order; queues accept work immediately
 * and process it asynchronously.
 */

/** Integer simulated microseconds. */
export type Micros = number;

export type ArrivalProcess = "constant" | "poisson";
export type ServiceTimeDistribution = "fixed" | "exponential";
export type BalancingAlgorithm = "round-robin" | "least-connections" | "random";

/**
 * What a crashed component does to new connections and probes.
 * - `refuse`: the host is up but the process is gone, so connections fail immediately (RST).
 * - `hang`: the host is unreachable, so connections and probes wait until their timeout.
 */
export type FaultBehavior = "refuse" | "hang";

export type FailureReason =
	| "no-healthy-backend"
	| "refused"
	| "queue-full"
	| "lost-in-crash"
	| "timeout"
	| "circuit-open"
	| "injected-error"
	| "rate-limited"
	| "queue-timeout";

export const FAILURE_REASONS: readonly FailureReason[] = [
	"no-healthy-backend",
	"refused",
	"queue-full",
	"lost-in-crash",
	"timeout",
	"circuit-open",
	"injected-error",
	"rate-limited",
	"queue-timeout",
];

export interface HealthCheckInput {
	intervalUs: Micros;
	probeTimeoutUs: Micros;
	/** Consecutive failed probes before the balancer stops routing to a backend. */
	unhealthyThreshold: number;
	/** Consecutive successful probes before the balancer routes to a backend again. */
	healthyThreshold: number;
}

export interface WorkerInput {
	/** Concurrent service slots (for queues: consumers). */
	capacity: number;
	/** FIFO waiting room; 0 means requests are rejected when every slot is busy. */
	queueCapacity: number;
	/** Mean service time of the component's own work at a concurrency of one. */
	serviceTimeUs: Micros;
	distribution: ServiceTimeDistribution;
	/**
	 * Universal Scalability Law coefficients. With `n` busy slots, own work takes
	 * `1 + contention·(n−1) + coherency·n·(n−1)` times longer: contention is serialization (locks,
	 * a shared log), coherency is the cost of keeping concurrent work consistent. With coherency
	 * above zero, throughput peaks at `sqrt((1 − contention) / coherency)` busy slots and falls
	 * beyond that, which is why a database with too many connections gets slower, not faster.
	 */
	contention: number;
	coherency: number;
	/** A waiting call that is still queued after this long fails with `queue-timeout`. */
	queueTimeoutUs: Micros | null;
	/** `parallel`: call every downstream edge at once and wait for all; fails at the first failure. */
	parallel: boolean;
}

export type NodeInput =
	| { kind: "client"; id: string }
	| {
			kind: "load-balancer";
			id: string;
			algorithm: BalancingAlgorithm;
			/** `null` means the balancer never checks backends and routes to all of them. */
			healthCheck: HealthCheckInput | null;
			/** Extra attempts on another backend when a backend fails a call immediately. */
			retries: number;
	  }
	| ({
			/**
			 * A connection pooler is a worker whose slots are server connections: callers wait in its
			 * queue for a free connection and hold it only while their call to the database runs.
			 */
			kind: "service" | "database" | "pooler";
			id: string;
	  } & WorkerInput)
	| {
			/** Token bucket in front of exactly one downstream: rejects calls over the rate. */
			kind: "rate-limiter";
			id: string;
			ratePerSec: number;
			burst: number;
	  }
	| {
			/**
			 * Routes to a primary (first downstream edge) and replicas (the others): a share of calls
			 * are writes and go to the primary, reads round-robin over the replicas. A crash is noticed
			 * `failoverUs` after it happens; a crashed primary is then replaced by the first replica
			 * that is up, and a recovered node rejoins as a replica.
			 */
			kind: "db-cluster";
			id: string;
			writeRatio: number;
			failoverUs: Micros;
	  }
	| ({
			kind: "cache";
			id: string;
			/** Share of lookups served without calling downstream, 0–1. */
			hitRatio: number;
	  } & WorkerInput)
	| ({
			kind: "queue";
			id: string;
			/**
			 * A queue acknowledges work as soon as it is stored (or rejects it when the backlog is
			 * full) and processes it with `capacity` consumers afterwards.
			 */
	  } & WorkerInput);

export type NodeKind = NodeInput["kind"];

export interface CircuitBreakerInput {
	/** Consecutive failed calls over this edge before it opens. */
	failureThreshold: number;
	/** How long the breaker stays open before letting one trial call through. */
	openUs: Micros;
}

export interface EdgeInput {
	id: string;
	/** Node indexes. */
	source: number;
	target: number;
	/** One-way network latency added to each call and each response. */
	latencyUs: Micros;
	/** Caller gives up on a call after this long; `null` means it waits for the request deadline. */
	timeoutUs: Micros | null;
	/** Extra attempts after a failed call over this edge. */
	retries: number;
	/** Wait before retry k is `retryBackoffUs · 2^(k−1)`, capped at 30 s; 0 retries at once. */
	retryBackoffUs: Micros;
	/** Full jitter: each wait is drawn uniformly between zero and the backoff. */
	retryJitter: boolean;
	/**
	 * Retry budget as a share of first attempts (Finagle style): each first attempt deposits this
	 * much, each retry withdraws one, the balance is capped at 10. `null`: no budget.
	 */
	retryBudget: number | null;
	circuitBreaker: CircuitBreakerInput | null;
}

/** A half-open interval [startUs, endUs) with a constant offered rate. Phases never overlap. */
export interface RatePhase {
	startUs: Micros;
	endUs: Micros;
	rps: number;
}

export type FaultInput =
	| {
			kind: "node-failure";
			id: string;
			node: number;
			atUs: Micros;
			recoverAtUs: Micros | null;
			behavior: FaultBehavior;
	  }
	| {
			/** Own service time is multiplied by `factor` and `addUs` is added. */
			kind: "slowdown";
			id: string;
			node: number;
			atUs: Micros;
			untilUs: Micros | null;
			factor: number;
			addUs: Micros;
			/** Grow linearly from no effect at `atUs` to the full effect at `untilUs`. */
			ramp: boolean;
	  }
	| {
			/** A share of calls arriving at the node fail at once with an injected error. */
			kind: "error-rate";
			id: string;
			node: number;
			atUs: Micros;
			untilUs: Micros | null;
			rate: number;
	  }
	| {
			/** The node's concurrency drops to `capacity` (for example half its instances are gone). */
			kind: "capacity";
			id: string;
			node: number;
			atUs: Micros;
			untilUs: Micros | null;
			capacity: number;
	  }
	| {
			/** Extra one-way latency on an edge. */
			kind: "link-latency";
			id: string;
			edge: number;
			atUs: Micros;
			untilUs: Micros | null;
			addUs: Micros;
	  }
	| {
			/** A share of calls over the edge are lost: they hang until the caller's timeout. */
			kind: "link-loss";
			id: string;
			edge: number;
			atUs: Micros;
			untilUs: Micros | null;
			rate: number;
	  }
	| {
			/** A cache answers nothing from memory while active (cold cache, flush, restart). */
			kind: "cache-flush";
			id: string;
			node: number;
			atUs: Micros;
			untilUs: Micros | null;
	  };

export type FaultKind = FaultInput["kind"];

export interface EngineInput {
	seed: number;
	horizonUs: Micros;
	/** Hard ceiling on emitted events so a bad input cannot lock up a browser tab. */
	maxEvents: number;
	nodes: NodeInput[];
	edges: EdgeInput[];
	/** Index of the client node. */
	client: number;
	arrival: ArrivalProcess;
	phases: RatePhase[];
	/** Client deadline per request, measured from arrival. */
	timeoutUs: Micros;
	/**
	 * The deadline travels with every call. Components then refuse work for requests whose client
	 * already gave up instead of doing it and discarding the answer.
	 */
	propagateDeadline: boolean;
	faults: FaultInput[];
}

/**
 * Events in emission order. Emission order is the trace order: the same input, seed and engine
 * version always produce the same sequence.
 *
 * `req` identifies an end-to-end client request; `call` identifies one hop (one attempt over one
 * edge) that belongs to a request; `job` identifies asynchronous work a queue processes after it
 * acknowledged the call that stored it.
 */
export type SimEvent =
	| { kind: "arrival"; t: Micros; req: number }
	| { kind: "succeeded"; t: Micros; req: number; latencyUs: Micros }
	| {
			kind: "failed";
			t: Micros;
			req: number;
			reason: FailureReason;
			/** Node where the failure originated, -1 when the client itself gave up. */
			node: number;
			latencyUs: Micros;
	  }
	| { kind: "late-response"; t: Micros; req: number; node: number }
	| {
			kind: "call-start";
			t: Micros;
			req: number;
			call: number;
			edge: number;
			/** 1 for the first try. */
			attempt: number;
	  }
	| {
			kind: "call-end";
			t: Micros;
			req: number;
			call: number;
			edge: number;
			ok: boolean;
			reason: FailureReason | null;
			latencyUs: Micros;
	  }
	| {
			kind: "routed";
			t: Micros;
			req: number;
			call: number;
			node: number;
			/** Backend chosen by the balancer. */
			to: number;
	  }
	| {
			kind: "enqueued";
			t: Micros;
			req: number;
			call: number;
			node: number;
			depth: number;
	  }
	| {
			kind: "service-start";
			t: Micros;
			req: number;
			call: number;
			node: number;
			queuedUs: Micros;
			/** Own work this call will take, after slowdowns and contention. */
			workUs: Micros;
	  }
	| { kind: "service-end"; t: Micros; req: number; call: number; node: number }
	| {
			kind: "evicted";
			t: Micros;
			req: number;
			call: number;
			node: number;
			from: "queue" | "service";
	  }
	| {
			/** A waiting call left the queue without being served. */
			kind: "abandoned";
			t: Micros;
			req: number;
			call: number;
			node: number;
			reason: "queue-timeout" | "deadline";
	  }
	| {
			/** A database cluster made `to` its primary after `from` was found down. */
			kind: "promoted";
			t: Micros;
			node: number;
			from: number;
			to: number;
	  }
	| {
			kind: "cache-hit";
			t: Micros;
			req: number;
			call: number;
			node: number;
			hit: boolean;
	  }
	| {
			kind: "job-start";
			t: Micros;
			req: number;
			job: number;
			node: number;
			/** Time the job waited in the backlog before a consumer picked it up. */
			waitedUs: Micros;
	  }
	| {
			kind: "job-done";
			t: Micros;
			req: number;
			job: number;
			node: number;
			ok: boolean;
	  }
	| { kind: "node-down"; t: Micros; node: number; fault: number }
	| { kind: "node-up"; t: Micros; node: number; fault: number }
	| { kind: "fault-start"; t: Micros; fault: number }
	| { kind: "fault-end"; t: Micros; fault: number }
	| { kind: "probe"; t: Micros; node: number; from: number; ok: boolean }
	| {
			kind: "health-changed";
			t: Micros;
			node: number;
			from: number;
			healthy: boolean;
			/** Index of the fault this change detects or clears, -1 if none was active. */
			fault: number;
	  }
	| {
			kind: "breaker";
			t: Micros;
			edge: number;
			state: "open" | "half-open" | "closed";
	  };

export type SimEventKind = SimEvent["kind"];

export const EVENT_KINDS: readonly SimEventKind[] = [
	"arrival",
	"succeeded",
	"failed",
	"late-response",
	"call-start",
	"call-end",
	"routed",
	"enqueued",
	"service-start",
	"service-end",
	"evicted",
	"abandoned",
	"promoted",
	"cache-hit",
	"job-start",
	"job-done",
	"node-down",
	"node-up",
	"fault-start",
	"fault-end",
	"probe",
	"health-changed",
	"breaker",
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

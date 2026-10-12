/**
 * One vocabulary for field names, units and help text, shared by the editor, the semantic diff,
 * exports and docs, so the same setting is never called two different things.
 */

export type Unit = "ms" | "req/s" | "requests" | "slots" | "probes" | null;

export interface FieldInfo {
	label: string;
	unit: Unit;
	help: string;
}

export const SERVER_FIELDS = {
	capacity: {
		label: "Concurrency",
		unit: "slots",
		help: "How many requests the server works on at the same time.",
	},
	queueCapacity: {
		label: "Queue size",
		unit: "requests",
		help: "Requests that may wait for a free slot. When the queue is full, new requests are rejected.",
	},
	serviceTimeMs: {
		label: "Service time",
		unit: "ms",
		help: "Time one request occupies a slot. With an exponential distribution this is the mean.",
	},
	serviceTimeDistribution: {
		label: "Service time distribution",
		unit: null,
		help: "Fixed gives every request the same service time. Exponential draws a random time per request from the seed.",
	},
} satisfies Record<string, FieldInfo>;

export const HEALTH_CHECK_FIELDS = {
	enabled: {
		label: "Health checks",
		unit: null,
		help: "When off, the load balancer keeps routing to every backend, even dead ones.",
	},
	intervalMs: {
		label: "Probe interval",
		unit: "ms",
		help: "Time between probes to each backend. Longer intervals detect failures later.",
	},
	probeTimeoutMs: {
		label: "Probe timeout",
		unit: "ms",
		help: "How long a probe to a hanging backend waits before counting as failed. Refused probes fail at once.",
	},
	unhealthyThreshold: {
		label: "Unhealthy after",
		unit: "probes",
		help: "Consecutive failed probes before the backend is taken out of rotation.",
	},
	healthyThreshold: {
		label: "Healthy after",
		unit: "probes",
		help: "Consecutive successful probes before a recovered backend gets traffic again.",
	},
} satisfies Record<string, FieldInfo>;

export const WORKLOAD_FIELDS = {
	arrival: {
		label: "Arrival pattern",
		unit: null,
		help: "Constant sends requests at exact intervals. Poisson draws random gaps from the seed with the same average rate.",
	},
	offeredRps: {
		label: "Offered rate",
		unit: "req/s",
		help: "Requests the client sends per second, whether or not they succeed.",
	},
	startMs: {
		label: "Traffic starts at",
		unit: "ms",
		help: "Simulated time when the client starts sending.",
	},
	durationMs: {
		label: "Traffic duration",
		unit: "ms",
		help: "How long the client keeps sending at the offered rate.",
	},
	timeoutMs: {
		label: "Client timeout",
		unit: "ms",
		help: "A request without a response after this long counts as failed. A response arriving later is discarded.",
	},
} satisfies Record<string, FieldInfo>;

export const BURST_FIELDS = {
	atMs: {
		label: "Burst starts at",
		unit: "ms",
		help: "Simulated time the extra traffic begins.",
	},
	durationMs: {
		label: "Burst length",
		unit: "ms",
		help: "How long the extra traffic lasts.",
	},
	extraRps: {
		label: "Extra rate",
		unit: "req/s",
		help: "Added on top of the offered rate during the burst.",
	},
} satisfies Record<string, FieldInfo>;

export const FAULT_FIELDS = {
	target: { label: "Server", unit: null, help: "The backend that fails." },
	atMs: {
		label: "Fails at",
		unit: "ms",
		help: "Simulated time the server crashes.",
	},
	recoverAtMs: {
		label: "Recovers at",
		unit: "ms",
		help: "Simulated time the server comes back with an empty queue. Leave empty to keep it down.",
	},
	behavior: {
		label: "Failure behavior",
		unit: null,
		help: "Refuse: connections are rejected at once (process crashed). Hang: connections get no answer until the client gives up (host unreachable).",
	},
} satisfies Record<string, FieldInfo>;

export const RUN_FIELDS = {
	seed: {
		label: "Seed",
		unit: null,
		help: "Same seed, same inputs and same engine version always give identical results.",
	},
	horizonMs: {
		label: "Horizon",
		unit: "ms",
		help: "Simulated time the run stops. By default: end of traffic plus one client timeout.",
	},
	sampleWindowMs: {
		label: "Chart window",
		unit: "ms",
		help: "Width of the time buckets used for charts. Does not change the simulation.",
	},
} satisfies Record<string, FieldInfo>;

export const BEHAVIOR_LABELS = {
	refuse: "Refuse connections",
	hang: "Hang (no response)",
} as const;

export const ARRIVAL_LABELS = {
	constant: "Constant",
	poisson: "Poisson (random)",
} as const;

export const DISTRIBUTION_LABELS = {
	fixed: "Fixed",
	exponential: "Exponential (random)",
} as const;

export function formatValue(value: unknown, unit: Unit): string {
	if (value === null || value === undefined) return "none";
	if (typeof value === "boolean") return value ? "on" : "off";
	if (typeof value === "number") {
		const n = value.toLocaleString("en-US", { maximumFractionDigits: 3 });
		return unit ? `${n} ${unit}` : n;
	}
	return String(value);
}

import { z } from "zod";

export const SCHEMA_VERSION = "0.1.0";

/** Product limits. They keep a run inside a browser tab's budget and are part of the contract. */
export const LIMITS = {
	maxNodes: 10,
	maxServers: 8,
	maxLinks: 20,
	maxFaults: 10,
	maxBursts: 10,
	maxHorizonMs: 15 * 60 * 1000,
	maxOfferedRequests: 250_000,
	maxEvents: 3_000_000,
	maxImportBytes: 512 * 1024,
	maxRps: 5000,
} as const;

const idPattern = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const nodeIdSchema = z
	.string()
	.regex(
		idPattern,
		"Use 1–48 lowercase letters, digits or hyphens, starting with a letter or digit",
	);

const label = z.string().trim().min(1).max(40).optional();

const intMs = (min: number, max: number, what: string) =>
	z
		.number({ error: `${what} must be a number of milliseconds` })
		.int(`${what} must be a whole number of milliseconds`)
		.min(min, `${what} must be at least ${min} ms`)
		.max(max, `${what} must be at most ${max} ms`);

export const healthCheckSchema = z.strictObject({
	enabled: z.boolean(),
	intervalMs: intMs(100, 60_000, "Probe interval"),
	probeTimeoutMs: intMs(10, 30_000, "Probe timeout"),
	unhealthyThreshold: z
		.number()
		.int()
		.min(1, "Unhealthy threshold must be at least 1 probe")
		.max(10, "Unhealthy threshold must be at most 10 probes"),
	healthyThreshold: z
		.number()
		.int()
		.min(1, "Healthy threshold must be at least 1 probe")
		.max(10, "Healthy threshold must be at most 10 probes"),
});

export const clientNodeSchema = z.strictObject({
	id: nodeIdSchema,
	kind: z.literal("client"),
	label,
});

export const loadBalancerNodeSchema = z.strictObject({
	id: nodeIdSchema,
	kind: z.literal("load-balancer"),
	label,
	config: z.strictObject({
		algorithm: z.literal("round-robin", {
			error: "Only round-robin balancing is modeled in v0.1",
		}),
		healthCheck: healthCheckSchema,
	}),
});

export const serverNodeSchema = z.strictObject({
	id: nodeIdSchema,
	kind: z.literal("server"),
	label,
	config: z.strictObject({
		capacity: z
			.number()
			.int("Concurrency must be a whole number of slots")
			.min(1, "Concurrency must be at least 1 slot")
			.max(1000, "Concurrency must be at most 1000 slots"),
		queueCapacity: z
			.number()
			.int("Queue size must be a whole number of requests")
			.min(0, "Queue size cannot be negative")
			.max(10_000, "Queue size must be at most 10000 requests"),
		serviceTimeMs: z
			.number({ error: "Service time must be a number of milliseconds" })
			.min(0.001, "Service time must be greater than 0 ms")
			.max(60_000, "Service time must be at most 60000 ms"),
		serviceTimeDistribution: z.enum(["fixed", "exponential"]),
	}),
});

export const nodeSchema = z.discriminatedUnion("kind", [
	clientNodeSchema,
	loadBalancerNodeSchema,
	serverNodeSchema,
]);

export const linkSchema = z.strictObject({
	source: nodeIdSchema,
	target: nodeIdSchema,
});

const rps = (what: string) =>
	z
		.number({ error: `${what} must be a number of requests per second` })
		.gt(0, `${what} must be greater than 0 req/s`)
		.max(LIMITS.maxRps, `${what} must be at most ${LIMITS.maxRps} req/s`);

export const burstSchema = z.strictObject({
	atMs: intMs(0, LIMITS.maxHorizonMs, "Burst start"),
	durationMs: intMs(1, LIMITS.maxHorizonMs, "Burst length"),
	extraRps: rps("Extra burst rate"),
});

export const workloadSchema = z.strictObject({
	arrival: z.enum(["constant", "poisson"]),
	offeredRps: rps("Offered rate"),
	startMs: intMs(0, LIMITS.maxHorizonMs, "Traffic start"),
	durationMs: intMs(1, LIMITS.maxHorizonMs, "Traffic duration"),
	timeoutMs: intMs(1, 300_000, "Client timeout"),
	bursts: z.array(burstSchema).max(LIMITS.maxBursts),
});

export const faultSchema = z.strictObject({
	id: nodeIdSchema,
	kind: z.literal("node-failure", {
		error: "Only node-failure faults are modeled in v0.1",
	}),
	target: nodeIdSchema,
	atMs: intMs(0, LIMITS.maxHorizonMs, "Failure time"),
	recoverAtMs: intMs(1, LIMITS.maxHorizonMs, "Recovery time").nullable(),
	behavior: z.enum(["refuse", "hang"]),
});

export const runSettingsSchema = z.strictObject({
	/** Omitted: traffic end plus one client timeout, so late requests can finish. */
	horizonMs: intMs(1, LIMITS.maxHorizonMs, "Horizon").optional(),
	sampleWindowMs: intMs(100, 60_000, "Sample window"),
});

const text = (max: number) => z.string().max(max);

export const experimentSchema = z.strictObject({
	schemaVersion: z.literal(SCHEMA_VERSION),
	experimentId: nodeIdSchema,
	title: z.string().trim().min(1, "Give the experiment a title").max(120),
	question: text(300),
	description: text(2000),
	seed: z
		.number({ error: "Seed must be a whole number" })
		.int("Seed must be a whole number")
		.min(0, "Seed cannot be negative")
		.max(4_294_967_295, "Seed must fit in 32 bits (max 4294967295)"),
	model: z.strictObject({
		nodes: z.array(nodeSchema).max(LIMITS.maxNodes),
		links: z.array(linkSchema).max(LIMITS.maxLinks),
	}),
	workload: workloadSchema,
	faults: z.array(faultSchema).max(LIMITS.maxFaults),
	run: runSettingsSchema,
	assumptions: z.array(text(300)).max(20),
	expectedObservations: z.array(text(300)).max(20),
	layout: z
		.record(
			z.string(),
			z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
		)
		.optional(),
});

export type Experiment = z.infer<typeof experimentSchema>;
export type ExperimentNode = z.infer<typeof nodeSchema>;
export type ClientNode = z.infer<typeof clientNodeSchema>;
export type LoadBalancerNode = z.infer<typeof loadBalancerNodeSchema>;
export type ServerNode = z.infer<typeof serverNodeSchema>;
export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type Workload = z.infer<typeof workloadSchema>;
export type Burst = z.infer<typeof burstSchema>;
export type Fault = z.infer<typeof faultSchema>;
export type Link = z.infer<typeof linkSchema>;
export type RunSettings = z.infer<typeof runSettingsSchema>;

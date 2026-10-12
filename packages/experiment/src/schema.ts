import { z } from "zod";
import { msg } from "./messages.ts";

export const SCHEMA_VERSION = "0.3.0";

/** Product limits. They keep a run inside a browser tab's budget and are part of the contract. */
export const LIMITS = {
	maxNodes: 12,
	maxLinks: 24,
	maxFaults: 12,
	maxBursts: 10,
	maxHorizonMs: 15 * 60 * 1000,
	maxOfferedRequests: 250_000,
	maxEvents: 3_000_000,
	maxImportBytes: 512 * 1024,
	maxRps: 5000,
} as const;

const idPattern = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const idSchema = z.string().regex(idPattern, msg("validation.id"));

const label = z.string().trim().min(1).max(40).optional();

/**
 * Catalog presets (CDN, API gateway, …) are starting points built on a node kind. The preset only
 * names the component and picks its icon and defaults; it never changes behavior.
 */
export const PRESET_IDS = [
	"cdn",
	"api-gateway",
	"web-server",
	"external-api",
	"object-storage",
	"search-engine",
	"message-broker",
] as const;
const preset = z.enum(PRESET_IDS).optional();

/** Field keys name the translation of a setting's label; messages refer to them. */
const num = (
	field: string,
	opts: {
		int?: boolean;
		min?: number;
		max?: number;
		gt?: number;
		unit?: string;
	},
) => {
	const p = { field, unit: opts.unit ?? null };
	let s = z.number({ error: msg("validation.number", p) });
	if (opts.int) s = s.int(msg("validation.integer", p));
	if (opts.gt !== undefined)
		s = s.gt(opts.gt, msg("validation.gt", { ...p, value: opts.gt }));
	if (opts.min !== undefined)
		s = s.min(opts.min, msg("validation.min", { ...p, value: opts.min }));
	if (opts.max !== undefined)
		s = s.max(opts.max, msg("validation.max", { ...p, value: opts.max }));
	return s;
};
const ms = (field: string, min: number, max: number) =>
	num(field, { int: true, min, max, unit: "ms" });
const rate = (field: string) => num(field, { min: 0, max: 1 });

export const healthCheckSchema = z.strictObject({
	enabled: z.boolean(),
	intervalMs: ms("healthCheck.intervalMs", 100, 60_000),
	probeTimeoutMs: ms("healthCheck.probeTimeoutMs", 10, 30_000),
	unhealthyThreshold: num("healthCheck.unhealthyThreshold", {
		int: true,
		min: 1,
		max: 10,
		unit: "probes",
	}),
	healthyThreshold: num("healthCheck.healthyThreshold", {
		int: true,
		min: 1,
		max: 10,
		unit: "probes",
	}),
});

export const workerConfigSchema = z.strictObject({
	capacity: num("worker.capacity", {
		int: true,
		min: 1,
		max: 10_000,
		unit: "slots",
	}),
	queueCapacity: num("worker.queueCapacity", {
		int: true,
		min: 0,
		max: 1_000_000,
		unit: "requests",
	}),
	serviceTimeMs: num("worker.serviceTimeMs", {
		gt: 0,
		max: 60_000,
		unit: "ms",
	}),
	serviceTimeDistribution: z.enum(["fixed", "exponential"]),
	contention: num("worker.contention", { min: 0, max: 1 }),
	coherency: num("worker.coherency", { min: 0, max: 0.1 }),
	queueTimeoutMs: ms("worker.queueTimeoutMs", 1, 300_000).nullable(),
	callMode: z.enum(["sequential", "parallel"]),
});

export const clientNodeSchema = z.strictObject({
	id: idSchema,
	kind: z.literal("client"),
	label,
	preset,
});

export const loadBalancerNodeSchema = z.strictObject({
	id: idSchema,
	kind: z.literal("load-balancer"),
	label,
	preset,
	config: z.strictObject({
		algorithm: z.enum(["round-robin", "least-connections", "random"]),
		retries: num("balancer.retries", {
			int: true,
			min: 0,
			max: 5,
			unit: "attempts",
		}),
		healthCheck: healthCheckSchema,
	}),
});

export const serviceNodeSchema = z.strictObject({
	id: idSchema,
	kind: z.enum(["service", "database", "pooler"]),
	label,
	preset,
	config: workerConfigSchema,
});

export const cacheNodeSchema = z.strictObject({
	id: idSchema,
	kind: z.literal("cache"),
	label,
	preset,
	config: workerConfigSchema.extend({ hitRatio: rate("cache.hitRatio") }),
});

export const queueNodeSchema = z.strictObject({
	id: idSchema,
	kind: z.literal("queue"),
	label,
	preset,
	config: workerConfigSchema,
});

export const rateLimiterNodeSchema = z.strictObject({
	id: idSchema,
	kind: z.literal("rate-limiter"),
	label,
	preset,
	config: z.strictObject({
		ratePerSec: num("limiter.ratePerSec", {
			gt: 0,
			max: 100_000,
			unit: "req/s",
		}),
		burst: num("limiter.burst", {
			int: true,
			min: 1,
			max: 100_000,
			unit: "requests",
		}),
	}),
});

export const dbClusterNodeSchema = z.strictObject({
	id: idSchema,
	kind: z.literal("db-cluster"),
	label,
	preset,
	config: z.strictObject({
		writeRatio: rate("cluster.writeRatio"),
		failoverMs: ms("cluster.failoverMs", 0, 600_000),
	}),
});

export const nodeSchema = z.union([
	clientNodeSchema,
	loadBalancerNodeSchema,
	serviceNodeSchema,
	cacheNodeSchema,
	queueNodeSchema,
	rateLimiterNodeSchema,
	dbClusterNodeSchema,
]);

export const circuitBreakerSchema = z.strictObject({
	enabled: z.boolean(),
	failureThreshold: num("breaker.failureThreshold", {
		int: true,
		min: 1,
		max: 100,
		unit: "calls",
	}),
	openMs: ms("breaker.openMs", 10, 600_000),
});

export const linkSchema = z.strictObject({
	id: idSchema,
	source: idSchema,
	target: idSchema,
	latencyMs: num("link.latencyMs", { min: 0, max: 10_000, unit: "ms" }),
	timeoutMs: ms("link.timeoutMs", 1, 300_000).nullable(),
	retries: num("link.retries", {
		int: true,
		min: 0,
		max: 10,
		unit: "attempts",
	}),
	retryBackoffMs: num("link.retryBackoffMs", {
		min: 0,
		max: 60_000,
		unit: "ms",
	}),
	retryJitter: z.boolean(),
	retryBudget: rate("link.retryBudget").nullable(),
	circuitBreaker: circuitBreakerSchema,
});

const rps = (field: string) =>
	num(field, { gt: 0, max: LIMITS.maxRps, unit: "req/s" });

export const burstSchema = z.strictObject({
	atMs: ms("burst.atMs", 0, LIMITS.maxHorizonMs),
	durationMs: ms("burst.durationMs", 1, LIMITS.maxHorizonMs),
	extraRps: rps("burst.extraRps"),
});

export const workloadSchema = z.strictObject({
	arrival: z.enum(["constant", "poisson"]),
	offeredRps: rps("workload.offeredRps"),
	startMs: ms("workload.startMs", 0, LIMITS.maxHorizonMs),
	durationMs: ms("workload.durationMs", 1, LIMITS.maxHorizonMs),
	timeoutMs: ms("workload.timeoutMs", 1, 300_000),
	propagateDeadline: z.boolean(),
	bursts: z.array(burstSchema).max(LIMITS.maxBursts),
});

const faultBase = {
	id: idSchema,
	target: idSchema,
	atMs: ms("fault.atMs", 0, LIMITS.maxHorizonMs),
};
const untilMs = ms("fault.untilMs", 1, LIMITS.maxHorizonMs).nullable();

export const faultSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		...faultBase,
		kind: z.literal("node-failure"),
		recoverAtMs: ms("fault.recoverAtMs", 1, LIMITS.maxHorizonMs).nullable(),
		behavior: z.enum(["refuse", "hang"]),
	}),
	z.strictObject({
		...faultBase,
		kind: z.literal("slowdown"),
		untilMs,
		factor: num("fault.factor", { min: 1, max: 100 }),
		addMs: num("fault.addMs", { min: 0, max: 60_000, unit: "ms" }),
		ramp: z.boolean(),
	}),
	z.strictObject({
		...faultBase,
		kind: z.literal("error-rate"),
		untilMs,
		rate: rate("fault.rate"),
	}),
	z.strictObject({
		...faultBase,
		kind: z.literal("capacity"),
		untilMs,
		capacity: num("fault.capacity", {
			int: true,
			min: 0,
			max: 10_000,
			unit: "slots",
		}),
	}),
	z.strictObject({
		...faultBase,
		kind: z.literal("link-latency"),
		untilMs,
		addMs: num("fault.addMs", { min: 0, max: 60_000, unit: "ms" }),
	}),
	z.strictObject({
		...faultBase,
		kind: z.literal("link-loss"),
		untilMs,
		rate: rate("fault.rate"),
	}),
	z.strictObject({ ...faultBase, kind: z.literal("cache-flush"), untilMs }),
]);

export const runSettingsSchema = z.strictObject({
	/** Omitted: traffic end plus one client timeout, so late requests can finish. */
	horizonMs: ms("run.horizonMs", 1, LIMITS.maxHorizonMs).optional(),
	sampleWindowMs: ms("run.sampleWindowMs", 100, 60_000),
});

const text = (max: number) => z.string().max(max);

export const experimentSchema = z.strictObject({
	schemaVersion: z.literal(SCHEMA_VERSION),
	experimentId: idSchema,
	title: z.string().trim().min(1, msg("validation.title")).max(120),
	question: text(300),
	description: text(2000),
	seed: num("run.seed", { int: true, min: 0, max: 4_294_967_295 }),
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
export type NodeKind = ExperimentNode["kind"];
export type ClientNode = z.infer<typeof clientNodeSchema>;
export type LoadBalancerNode = z.infer<typeof loadBalancerNodeSchema>;
export type ServiceNode = z.infer<typeof serviceNodeSchema>;
export type CacheNode = z.infer<typeof cacheNodeSchema>;
export type QueueNode = z.infer<typeof queueNodeSchema>;
export type RateLimiterNode = z.infer<typeof rateLimiterNodeSchema>;
export type DbClusterNode = z.infer<typeof dbClusterNodeSchema>;
export type PresetId = (typeof PRESET_IDS)[number];
export type WorkerNode = ServiceNode | CacheNode | QueueNode;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export type HealthCheck = z.infer<typeof healthCheckSchema>;
export type CircuitBreaker = z.infer<typeof circuitBreakerSchema>;
export type Link = z.infer<typeof linkSchema>;
export type Workload = z.infer<typeof workloadSchema>;
export type Burst = z.infer<typeof burstSchema>;
export type Fault = z.infer<typeof faultSchema>;
export type FaultKind = Fault["kind"];
export type RunSettings = z.infer<typeof runSettingsSchema>;

export const WORKER_KINDS: readonly NodeKind[] = [
	"service",
	"database",
	"pooler",
	"cache",
	"queue",
];
export const NODE_FAULT_KINDS: readonly FaultKind[] = [
	"node-failure",
	"slowdown",
	"error-rate",
	"capacity",
	"cache-flush",
];
export const LINK_FAULT_KINDS: readonly FaultKind[] = [
	"link-latency",
	"link-loss",
];

export function isWorker(node: ExperimentNode): node is WorkerNode {
	return WORKER_KINDS.includes(node.kind);
}

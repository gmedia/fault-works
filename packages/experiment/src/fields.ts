/**
 * The vocabulary of settings. Each field has a key (its translation id), a unit and sometimes
 * options. The app translates `fields.<key>.label` and `fields.<key>.help`; the diff, exports
 * and docs refer to the same keys so one setting is never called two different things.
 */

export type Unit =
	| "ms"
	| "req/s"
	| "requests"
	| "slots"
	| "probes"
	| "attempts"
	| "calls"
	| "%"
	| "x"
	| null;

export interface FieldInfo {
	key: string;
	unit: Unit;
	/** Enum values, translated as `options.<key>.<value>`. */
	options?: readonly string[];
}

const f = (
	key: string,
	unit: Unit = null,
	options?: readonly string[],
): FieldInfo => ({ key, unit, options });

export const FIELDS = {
	"worker.capacity": f("worker.capacity", "slots"),
	"worker.queueCapacity": f("worker.queueCapacity", "requests"),
	"worker.serviceTimeMs": f("worker.serviceTimeMs", "ms"),
	"worker.serviceTimeDistribution": f("worker.serviceTimeDistribution", null, [
		"fixed",
		"exponential",
	]),
	"worker.contention": f("worker.contention"),
	"worker.coherency": f("worker.coherency"),
	"worker.queueTimeoutMs": f("worker.queueTimeoutMs", "ms"),
	"worker.callMode": f("worker.callMode", null, ["sequential", "parallel"]),
	"pooler.poolSize": f("pooler.poolSize", "slots"),
	"pooler.maxWaiting": f("pooler.maxWaiting", "requests"),
	"pooler.waitTimeoutMs": f("pooler.waitTimeoutMs", "ms"),
	"database.maxConnections": f("database.maxConnections", "slots"),
	"limiter.ratePerSec": f("limiter.ratePerSec", "req/s"),
	"limiter.burst": f("limiter.burst", "requests"),
	"cluster.writeRatio": f("cluster.writeRatio", "%"),
	"cluster.failoverMs": f("cluster.failoverMs", "ms"),
	"queue.consumers": f("queue.consumers", "slots"),
	"queue.backlog": f("queue.backlog", "requests"),
	"cache.hitRatio": f("cache.hitRatio", "%"),
	"balancer.algorithm": f("balancer.algorithm", null, [
		"round-robin",
		"least-connections",
		"random",
	]),
	"balancer.retries": f("balancer.retries", "attempts"),
	"healthCheck.enabled": f("healthCheck.enabled"),
	"healthCheck.intervalMs": f("healthCheck.intervalMs", "ms"),
	"healthCheck.probeTimeoutMs": f("healthCheck.probeTimeoutMs", "ms"),
	"healthCheck.unhealthyThreshold": f(
		"healthCheck.unhealthyThreshold",
		"probes",
	),
	"healthCheck.healthyThreshold": f("healthCheck.healthyThreshold", "probes"),
	"link.latencyMs": f("link.latencyMs", "ms"),
	"link.timeoutMs": f("link.timeoutMs", "ms"),
	"link.retries": f("link.retries", "attempts"),
	"link.retryBackoffMs": f("link.retryBackoffMs", "ms"),
	"link.retryJitter": f("link.retryJitter"),
	"link.retryBudget": f("link.retryBudget", "%"),
	"breaker.enabled": f("breaker.enabled"),
	"breaker.failureThreshold": f("breaker.failureThreshold", "calls"),
	"breaker.openMs": f("breaker.openMs", "ms"),
	"workload.arrival": f("workload.arrival", null, ["constant", "poisson"]),
	"workload.offeredRps": f("workload.offeredRps", "req/s"),
	"workload.startMs": f("workload.startMs", "ms"),
	"workload.durationMs": f("workload.durationMs", "ms"),
	"workload.timeoutMs": f("workload.timeoutMs", "ms"),
	"workload.propagateDeadline": f("workload.propagateDeadline"),
	"burst.atMs": f("burst.atMs", "ms"),
	"burst.durationMs": f("burst.durationMs", "ms"),
	"burst.extraRps": f("burst.extraRps", "req/s"),
	"fault.kind": f("fault.kind", null, [
		"node-failure",
		"slowdown",
		"error-rate",
		"capacity",
		"link-latency",
		"link-loss",
		"cache-flush",
	]),
	"fault.target": f("fault.target"),
	"fault.atMs": f("fault.atMs", "ms"),
	"fault.recoverAtMs": f("fault.recoverAtMs", "ms"),
	"fault.untilMs": f("fault.untilMs", "ms"),
	"fault.behavior": f("fault.behavior", null, ["refuse", "hang"]),
	"fault.factor": f("fault.factor", "x"),
	"fault.addMs": f("fault.addMs", "ms"),
	"fault.ramp": f("fault.ramp"),
	"fault.rate": f("fault.rate", "%"),
	"fault.capacity": f("fault.capacity", "slots"),
	"run.seed": f("run.seed"),
	"run.horizonMs": f("run.horizonMs", "ms"),
	"run.sampleWindowMs": f("run.sampleWindowMs", "ms"),
} as const satisfies Record<string, FieldInfo>;

export type FieldKey = keyof typeof FIELDS;

/** Which fields each fault kind has, in display order (besides id, target and atMs). */
export const FAULT_FIELDS: Record<string, FieldKey[]> = {
	"node-failure": ["fault.recoverAtMs", "fault.behavior"],
	slowdown: ["fault.untilMs", "fault.factor", "fault.addMs", "fault.ramp"],
	"error-rate": ["fault.untilMs", "fault.rate"],
	capacity: ["fault.untilMs", "fault.capacity"],
	"link-latency": ["fault.untilMs", "fault.addMs"],
	"link-loss": ["fault.untilMs", "fault.rate"],
	"cache-flush": ["fault.untilMs"],
};

/** A value as the diff and exports show it; the app may re-format with its own locale. */
export function formatValue(value: unknown, unit: Unit): string {
	if (value === null || value === undefined) return "–";
	if (typeof value === "boolean") return value ? "on" : "off";
	if (typeof value === "number") {
		if (unit === "%")
			return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
		const n = value.toLocaleString("en-US", { maximumFractionDigits: 3 });
		return unit && unit !== "x" ? `${n} ${unit}` : unit === "x" ? `${n}×` : n;
	}
	return String(value);
}

import { SCHEMA_VERSION } from "./schema.ts";

export type MigrationResult =
	| { ok: true; value: unknown; from: string | null }
	| { ok: false; key: string; params?: Record<string, string> };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * `0.1.0-proposal` is the shape of the planning-phase example. Changes to 0.1.0:
 * - `healthCheck.failureThreshold` → `unhealthyThreshold`; `healthyThreshold` added (default 2).
 * - server `serviceTimeDistribution` added (`fixed`).
 * - workload `kind: "constant-rate"` → `arrival: "constant"`; `bursts` (`[]`) added.
 * - fault `behavior` added (`refuse`), `recoverAtMs` defaults to `null`.
 * - `run` settings added; `description`, `assumptions`, `expectedObservations` default to empty.
 */
function fromProposal(input: Json): Json {
	const out: Json = structuredClone(input);
	out.schemaVersion = "0.1.0";
	out.description ??= "";
	out.question ??= "";
	out.assumptions ??= [];
	out.expectedObservations ??= [];
	out.run ??= { sampleWindowMs: 1000 };

	const model = isObject(out.model) ? out.model : undefined;
	const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
	for (const node of nodes) {
		if (!isObject(node) || !isObject(node.config)) continue;
		const config = node.config;
		if (node.kind === "load-balancer" && isObject(config.healthCheck)) {
			const hc = config.healthCheck;
			if ("failureThreshold" in hc) {
				hc.unhealthyThreshold ??= hc.failureThreshold;
				delete hc.failureThreshold;
			}
			hc.healthyThreshold ??= 2;
		}
		if (node.kind === "server") config.serviceTimeDistribution ??= "fixed";
	}

	if (isObject(out.workload)) {
		if (out.workload.kind === "constant-rate") {
			out.workload.arrival ??= "constant";
			delete out.workload.kind;
		}
		out.workload.arrival ??= "constant";
		out.workload.bursts ??= [];
	}
	if (Array.isArray(out.faults))
		for (const fault of out.faults) {
			if (!isObject(fault)) continue;
			fault.behavior ??= "refuse";
			fault.recoverAtMs ??= null;
		}
	return out;
}

/**
 * 0.1.0 → 0.2.0: the fixed client/load balancer/servers shape becomes a general graph.
 * - `server` nodes become `service` nodes with the same config.
 * - the load balancer gets `retries: 0`; `algorithm` is unchanged.
 * - links get an id, zero latency, no timeout, no retries and a disabled circuit breaker.
 * - `node-failure` faults are unchanged (other fault kinds did not exist).
 */
function fromV1(input: Json): Json {
	const out: Json = structuredClone(input);
	out.schemaVersion = "0.2.0";
	const model = isObject(out.model) ? out.model : undefined;
	if (model) {
		if (Array.isArray(model.nodes))
			for (const node of model.nodes) {
				if (!isObject(node)) continue;
				if (node.kind === "server") node.kind = "service";
				if (node.kind === "load-balancer" && isObject(node.config))
					node.config.retries ??= 0;
			}
		if (Array.isArray(model.links))
			model.links = model.links.map((link) =>
				isObject(link)
					? {
							id:
								typeof link.id === "string"
									? link.id
									: `${String(link.source)}-${String(link.target)}`,
							source: link.source,
							target: link.target,
							latencyMs: 0,
							timeoutMs: null,
							retries: 0,
							circuitBreaker: {
								enabled: false,
								failureThreshold: 5,
								openMs: 10_000,
							},
						}
					: link,
			);
	}
	return out;
}

const MIGRATIONS: Record<string, { to: string; step: (input: Json) => Json }> =
	{
		"0.1.0-proposal": { to: "0.1.0", step: fromProposal },
		"0.1.0": { to: "0.2.0", step: fromV1 },
	};

export function migrate(value: unknown): MigrationResult {
	if (!isObject(value)) return { ok: false, key: "import.notObject" };
	const version = value.schemaVersion;
	if (typeof version !== "string")
		return { ok: false, key: "import.noVersion" };
	if (version === SCHEMA_VERSION) return { ok: true, value, from: null };
	let current: Json = value;
	let v = version;
	const seen = new Set<string>();
	while (v !== SCHEMA_VERSION) {
		const step = MIGRATIONS[v];
		if (!step || seen.has(v))
			return {
				ok: false,
				key: "import.unknownVersion",
				params: {
					version,
					supported: SCHEMA_VERSION,
					migratable: Object.keys(MIGRATIONS).join(", "),
				},
			};
		seen.add(v);
		current = step.step(current);
		v = step.to;
	}
	return { ok: true, value: current, from: version };
}

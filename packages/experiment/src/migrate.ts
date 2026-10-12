import { SCHEMA_VERSION } from "./schema.ts";

export type MigrationResult =
	| { ok: true; value: unknown; from: string | null }
	| { ok: false; message: string };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * `0.1.0-proposal` is the shape of the planning-phase example. Changes:
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

const MIGRATIONS: Record<string, (input: Json) => Json> = {
	"0.1.0-proposal": fromProposal,
};

export function migrate(value: unknown): MigrationResult {
	if (!isObject(value))
		return {
			ok: false,
			message:
				"An experiment must be a JSON object with a schemaVersion field.",
		};
	const version = value.schemaVersion;
	if (typeof version !== "string")
		return {
			ok: false,
			message:
				"The file has no schemaVersion, so it cannot be read safely. Export it again from FaultWorks or add the schema version.",
		};
	if (version === SCHEMA_VERSION) return { ok: true, value, from: null };
	const step = MIGRATIONS[version];
	if (step) return { ok: true, value: step(value), from: version };
	return {
		ok: false,
		message: `This file uses schema version ${version}. This version of FaultWorks reads ${SCHEMA_VERSION} (and upgrades ${Object.keys(MIGRATIONS).join(", ")}).`,
	};
}

import { compileExperiment } from "./compile.ts";
import type { Experiment } from "./schema.ts";
import { sha256Hex } from "./sha256.ts";

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace, `undefined` dropped.
 * Array order is preserved because it is meaningful (server order is round-robin order).
 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		if (typeof value === "number" && !Number.isFinite(value))
			throw new Error("Canonical JSON cannot encode non-finite numbers");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** SHA-256 of the canonical experiment without `layout` (layout never affects results). */
export function inputDigest(experiment: Experiment): string {
	const { layout: _layout, ...rest } = experiment;
	return sha256Hex(canonicalJson(rest));
}

/**
 * SHA-256 of the compiled engine input: changes exactly when the simulated behavior can change.
 * Titles, notes, labels and layout do not affect it. Used to tell whether a result is stale.
 */
export function runKey(experiment: Experiment): string {
	return sha256Hex(canonicalJson(compileExperiment(experiment).engine));
}

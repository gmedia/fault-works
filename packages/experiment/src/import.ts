import type { Experiment } from "./schema.ts";
import { LIMITS } from "./schema.ts";
import { parseExperiment, type ValidationIssue } from "./validate.ts";

/** What a result file says it produced, so a re-run can be checked against it. */
export interface ClaimedResult {
	engineVersion: string | null;
	/** Run key: SHA-256 of everything that affects results. */
	behaviorDigest: string | null;
	traceDigest: string | null;
	offered: number | null;
	failed: number | null;
}

export interface ImportedRun {
	experiment: Experiment;
	migratedFrom: string | null;
	claimed: ClaimedResult | null;
}

export type ImportResult =
	| ({ ok: true; kind: "experiment" } & ImportedRun)
	| ({ ok: true; kind: "result" } & ImportedRun)
	| { ok: true; kind: "comparison"; a: ImportedRun; b: ImportedRun }
	| { ok: false; issues: ValidationIssue[] };

/** Result and comparison files carry series data, so they may be larger than an experiment. */
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, prefix?: string) =>
	typeof v === "string"
		? prefix && v.startsWith(prefix)
			? v.slice(prefix.length)
			: v
		: null;
const num = (v: unknown) =>
	typeof v === "number" && Number.isFinite(v) ? v : null;

const fail = (
	key: string,
	params?: Record<string, string | number>,
	path = "",
): ImportResult => ({
	ok: false,
	issues: [{ path, message: params ? { key, params } : { key } }],
});

function fromResult(
	value: Json,
	path: string,
): ImportedRun | ValidationIssue[] {
	if (!isObject(value.experiment))
		return [{ path, message: { key: "import.resultWithoutExperiment" } }];
	const parsed = parseExperiment(value.experiment);
	if (!parsed.ok)
		return parsed.issues.map((i) => ({
			path: [path, "experiment", i.path].filter(Boolean).join("."),
			message: i.message,
		}));
	const metrics = isObject(value.metrics) ? value.metrics : {};
	return {
		experiment: parsed.experiment,
		migratedFrom: parsed.migratedFrom,
		claimed: {
			engineVersion: str(value.engineVersion),
			behaviorDigest: str(value.behaviorDigest, "sha256:"),
			traceDigest: str(value.traceDigest, "fnv1a32x2:"),
			offered: num(metrics.offered),
			failed: num(metrics.failed),
		},
	};
}

/**
 * Reads any file FaultWorks exports: an experiment, a result (which embeds its experiment) or a
 * comparison bundle (which embeds two results). Everything is parsed as data and validated; the
 * claimed digests are returned so the caller can re-run and verify them.
 */
export function parseImportJson(text: string): ImportResult {
	const bytes = new TextEncoder().encode(text).length;
	if (bytes > MAX_BUNDLE_BYTES)
		return fail("import.tooLargeBundle", { kb: Math.ceil(bytes / 1024) });
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return fail("import.invalidJson", {
			detail: error instanceof Error ? error.message : "parse error",
		});
	}
	if (!isObject(value)) return fail("import.notObject");

	if (typeof value.comparisonSchemaVersion === "string") {
		if (!isObject(value.a) || !isObject(value.b))
			return fail("import.comparisonIncomplete");
		const a = fromResult(value.a, "a");
		const b = fromResult(value.b, "b");
		const issues = [
			...(Array.isArray(a) ? a : []),
			...(Array.isArray(b) ? b : []),
		];
		if (Array.isArray(a) || Array.isArray(b)) return { ok: false, issues };
		return { ok: true, kind: "comparison", a, b };
	}

	if (typeof value.resultSchemaVersion === "string") {
		const run = fromResult(value, "");
		if (Array.isArray(run)) return { ok: false, issues: run };
		return { ok: true, kind: "result", ...run };
	}

	if (bytes > LIMITS.maxImportBytes)
		return fail("import.tooLarge", {
			kb: Math.ceil(bytes / 1024),
			limitKb: LIMITS.maxImportBytes / 1024,
		});
	const parsed = parseExperiment(value);
	if (!parsed.ok) return parsed;
	return {
		ok: true,
		kind: "experiment",
		experiment: parsed.experiment,
		migratedFrom: parsed.migratedFrom,
		claimed: null,
	};
}

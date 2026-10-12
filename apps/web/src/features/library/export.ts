import {
	canonicalJson,
	type Experiment,
	FIELDS,
	type SemanticChange,
} from "@faultworks/experiment";
import { type ComparisonRow, readEventRow } from "@faultworks/metrics";
import { i18next } from "#/i18n/index.ts";
import { downloadText } from "#/lib/download.ts";
import { formatLatency, formatUnitValue } from "#/lib/format.ts";
import type { RunResult } from "#/workers/protocol.ts";

export const RESULT_SCHEMA_VERSION = "0.3.0";
export const COMPARISON_SCHEMA_VERSION = "0.2.0";

export function experimentJson(experiment: Experiment): string {
	return `${JSON.stringify(experiment, null, 2)}\n`;
}

export function exportExperiment(experiment: Experiment) {
	downloadText(
		`${experiment.experimentId}.experiment.json`,
		experimentJson(experiment),
	);
}

const standardLimitations = () => [
	i18next.t("limitations.abstract"),
	i18next.t("limitations.singleSeed"),
	i18next.t("limitations.notMeasurement"),
];

/**
 * The result artifact. It contains the full input, so anyone can re-run it and check that the
 * trace digest matches. No wall-clock values are included, which keeps the file itself
 * reproducible byte for byte.
 */
export function resultArtifact(result: RunResult) {
	const { metrics } = result;
	return {
		resultSchemaVersion: RESULT_SCHEMA_VERSION,
		engineVersion: result.engineVersion,
		metricDefinitionsVersion: result.metricDefinitionsVersion,
		// Same for every copy with the same behavior settings, whatever its id, title or notes.
		behaviorDigest: `sha256:${result.runKey}`,
		// Digest of this exact file's experiment, including id, title and notes.
		inputDigest: `sha256:${result.inputDigest}`,
		traceDigest: `fnv1a32x2:${metrics.traceDigest}`,
		seed: result.experiment.seed,
		runStatus: metrics.summary.status,
		eventCount: metrics.eventCount,
		horizonMs: result.horizonMs,
		metrics: metrics.summary,
		checks: metrics.checks,
		series: metrics.series,
		limitations: [...standardLimitations(), ...result.experiment.assumptions],
		experiment: result.experiment,
	};
}

export function exportResult(result: RunResult) {
	downloadText(
		`${result.experiment.experimentId}.result.json`,
		`${JSON.stringify(resultArtifact(result), null, 2)}\n`,
	);
}

/** Canonical form of the artifact, used by the reproducibility check. */
export function canonicalResult(result: RunResult): string {
	return canonicalJson(resultArtifact(result));
}

const csvCell = (v: string | number | null) => {
	if (v === null) return "";
	const s = String(v);
	return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function exportEventsCsv(result: RunResult) {
	const log = result.log;
	if (!log) return;
	const { nodeIds, linkIds } = result.topology;
	const faults = result.experiment.faults;
	const lines = ["time_ms,event,request,node,link,reason,duration_ms,detail"];
	for (let i = 0; i < log.length; i++) {
		const row = readEventRow(log, i);
		let detail: string | null = null;
		if (row.kind === "enqueued") detail = `queue depth ${row.depth}`;
		if (row.kind === "evicted") detail = `from ${row.from}`;
		if (row.kind === "probe") detail = row.flag ? "ok" : "failed";
		if (row.kind === "health-changed")
			detail = row.flag ? "healthy" : "unhealthy";
		if (row.kind === "call-start") detail = `attempt ${row.attempt}`;
		if (row.kind === "cache-hit") detail = row.flag ? "hit" : "miss";
		if (row.kind === "job-done") detail = row.flag ? "ok" : "failed";
		if (row.kind === "breaker") detail = row.breakerState;
		if (row.kind === "routed")
			detail = `to ${nodeIds[row.via ?? -1] ?? row.via}`;
		if (
			(row.kind === "node-down" ||
				row.kind === "node-up" ||
				row.kind === "fault-start" ||
				row.kind === "fault-end") &&
			row.fault !== null
		)
			detail = `fault ${faults[row.fault]?.id ?? row.fault}`;
		lines.push(
			[
				row.tMs.toFixed(3),
				row.kind,
				row.req,
				row.node === null ? null : (nodeIds[row.node] ?? row.node),
				row.edge === null ? null : (linkIds[row.edge] ?? row.edge),
				row.reason,
				row.durationMs === null ? null : row.durationMs.toFixed(3),
				detail,
			]
				.map(csvCell)
				.join(","),
		);
	}
	downloadText(
		`${result.experiment.experimentId}.events.csv`,
		`${lines.join("\n")}\n`,
		"text/csv",
	);
}

function formatRowValue(row: ComparisonRow, v: number | null): string {
	if (v === null) return "–";
	if (row.unit === "ms") return formatLatency(v);
	if (row.unit === "%")
		return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
	if (row.unit === "req/s")
		return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} req/s`;
	if (row.unit === "s")
		return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
	return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/**
 * One file with everything behind an A/B claim: both full results (each embeds its experiment),
 * the settings diff and the metric table. FaultWorks can import it back to recreate both sides.
 */
export function exportComparison(
	a: RunResult,
	b: RunResult,
	changes: SemanticChange[],
	rows: ComparisonRow[],
) {
	const bundle = {
		comparisonSchemaVersion: COMPARISON_SCHEMA_VERSION,
		changes,
		metrics: rows,
		a: resultArtifact(a),
		b: resultArtifact(b),
	};
	downloadText(
		`compare-${a.experiment.experimentId}-vs-${b.experiment.experimentId}.comparison.json`,
		`${JSON.stringify(bundle, null, 2)}\n`,
	);
}

const changeLabel = (c: SemanticChange) => {
	const scope =
		c.scope === "run" || c.scope === "traffic"
			? i18next.t(`scope.${c.scope}`)
			: `${i18next.t(`scope.${c.scope}`)} ${c.scopeLabel}`;
	const field =
		c.field === "presence" || c.field === "order"
			? i18next.t(`diff.${c.field}`)
			: i18next.t(`fields.${c.field}.label`);
	return `${scope} › ${field}`;
};

const changeValue = (c: SemanticChange, side: "before" | "after") => {
	const raw = c[side];
	const text = side === "before" ? c.beforeText : c.afterText;
	if (text === null) return i18next.t("diff.notPresent");
	if (c.field === "presence" || c.field === "order")
		return c.field === "presence"
			? i18next.t(`kinds.${String(raw)}`, { defaultValue: String(raw) })
			: text;
	const info = FIELDS[c.field];
	if (info.options && typeof raw === "string")
		return i18next.t(`options.${c.field}.${raw}`, { defaultValue: raw });
	return formatUnitValue(raw, info.unit);
};

/** A human-readable report of the same comparison, for handouts, reviews and grading. */
export function comparisonMarkdown(
	a: RunResult,
	b: RunResult,
	changes: SemanticChange[],
	rows: ComparisonRow[],
	narrative: string[],
): string {
	const t = i18next.t.bind(i18next);
	const lines: string[] = [];
	lines.push(
		`# ${t("compare.reportTitle", { a: a.experiment.title, b: b.experiment.title })}`,
		"",
	);
	lines.push(
		`- **A:** ${a.experiment.title} (\`${a.experiment.experimentId}\`, seed ${a.experiment.seed})`,
	);
	lines.push(
		`- **B:** ${b.experiment.title} (\`${b.experiment.experimentId}\`, seed ${b.experiment.seed})`,
	);
	lines.push(
		`- Engine ${a.engineVersion}, metrics ${a.metricDefinitionsVersion}`,
		"",
	);
	lines.push(`## ${t("compare.whatChanged")}`, "");
	if (changes.length === 0) lines.push(t("compare.noChange"), "");
	else {
		lines.push(`| ${t("compare.setting")} | A | B |`, "|---|---|---|");
		for (const c of changes)
			lines.push(
				`| ${changeLabel(c)} | ${changeValue(c, "before")} | ${changeValue(c, "after")} |`,
			);
		lines.push("");
		if (changes.length > 1)
			lines.push(
				`> ${t("compare.manyChanges", { count: changes.length })}`,
				"",
			);
	}
	lines.push(`## ${t("compare.results")}`, "");
	for (const sentence of narrative) lines.push(sentence, "");
	lines.push(
		`| ${t("compare.metric")} | A | B | ${t("compare.change")} |`,
		"|---|---|---|---|",
	);
	for (const r of rows) {
		const delta =
			r.delta === null
				? "–"
				: r.delta === 0
					? t("compare.noChangeShort")
					: `${r.delta > 0 ? "+" : "−"}${formatRowValue(r, Math.abs(r.delta))}`;
		lines.push(
			`| ${t(`rows.${r.id}`)}${r.samples ? ` (n = ${r.samples.a} / ${r.samples.b})` : ""} | ${formatRowValue(r, r.a)} | ${formatRowValue(r, r.b)} | ${delta}${r.caution ? " ⚠" : ""} |`,
		);
	}
	const cautions = rows.filter((r) => r.caution);
	if (cautions.length) {
		lines.push("");
		for (const r of cautions)
			lines.push(
				`⚠ ${t(`rows.${r.id}`)}: ${t(`compare.caution.${r.caution}`)}`,
			);
	}
	lines.push("", `## ${t("compare.reproduce")}`, "");
	lines.push(t("compare.reproduceHint"), "");
	lines.push(
		`- A: behavior \`sha256:${a.runKey}\`, trace \`fnv1a32x2:${a.metrics.traceDigest}\``,
	);
	lines.push(
		`- B: behavior \`sha256:${b.runKey}\`, trace \`fnv1a32x2:${b.metrics.traceDigest}\``,
		"",
	);
	lines.push(`## ${t("compare.limitations")}`, "");
	for (const l of new Set([
		...standardLimitations(),
		...a.experiment.assumptions,
		...b.experiment.assumptions,
	]))
		lines.push(`- ${l}`);
	return `${lines.join("\n")}\n`;
}

export function exportComparisonReport(
	a: RunResult,
	b: RunResult,
	changes: SemanticChange[],
	rows: ComparisonRow[],
	narrative: string[],
) {
	downloadText(
		`compare-${a.experiment.experimentId}-vs-${b.experiment.experimentId}.md`,
		comparisonMarkdown(a, b, changes, rows, narrative),
		"text/markdown",
	);
}

import {
	canonicalJson,
	type Experiment,
	type SemanticChange,
} from "@faultworks/experiment";
import {
	type ComparisonRow,
	FAILURE_REASON_INFO,
	readEventRow,
} from "@faultworks/metrics";
import { downloadText } from "#/lib/download.ts";
import type { RunResult } from "#/workers/protocol.ts";

export const RESULT_SCHEMA_VERSION = "0.1.0";

export function experimentJson(experiment: Experiment): string {
	return `${JSON.stringify(experiment, null, 2)}\n`;
}

export function exportExperiment(experiment: Experiment) {
	downloadText(
		`${experiment.experimentId}.experiment.json`,
		experimentJson(experiment),
	);
}

const STANDARD_LIMITATIONS = [
	"Abstract request-level discrete-event simulation; not packet-level networking or a model of any specific proxy.",
	"A single seed is a deterministic demonstration, not statistical evidence.",
	"Simulated metrics are model outputs, not measurements of a real system.",
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
		limitations: [...STANDARD_LIMITATIONS, ...result.experiment.assumptions],
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
	const servers = result.topology.servers;
	const faults = result.experiment.faults;
	const lines = ["time_ms,event,request,server,reason,duration_ms,detail"];
	for (let i = 0; i < log.length; i++) {
		const row = readEventRow(log, i);
		let detail: string | null = null;
		if (row.kind === "enqueued") detail = `queue depth ${row.depth}`;
		if (row.kind === "evicted") detail = `from ${row.from}`;
		if (row.kind === "probe") detail = row.flag ? "ok" : "failed";
		if (row.kind === "health-changed")
			detail = row.flag ? "healthy" : "unhealthy";
		if (
			(row.kind === "node-down" || row.kind === "node-up") &&
			row.fault !== null
		)
			detail = `fault ${faults[row.fault]?.id ?? row.fault}`;
		lines.push(
			[
				row.tMs.toFixed(3),
				row.kind,
				row.req,
				row.server === null ? null : (servers[row.server]?.id ?? row.server),
				row.reason ? FAILURE_REASON_INFO[row.reason].label : null,
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

export const COMPARISON_SCHEMA_VERSION = "0.1.0";

function formatRowValue(row: ComparisonRow, v: number | null): string {
	if (v === null) return "–";
	const n = v.toLocaleString("en-US", {
		maximumFractionDigits: row.unit === "requests" ? 0 : 1,
	});
	return row.unit === "requests" ? n : `${n} ${row.unit}`;
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

/** A human-readable report of the same comparison, for handouts, reviews and grading. */
export function comparisonMarkdown(
	a: RunResult,
	b: RunResult,
	changes: SemanticChange[],
	rows: ComparisonRow[],
	narrative: string[],
): string {
	const lines: string[] = [];
	lines.push(
		`# Comparison: ${a.experiment.title} vs ${b.experiment.title}`,
		"",
	);
	lines.push(
		`- **A:** ${a.experiment.title} (\`${a.experiment.experimentId}\`, seed ${a.experiment.seed})`,
	);
	lines.push(
		`- **B:** ${b.experiment.title} (\`${b.experiment.experimentId}\`, seed ${b.experiment.seed})`,
	);
	lines.push(
		`- Engine ${a.engineVersion}, metric definitions ${a.metricDefinitionsVersion}`,
		"",
	);
	lines.push("## What changed", "");
	if (changes.length === 0) lines.push("No behavior setting differs.", "");
	else {
		lines.push("| Setting | A | B |", "|---|---|---|");
		for (const c of changes)
			lines.push(
				`| ${c.scope} › ${c.field} | ${c.before ?? "not present"} | ${c.after ?? "not present"} |`,
			);
		lines.push("");
		if (changes.length > 1)
			lines.push(
				`> ${changes.length} settings differ, so a difference cannot be attributed to any single one.`,
				"",
			);
	}
	lines.push("## Results", "");
	for (const sentence of narrative) lines.push(sentence, "");
	lines.push("| Metric | A | B | Change |", "|---|---|---|---|");
	for (const r of rows) {
		const delta =
			r.delta === null
				? "–"
				: r.delta === 0
					? "no change"
					: `${r.delta > 0 ? "+" : "−"}${formatRowValue(r, Math.abs(r.delta))}`;
		lines.push(
			`| ${r.label}${r.samples ? ` (n = ${r.samples.a} / ${r.samples.b})` : ""} | ${formatRowValue(r, r.a)} | ${formatRowValue(r, r.b)} | ${delta}${r.caution ? " ⚠" : ""} |`,
		);
	}
	const cautions = rows.filter((r) => r.caution);
	if (cautions.length) {
		lines.push("");
		for (const r of cautions) lines.push(`⚠ ${r.label}: ${r.caution}`);
	}
	lines.push("", "## Reproduce", "");
	lines.push(
		"Import the `.comparison.json` file into FaultWorks, or each side's experiment, and run it. The run must reproduce these fingerprints:",
		"",
	);
	lines.push(
		`- A: behavior \`sha256:${a.runKey}\`, trace \`fnv1a32x2:${a.metrics.traceDigest}\``,
	);
	lines.push(
		`- B: behavior \`sha256:${b.runKey}\`, trace \`fnv1a32x2:${b.metrics.traceDigest}\``,
		"",
	);
	lines.push("## Limitations", "");
	for (const l of new Set([
		...STANDARD_LIMITATIONS,
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

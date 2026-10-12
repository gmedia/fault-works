import { canonicalJson, type Experiment } from "@faultworks/experiment";
import { FAILURE_REASON_INFO, readEventRow } from "@faultworks/metrics";
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

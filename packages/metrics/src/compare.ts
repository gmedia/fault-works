import type { RunSummary } from "./types.ts";

export interface ComparisonRow {
	id: string;
	label: string;
	unit: "requests" | "%" | "ms" | "req/s" | "s";
	a: number | null;
	b: number | null;
	/** b − a, or null when either side has no value. */
	delta: number | null;
	/** Which direction is an improvement; null when neither is (offered traffic). */
	better: "lower" | "higher" | null;
	/** Sample counts behind percentile rows, shown next to the values. */
	samples?: { a: number; b: number };
}

const ratio = (part: number, whole: number) =>
	whole === 0 ? 0 : (part / whole) * 100;

function row(
	id: string,
	label: string,
	unit: ComparisonRow["unit"],
	a: number | null,
	b: number | null,
	better: ComparisonRow["better"],
	samples?: ComparisonRow["samples"],
): ComparisonRow {
	return {
		id,
		label,
		unit,
		a,
		b,
		delta: a === null || b === null ? null : b - a,
		better,
		samples,
	};
}

export function compareSummaries(
	a: RunSummary,
	b: RunSummary,
): ComparisonRow[] {
	const la = a.successLatency;
	const lb = b.successLatency;
	const samples = la && lb ? { a: la.n, b: lb.n } : undefined;
	const firstDetection = (s: RunSummary) =>
		s.faults.find((f) => f.detectionDelayMs !== null)?.detectionDelayMs ?? null;
	return [
		row("offered", "Offered", "requests", a.offered, b.offered, null),
		row(
			"succeeded",
			"Succeeded",
			"requests",
			a.succeeded,
			b.succeeded,
			"higher",
		),
		row("failed", "Failed", "requests", a.failed, b.failed, "lower"),
		row(
			"success-ratio",
			"Success ratio",
			"%",
			ratio(a.succeeded, a.offered),
			ratio(b.succeeded, b.offered),
			"higher",
		),
		row(
			"in-flight",
			"In flight at end",
			"requests",
			a.inFlight,
			b.inFlight,
			null,
		),
		row(
			"p50",
			"p50 latency (successful)",
			"ms",
			la?.p50Ms ?? null,
			lb?.p50Ms ?? null,
			"lower",
			samples,
		),
		row(
			"p95",
			"p95 latency (successful)",
			"ms",
			la?.p95Ms ?? null,
			lb?.p95Ms ?? null,
			"lower",
			samples,
		),
		row(
			"p99",
			"p99 latency (successful)",
			"ms",
			la?.p99Ms ?? null,
			lb?.p99Ms ?? null,
			"lower",
			samples,
		),
		row(
			"ended-p95",
			"p95 latency (all ended requests)",
			"ms",
			a.completedLatency?.p95Ms ?? null,
			b.completedLatency?.p95Ms ?? null,
			"lower",
			a.completedLatency && b.completedLatency
				? { a: a.completedLatency.n, b: b.completedLatency.n }
				: undefined,
		),
		row(
			"success-rate",
			"Successful completions",
			"req/s",
			a.successRateRps,
			b.successRateRps,
			"higher",
		),
		row(
			"late",
			"Late responses discarded",
			"requests",
			a.lateResponses,
			b.lateResponses,
			"lower",
		),
		row(
			"detection",
			"First detection delay",
			"ms",
			firstDetection(a),
			firstDetection(b),
			"lower",
		),
	];
}

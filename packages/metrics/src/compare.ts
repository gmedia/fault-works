import type { RunSummary } from "./types.ts";

export interface ComparisonRow {
	id: string;
	unit: "requests" | "%" | "ms" | "req/s" | "s";
	a: number | null;
	b: number | null;
	/** b − a, or null when either side has no value. */
	delta: number | null;
	/** Which direction is an improvement; null when neither is (offered traffic). */
	better: "lower" | "higher" | null;
	/** Sample counts behind percentile rows, shown next to the values. */
	samples?: { a: number; b: number };
	/**
	 * Translation key of a caution, set when the direction alone would mislead, e.g. success
	 * latency "improving" only because fewer requests succeeded. The UI must not color such a
	 * row as better or worse.
	 */
	caution?: "fewerSuccesses" | "moreSuccesses";
}

const ratio = (part: number, whole: number) =>
	whole === 0 ? 0 : (part / whole) * 100;

function row(
	id: string,
	unit: ComparisonRow["unit"],
	a: number | null,
	b: number | null,
	better: ComparisonRow["better"],
	samples?: ComparisonRow["samples"],
): ComparisonRow {
	return {
		id,
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
	const endedSamples =
		a.completedLatency && b.completedLatency
			? { a: a.completedLatency.n, b: b.completedLatency.n }
			: undefined;
	const firstDetection = (s: RunSummary) =>
		s.faults.find((f) => f.detectionDelayMs !== null)?.detectionDelayMs ?? null;
	const fewer = b.succeeded < a.succeeded * 0.99;
	const more = b.succeeded > a.succeeded * 1.01;
	const survivorship = (r: ComparisonRow): ComparisonRow => {
		if (r.delta === null || r.delta === 0) return r;
		if (fewer && r.delta < 0) return { ...r, caution: "fewerSuccesses" };
		if (more && r.delta > 0) return { ...r, caution: "moreSuccesses" };
		return r;
	};
	const totalCalls = (s: RunSummary) =>
		s.links.reduce((sum, l) => sum + l.calls, 0);
	return [
		row("offered", "requests", a.offered, b.offered, null),
		row("succeeded", "requests", a.succeeded, b.succeeded, "higher"),
		row("failed", "requests", a.failed, b.failed, "lower"),
		row(
			"success-ratio",
			"%",
			ratio(a.succeeded, a.offered),
			ratio(b.succeeded, b.offered),
			"higher",
		),
		row("in-flight", "requests", a.inFlight, b.inFlight, null),
		row(
			"timed-out",
			"requests",
			a.failedByReason.timeout,
			b.failedByReason.timeout,
			"lower",
		),
		survivorship(
			row("p50", "ms", la?.p50Ms ?? null, lb?.p50Ms ?? null, "lower", samples),
		),
		survivorship(
			row("p95", "ms", la?.p95Ms ?? null, lb?.p95Ms ?? null, "lower", samples),
		),
		survivorship(
			row("p99", "ms", la?.p99Ms ?? null, lb?.p99Ms ?? null, "lower", samples),
		),
		row(
			"ended-mean",
			"ms",
			a.completedLatency?.meanMs ?? null,
			b.completedLatency?.meanMs ?? null,
			"lower",
			endedSamples,
		),
		row(
			"failed-wait",
			"s",
			a.failedWaitMs / 1000,
			b.failedWaitMs / 1000,
			"lower",
		),
		row(
			"ended-p95",
			"ms",
			a.completedLatency?.p95Ms ?? null,
			b.completedLatency?.p95Ms ?? null,
			"lower",
			endedSamples,
		),
		row("success-rate", "req/s", a.successRateRps, b.successRateRps, "higher"),
		row("calls", "requests", totalCalls(a), totalCalls(b), null),
		row("late", "requests", a.lateResponses, b.lateResponses, "lower"),
		row("detection", "ms", firstDetection(a), firstDetection(b), "lower"),
	];
}

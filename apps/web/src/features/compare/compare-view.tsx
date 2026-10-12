import {
	type Experiment,
	type SemanticChange,
	semanticDiff,
} from "@faultworks/experiment";
import {
	type ComparisonRow,
	compareSummaries,
	formatMs,
	type RunSummary,
} from "@faultworks/metrics";
import { Link } from "@tanstack/react-router";
import {
	ArrowDown,
	ArrowUp,
	CircleAlert,
	CircleCheck,
	Download,
	FileText,
	Info,
	LoaderCircle,
	Minus,
	TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { Button } from "#/components/ui/button.tsx";
import { type ChartMarker, TimeChart } from "#/features/charts/time-chart.tsx";
import {
	exportComparison,
	exportComparisonReport,
} from "#/features/library/export.ts";
import { formatCount, formatLatency } from "#/lib/format.ts";
import { cn } from "#/lib/utils.ts";
import { useRuns } from "#/state/runs.ts";
import { useValidation } from "#/state/validation.ts";
import type { RunResult } from "#/workers/protocol.ts";
import { SeedSweep } from "./seed-sweep.tsx";

const COLOR_A = "var(--series-1)";
const COLOR_B = "var(--series-2)";

function formatRow(row: ComparisonRow, v: number | null): string {
	if (v === null) return "–";
	if (row.unit === "ms") return formatLatency(v);
	if (row.unit === "%")
		return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
	if (row.unit === "req/s")
		return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} req/s`;
	if (row.unit === "s")
		return `${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} s`;
	return formatCount(v);
}

function Change({ row }: { row: ComparisonRow }) {
	if (row.delta === null)
		return <span className="text-muted-foreground">–</span>;
	if (Math.abs(row.delta) < 1e-9)
		return (
			<span className="flex items-center gap-1 text-muted-foreground">
				<Minus className="size-3.5" aria-hidden="true" />
				no change
			</span>
		);
	const up = row.delta > 0;
	// A cautioned row is never colored: its direction alone would mislead.
	const good =
		row.caution || row.better === null
			? null
			: row.better === "higher"
				? up
				: !up;
	const pct = row.a ? (row.delta / Math.abs(row.a)) * 100 : null;
	const sign = up ? "+" : "−";
	const abs = Math.abs(row.delta);
	const value =
		row.unit === "%"
			? `${abs.toLocaleString("en-US", { maximumFractionDigits: 1 })} pts`
			: formatRow(row, abs);
	const Icon = row.caution ? TriangleAlert : up ? ArrowUp : ArrowDown;
	return (
		<span
			className={cn(
				"flex flex-wrap items-center gap-x-1",
				good === true && "text-ok",
				good === false && "text-down",
				row.caution && "text-gap",
			)}
		>
			<Icon className="size-3.5" aria-hidden="true" />
			{sign}
			{value}
			{pct !== null && row.unit !== "%" && (
				<span className="text-muted-foreground">
					({sign}
					{Math.abs(pct).toLocaleString("en-US", { maximumFractionDigits: 1 })}
					%)
				</span>
			)}
			{good !== null && (
				<span className="sr-only">{good ? "(better)" : "(worse)"}</span>
			)}
			{row.caution && (
				<span className="sr-only">(read the note in this row)</span>
			)}
		</span>
	);
}

function useCurrentRun(id: string, experiment: Experiment) {
	const record = useRuns((s) => s.runs[id]);
	const run = useRuns((s) => s.run);
	const validation = useValidation(experiment);
	const current =
		record?.result && validation?.runKey === record.result.runKey
			? record.result
			: null;
	const needsRun = Boolean(
		validation?.valid &&
			!current &&
			record?.status !== "running" &&
			record?.status !== "error",
	);
	useEffect(() => {
		if (needsRun) void run(id, experiment);
	}, [needsRun, run, id, experiment]);
	return {
		result: current,
		running: record?.status === "running",
		error: record?.status === "error" ? record.error : null,
		valid: validation?.valid ?? false,
	};
}

const fastFailureShare = (s: RunSummary) =>
	s.failed === 0
		? 1
		: (s.failedByReason["backend-refused"] +
				s.failedByReason["no-healthy-backend"] +
				s.failedByReason["queue-full"]) /
			s.failed;

/** Plain sentences that say what changed, including the latency story percentiles can hide. */
export function compareNarrative(
	a: RunSummary,
	b: RunSummary,
	rows: ComparisonRow[],
): string[] {
	const out: string[] = [];
	const pct = (x: number, y: number) =>
		x === 0
			? ""
			: ` (${y < x ? "−" : "+"}${Math.abs(((y - x) / x) * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%)`;
	out.push(
		a.failed === b.failed
			? `Both runs had ${formatCount(a.failed)} failed requests.`
			: `Failed requests went from ${formatCount(a.failed)} in A to ${formatCount(b.failed)} in B${pct(a.failed, b.failed)}.`,
	);

	const p95 = rows.find((r) => r.id === "p95");
	const endedP95 = rows.find((r) => r.id === "ended-p95");
	const sameLatency = (p95?.delta ?? 0) === 0 && (endedP95?.delta ?? 0) === 0;
	const waitA = a.failedWaitMs / 1000;
	const waitB = b.failedWaitMs / 1000;
	const fmtS = (v: number) =>
		`${v.toLocaleString("en-US", { maximumFractionDigits: 1 })} s`;
	if (sameLatency) {
		if (Math.abs(waitA - waitB) >= 1)
			out.push(
				`Latency percentiles are the same in A and B, yet clients spent ${fmtS(waitA)} waiting on failed requests in A and ${fmtS(waitB)} in B. Percentiles hide this: once more than 5% of requests time out in both runs, p95 is simply the timeout in both.`,
			);
		else if (fastFailureShare(a) > 0.9 && fastFailureShare(b) > 0.9)
			out.push(
				"Latency did not change. The failures were rejected immediately (refused or no room), so they added almost no waiting time, and the requests that succeeded were served the same way. A backend that hangs instead of refusing does change latency: try the “Hanging backend” example.",
			);
		else out.push("Latency percentiles are the same in A and B.");
	} else if (p95?.a != null && p95.b != null)
		out.push(
			`p95 latency of successful requests went from ${formatLatency(p95.a)} in A to ${formatLatency(p95.b)} in B${p95.caution ? `. Read this with care: ${p95.caution.charAt(0).toLowerCase()}${p95.caution.slice(1)}` : "."}`,
		);

	const da =
		a.faults.find((f) => f.detectionDelayMs !== null)?.detectionDelayMs ?? null;
	const db =
		b.faults.find((f) => f.detectionDelayMs !== null)?.detectionDelayMs ?? null;
	if ((a.faults.length > 0 || b.faults.length > 0) && da !== db)
		out.push(
			`The first failure was detected ${da === null ? "never" : `after ${formatMs(da)}`} in A and ${db === null ? "never" : `after ${formatMs(db)}`} in B.`,
		);
	return out;
}

export function CompareView({
	a,
	b,
}: {
	a: { id: string; experiment: Experiment };
	b: { id: string; experiment: Experiment };
}) {
	const changes = useMemo(
		() => semanticDiff(a.experiment, b.experiment),
		[a.experiment, b.experiment],
	);
	const ra = useCurrentRun(a.id, a.experiment);
	const rb = useCurrentRun(b.id, b.experiment);

	return (
		<div className="grid min-w-0 grid-cols-1 gap-8">
			<WhatChanged changes={changes} />

			{(!ra.valid || !rb.valid) && (
				<p
					role="alert"
					className="rounded-lg border border-down/40 bg-down-soft p-4 text-sm"
				>
					{!ra.valid ? `“${a.experiment.title}”` : `“${b.experiment.title}”`}{" "}
					has settings that need fixing before it can run. Open it to see the
					problems.
				</p>
			)}
			{(ra.error || rb.error) && (
				<p role="alert" className="text-down text-sm">
					{ra.error ?? rb.error}
				</p>
			)}

			{ra.result && rb.result ? (
				<Results a={ra.result} b={rb.result} changes={changes} />
			) : (
				(ra.running || rb.running) && (
					<p
						className="flex items-center gap-2 text-muted-foreground text-sm"
						aria-live="polite"
					>
						<LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
						Running both experiments…
					</p>
				)
			)}

			{ra.result && rb.result && (
				<SeedSweep a={a.experiment} b={b.experiment} />
			)}

			<section
				aria-labelledby="caveats-heading"
				className="rounded-lg border p-4 text-sm sm:p-5"
			>
				<h2 id="caveats-heading" className="font-semibold">
					Before drawing conclusions
				</h2>
				<ul className="mt-2 grid list-disc gap-1.5 pl-5 text-muted-foreground">
					<li>
						Both runs come from the same abstract request-level model. They
						compare designs inside the model, not real products.
					</li>
					<li>
						A difference is only attributable to a setting when that setting is
						the only one that changed.
					</li>
					<li>
						Detection depends on where in the probe cycle a crash lands. A crash
						exactly on a probe is the fastest case; move the failure time to see
						the slower ones.
					</li>
					<li>
						With random traffic or service times, a single seed is one sample.
						Use the seed check above.
					</li>
					<li>
						Assumptions for each experiment are listed in its “What happened”
						tab and in every export.
					</li>
				</ul>
			</section>
		</div>
	);
}

function WhatChanged({ changes }: { changes: SemanticChange[] }) {
	const n = changes.length;
	const tone =
		n === 1
			? {
					Icon: CircleCheck,
					className: "text-ok",
					text: "Exactly one behavior setting differs, so differences in the results can be attributed to it within this model.",
				}
			: n === 0
				? {
						Icon: Info,
						className: "text-muted-foreground",
						text: "No behavior setting differs. The results will be identical, which makes this a reproducibility check.",
					}
				: {
						Icon: CircleAlert,
						className: "text-gap",
						text: `${n} behavior settings differ. A difference in the results cannot be attributed to any single one of them. For a clean comparison, create a variant and change only one thing.`,
					};
	return (
		<section aria-labelledby="changed-heading">
			<h2 id="changed-heading" className="font-semibold text-lg tracking-tight">
				What changed from A to B
			</h2>
			<p className={cn("mt-2 flex items-start gap-2 text-sm", tone.className)}>
				<tone.Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
				<span>{tone.text}</span>
			</p>
			{n > 0 && (
				<div className="mt-3 overflow-x-auto rounded-lg border bg-card">
					<table className="w-full text-sm">
						<thead className="bg-muted/50 text-left text-muted-foreground text-xs">
							<tr>
								<th scope="col" className="px-3 py-2 font-medium">
									Setting
								</th>
								<th scope="col" className="px-3 py-2 font-medium">
									A
								</th>
								<th scope="col" className="px-3 py-2 font-medium">
									B
								</th>
							</tr>
						</thead>
						<tbody>
							{changes.map((c) => (
								<tr key={c.key} className="border-t">
									<th scope="row" className="px-3 py-2 text-left font-normal">
										<span className="text-muted-foreground">{c.scope} › </span>
										{c.field}
									</th>
									<td className="px-3 py-2 tabular">
										{c.before ?? (
											<span className="text-muted-foreground">not present</span>
										)}
									</td>
									<td className="px-3 py-2 font-medium tabular">
										{c.after ?? (
											<span className="font-normal text-muted-foreground">
												not present
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<p className="mt-2 text-muted-foreground text-xs">
				Titles, notes, names and canvas positions are ignored: they never affect
				results.
			</p>
		</section>
	);
}

function Results({
	a,
	b,
	changes,
}: {
	a: RunResult;
	b: RunResult;
	changes: SemanticChange[];
}) {
	const rows = useMemo(
		() => compareSummaries(a.metrics.summary, b.metrics.summary),
		[a, b],
	);
	const narrative = useMemo(
		() => compareNarrative(a.metrics.summary, b.metrics.summary, rows),
		[a, b, rows],
	);
	const sameGrid = a.metrics.series.windowMs === b.metrics.series.windowMs;
	const horizon = Math.max(a.horizonMs, b.horizonMs);
	const longer = a.horizonMs >= b.horizonMs ? a : b;

	const markers = useMemo(() => {
		const bySide = new Map<number, Map<string, string[]>>();
		for (const [side, r] of [
			["A", a],
			["B", b],
		] as const)
			for (const f of r.metrics.summary.faults)
				for (const [t, what] of [
					[f.failedAtMs, `${f.serverLabel} crashed`],
					...(f.detectedAtMs !== null
						? ([[f.detectedAtMs, `${f.serverLabel} detected`]] as const)
						: []),
				] as const) {
					const atTime = bySide.get(t) ?? new Map<string, string[]>();
					atTime.set(what, [...(atTime.get(what) ?? []), side]);
					bySide.set(t, atTime);
				}
		const list: ChartMarker[] = [...bySide.entries()].map(([atMs, events]) => ({
			atMs,
			label: [...events.entries()]
				.map(
					([what, sides]) =>
						`${what} (${sides.length === 2 ? "A and B" : sides[0]})`,
				)
				.join("; "),
		}));
		return list.sort((x, y) => x.atMs - y.atMs);
	}, [a, b]);

	const perSecond = (r: RunResult, xs: number[]) =>
		xs.map((v) => (v * 1000) / r.metrics.series.windowMs);
	const pad = (xs: Array<number | null>) => [
		...xs,
		...Array<number | null>(
			Math.max(0, longer.metrics.series.startMs.length - xs.length),
		).fill(null),
	];
	const pair = (va: Array<number | null>, vb: Array<number | null>) => [
		// A is drawn first and wider so it stays visible where B lies exactly on top of it.
		{ id: "a", label: "A", color: COLOR_A, values: pad(va), width: 4 },
		{ id: "b", label: "B", color: COLOR_B, values: pad(vb) },
	];
	const chartProps = {
		startMs: longer.metrics.series.startMs,
		windowMs: longer.metrics.series.windowMs,
		horizonMs: horizon,
		markers,
	};

	return (
		<section
			aria-labelledby="results-heading"
			className="grid min-w-0 grid-cols-1 gap-6"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2
					id="results-heading"
					className="font-semibold text-lg tracking-tight"
				>
					Results
				</h2>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => exportComparison(a, b, changes, rows)}
					>
						<Download aria-hidden="true" />
						Export comparison (.json)
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							exportComparisonReport(a, b, changes, rows, narrative)
						}
					>
						<FileText aria-hidden="true" />
						Report (.md)
					</Button>
				</div>
			</div>
			<div className="grid max-w-3xl gap-2 text-base">
				{narrative.map((sentence) => (
					<p key={sentence}>{sentence}</p>
				))}
			</div>
			<div className="overflow-x-auto rounded-lg border bg-card">
				<table className="w-full text-sm tabular">
					<thead className="bg-muted/50 text-left text-muted-foreground text-xs">
						<tr>
							<th scope="col" className="px-3 py-2 font-medium">
								Metric
							</th>
							<th scope="col" className="px-3 py-2 text-right font-medium">
								<span className="inline-flex items-center gap-1.5">
									<span
										className="inline-block h-0.5 w-3 rounded-full"
										style={{ background: COLOR_A }}
										aria-hidden="true"
									/>
									A
								</span>
							</th>
							<th scope="col" className="px-3 py-2 text-right font-medium">
								<span className="inline-flex items-center gap-1.5">
									<span
										className="inline-block h-0.5 w-3 rounded-full"
										style={{ background: COLOR_B }}
										aria-hidden="true"
									/>
									B
								</span>
							</th>
							<th scope="col" className="px-3 py-2 font-medium">
								Change A → B
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.id} className="border-t align-top">
								<th scope="row" className="px-3 py-2 text-left font-normal">
									{row.label}
									{row.samples && (
										<span className="block text-muted-foreground text-xs">
											n = {formatCount(row.samples.a)} /{" "}
											{formatCount(row.samples.b)}
										</span>
									)}
									{row.caution && (
										<span className="mt-1 block max-w-md text-gap text-xs">
											{row.caution}
										</span>
									)}
								</th>
								<td className="px-3 py-2 text-right">
									{formatRow(row, row.a)}
								</td>
								<td className="px-3 py-2 text-right">
									{formatRow(row, row.b)}
								</td>
								<td className="px-3 py-2">
									<Change row={row} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<p className="-mt-3 text-muted-foreground text-xs">
				p50, p95 and p99: half, 95 and 99 of every 100 requests took this long
				or less. “Successful” rows leave failed requests out; “all ended” rows
				include them, with a timeout counted as the full timeout.
			</p>

			{sameGrid ? (
				<>
					<div className="grid min-w-0 grid-cols-1 gap-8 xl:grid-cols-2">
						<TimeChart
							{...chartProps}
							title="Failed requests per second"
							series={pair(
								perSecond(a, a.metrics.series.failed),
								perSecond(b, b.metrics.series.failed),
							)}
							formatValue={formatCount}
						/>
						<TimeChart
							{...chartProps}
							title="p95 latency, all ended requests"
							subtitle="Includes failures; a timed-out request counts as the full timeout"
							series={pair(
								a.metrics.series.endedP95Ms,
								b.metrics.series.endedP95Ms,
							)}
							formatValue={formatLatency}
						/>
						<TimeChart
							{...chartProps}
							title="p95 latency, successful requests"
							series={pair(a.metrics.series.p95Ms, b.metrics.series.p95Ms)}
							formatValue={formatLatency}
						/>
					</div>
					{markers.length > 0 && (
						<div className="text-muted-foreground text-xs">
							<p>Vertical lines on the charts:</p>
							<ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
								{markers.map((m) => (
									<li key={m.atMs} className="tabular">
										<span className="font-medium text-foreground">
											{formatMs(m.atMs)}
										</span>{" "}
										{m.label}
									</li>
								))}
							</ul>
						</div>
					)}
				</>
			) : (
				<p className="text-muted-foreground text-sm">
					The two experiments use different chart windows, so their timelines
					are not overlaid. Set the same chart window in both (Run tab) to
					compare them over time.
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button asChild variant="outline" size="sm">
					<Link
						to="/experiments/$experimentId"
						params={{ experimentId: a.experiment.experimentId }}
						search={{ tab: "explain" }}
						hash="results"
					>
						Why A behaved this way
					</Link>
				</Button>
				<Button asChild variant="outline" size="sm">
					<Link
						to="/experiments/$experimentId"
						params={{ experimentId: b.experiment.experimentId }}
						search={{ tab: "explain" }}
						hash="results"
					>
						Why B behaved this way
					</Link>
				</Button>
			</div>
		</section>
	);
}

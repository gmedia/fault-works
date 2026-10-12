import { type Experiment, semanticDiff } from "@faultworks/experiment";
import {
	type ComparisonRow,
	compareSummaries,
	formatMs,
} from "@faultworks/metrics";
import { Link } from "@tanstack/react-router";
import {
	ArrowDown,
	ArrowUp,
	CircleAlert,
	CircleCheck,
	Info,
	LoaderCircle,
	Minus,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { Button } from "#/components/ui/button.tsx";
import { type ChartMarker, TimeChart } from "#/features/charts/time-chart.tsx";
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
	return formatCount(v);
}

function Change({ row }: { row: ComparisonRow }) {
	if (row.delta === null)
		return <span className="text-muted-foreground">–</span>;
	const near = Math.abs(row.delta) < 1e-9;
	if (near)
		return (
			<span className="flex items-center gap-1 text-muted-foreground">
				<Minus className="size-3.5" aria-hidden="true" />
				no change
			</span>
		);
	const up = row.delta > 0;
	const good = row.better === null ? null : row.better === "higher" ? up : !up;
	const pct = row.a ? (row.delta / Math.abs(row.a)) * 100 : null;
	const sign = up ? "+" : "−";
	const abs = Math.abs(row.delta);
	const value =
		row.unit === "ms"
			? formatLatency(abs)
			: row.unit === "%"
				? `${abs.toLocaleString("en-US", { maximumFractionDigits: 1 })} pts`
				: row.unit === "req/s"
					? abs.toLocaleString("en-US", { maximumFractionDigits: 1 })
					: formatCount(abs);
	const Icon = up ? ArrowUp : ArrowDown;
	return (
		<span
			className={cn(
				"flex items-center gap-1",
				good === true && "text-ok",
				good === false && "text-down",
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
				<Results a={ra.result} b={rb.result} />
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

function WhatChanged({
	changes,
}: {
	changes: ReturnType<typeof semanticDiff>;
}) {
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

function Results({ a, b }: { a: RunResult; b: RunResult }) {
	const rows = useMemo(
		() => compareSummaries(a.metrics.summary, b.metrics.summary),
		[a, b],
	);
	const failed = rows.find((r) => r.id === "failed");
	const p95 = rows.find((r) => r.id === "p95");
	const sameGrid = a.metrics.series.windowMs === b.metrics.series.windowMs;
	const horizon = Math.max(a.horizonMs, b.horizonMs);
	const longer = a.horizonMs >= b.horizonMs ? a : b;

	const markers: ChartMarker[] = [
		...a.metrics.summary.faults.flatMap((f) => [
			{
				atMs: f.failedAtMs,
				label: `${f.serverLabel} crashed (A) at ${formatMs(f.failedAtMs)}`,
			},
			...(f.detectedAtMs !== null
				? [
						{
							atMs: f.detectedAtMs,
							label: `Detected in A at ${formatMs(f.detectedAtMs)}`,
						},
					]
				: []),
		]),
		...b.metrics.summary.faults.flatMap((f) => [
			...(f.detectedAtMs !== null
				? [
						{
							atMs: f.detectedAtMs,
							label: `Detected in B at ${formatMs(f.detectedAtMs)}`,
						},
					]
				: []),
		]),
	];

	const perSecond = (r: RunResult, xs: number[]) =>
		xs.map((v) => (v * 1000) / r.metrics.series.windowMs);
	const pad = <T,>(xs: T[], fill: T) => [
		...xs,
		...Array(
			Math.max(0, longer.metrics.series.startMs.length - xs.length),
		).fill(fill),
	];

	return (
		<section aria-labelledby="results-heading" className="grid gap-6">
			<h2 id="results-heading" className="font-semibold text-lg tracking-tight">
				Results
			</h2>
			{failed && failed.a !== null && failed.b !== null && (
				<p className="max-w-3xl text-base">
					Failed requests went from{" "}
					<strong className="tabular">{formatCount(failed.a)}</strong> in A to{" "}
					<strong className="tabular">{formatCount(failed.b)}</strong> in B
					{failed.delta !== null && failed.delta !== 0 && failed.a > 0 && (
						<>
							{" "}
							({failed.delta < 0 ? "−" : "+"}
							{Math.abs((failed.delta / failed.a) * 100).toLocaleString(
								"en-US",
								{ maximumFractionDigits: 1 },
							)}
							%)
						</>
					)}
					.{" "}
					{p95 && p95.a !== null && p95.b !== null && (
						<>
							p95 latency of successful requests: {formatLatency(p95.a)} in A,{" "}
							{formatLatency(p95.b)} in B.
						</>
					)}
				</p>
			)}
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
							<tr key={row.id} className="border-t">
								<th scope="row" className="px-3 py-2 text-left font-normal">
									{row.label}
									{row.samples && (
										<span className="block text-muted-foreground text-xs">
											n = {formatCount(row.samples.a)} /{" "}
											{formatCount(row.samples.b)}
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

			{sameGrid ? (
				<div className="grid min-w-0 grid-cols-1 gap-8 xl:grid-cols-2">
					<TimeChart
						title="Failed requests per second"
						startMs={longer.metrics.series.startMs}
						windowMs={longer.metrics.series.windowMs}
						horizonMs={horizon}
						markers={markers}
						series={[
							{
								id: "a",
								label: "A",
								color: COLOR_A,
								values: pad(
									perSecond(a, a.metrics.series.failed),
									null as number | null,
								),
							},
							{
								id: "b",
								label: "B",
								color: COLOR_B,
								values: pad(
									perSecond(b, b.metrics.series.failed),
									null as number | null,
								),
							},
						]}
						formatValue={formatCount}
					/>
					<TimeChart
						title="p95 latency of successful requests"
						startMs={longer.metrics.series.startMs}
						windowMs={longer.metrics.series.windowMs}
						horizonMs={horizon}
						markers={markers}
						series={[
							{
								id: "a",
								label: "A",
								color: COLOR_A,
								values: pad(a.metrics.series.p95Ms, null),
							},
							{
								id: "b",
								label: "B",
								color: COLOR_B,
								values: pad(b.metrics.series.p95Ms, null),
							},
						]}
						formatValue={formatLatency}
					/>
				</div>
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
					>
						Why A behaved this way
					</Link>
				</Button>
				<Button asChild variant="outline" size="sm">
					<Link
						to="/experiments/$experimentId"
						params={{ experimentId: b.experiment.experimentId }}
						search={{ tab: "explain" }}
					>
						Why B behaved this way
					</Link>
				</Button>
			</div>
		</section>
	);
}

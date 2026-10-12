import {
	type Experiment,
	FIELDS,
	type SemanticChange,
	semanticDiff,
} from "@faultworks/experiment";
import {
	type ComparisonRow,
	compareSummaries,
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
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button.tsx";
import { type ChartMarker, TimeChart } from "#/features/charts/time-chart.tsx";
import {
	exportComparison,
	exportComparisonReport,
} from "#/features/library/export.ts";
import {
	formatCount,
	formatLatency,
	formatMs,
	formatNumber,
	formatUnitValue,
} from "#/lib/format.ts";
import { cn } from "#/lib/utils.ts";
import { useRuns } from "#/state/runs.ts";
import { useValidation } from "#/state/validation.ts";
import type { RunResult } from "#/workers/protocol.ts";
import { SeedSweep } from "./seed-sweep.tsx";

const COLOR_A = "var(--series-1)";
const COLOR_B = "var(--series-2)";

export function formatRow(row: ComparisonRow, v: number | null): string {
	if (v === null) return "–";
	if (row.unit === "ms") return formatLatency(v);
	if (row.unit === "%") return `${formatNumber(v, 1)}%`;
	if (row.unit === "req/s") return `${formatNumber(v, 1)} req/s`;
	if (row.unit === "s") return `${formatNumber(v, 1)} s`;
	return formatCount(v);
}

function Change({ row }: { row: ComparisonRow }) {
	const { t } = useTranslation();
	if (row.delta === null)
		return <span className="text-muted-foreground">–</span>;
	if (Math.abs(row.delta) < 1e-9)
		return (
			<span className="flex items-center gap-1 text-muted-foreground">
				<Minus className="size-3.5" aria-hidden="true" />
				{t("compare.noChangeShort")}
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
			? t("compare.points", { value: formatNumber(abs, 1) })
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
					{formatNumber(Math.abs(pct), 1)}%)
				</span>
			)}
			{good !== null && (
				<span className="sr-only">
					{good ? t("compare.better") : t("compare.worse")}
				</span>
			)}
			{row.caution && <span className="sr-only">{t("compare.readNote")}</span>}
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
		: (s.failedByReason.refused +
				s.failedByReason["no-healthy-backend"] +
				s.failedByReason["queue-full"] +
				s.failedByReason["circuit-open"] +
				s.failedByReason["injected-error"]) /
			s.failed;

/** Plain sentences that say what changed, including the latency story percentiles can hide. */
export function useCompareNarrative() {
	const { t } = useTranslation();
	return (a: RunSummary, b: RunSummary, rows: ComparisonRow[]): string[] => {
		const out: string[] = [];
		const pct = (x: number, y: number) =>
			x === 0
				? ""
				: ` (${y < x ? "−" : "+"}${formatNumber(Math.abs(((y - x) / x) * 100), 1)}%)`;
		out.push(
			a.failed === b.failed
				? t("narrative.sameFailed", { failed: formatCount(a.failed) })
				: t("narrative.failed", {
						a: formatCount(a.failed),
						b: formatCount(b.failed),
						pct: pct(a.failed, b.failed),
					}),
		);

		const p95 = rows.find((r) => r.id === "p95");
		const endedP95 = rows.find((r) => r.id === "ended-p95");
		const sameLatency = (p95?.delta ?? 0) === 0 && (endedP95?.delta ?? 0) === 0;
		const waitA = a.failedWaitMs / 1000;
		const waitB = b.failedWaitMs / 1000;
		const fmtS = (v: number) => `${formatNumber(v, 1)} ${t("units.s")}`;
		if (sameLatency) {
			if (Math.abs(waitA - waitB) >= 1)
				out.push(t("narrative.hiddenWait", { a: fmtS(waitA), b: fmtS(waitB) }));
			else if (fastFailureShare(a) > 0.9 && fastFailureShare(b) > 0.9)
				out.push(t("narrative.fastFailures"));
			else out.push(t("narrative.sameLatency"));
		} else if (p95?.a != null && p95.b != null)
			out.push(
				t("narrative.p95", {
					a: formatLatency(p95.a),
					b: formatLatency(p95.b),
				}) + (p95.caution ? ` ${t(`compare.caution.${p95.caution}`)}` : ""),
			);

		const calls = rows.find((r) => r.id === "calls");
		if (
			calls?.a != null &&
			calls.b != null &&
			calls.a > 0 &&
			Math.abs(calls.b - calls.a) / calls.a > 0.2
		)
			out.push(
				t("narrative.calls", {
					a: formatCount(calls.a),
					b: formatCount(calls.b),
				}),
			);

		const da =
			a.faults.find((f) => f.detectionDelayMs !== null)?.detectionDelayMs ??
			null;
		const db =
			b.faults.find((f) => f.detectionDelayMs !== null)?.detectionDelayMs ??
			null;
		if ((a.faults.length > 0 || b.faults.length > 0) && da !== db)
			out.push(
				t("narrative.detection", {
					a: da === null ? t("summary.never").toLowerCase() : formatMs(da),
					b: db === null ? t("summary.never").toLowerCase() : formatMs(db),
				}),
			);
		return out;
	};
}

export function CompareView({
	a,
	b,
}: {
	a: { id: string; experiment: Experiment };
	b: { id: string; experiment: Experiment };
}) {
	const { t } = useTranslation();
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
					{t("compare.invalid", {
						title: !ra.valid ? a.experiment.title : b.experiment.title,
					})}
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
						{t("compare.running")}
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
					{t("compare.caveatsTitle")}
				</h2>
				<ul className="mt-2 grid list-disc gap-1.5 pl-5 text-muted-foreground">
					{(t("compare.caveats", { returnObjects: true }) as string[]).map(
						(c) => (
							<li key={c}>{c}</li>
						),
					)}
				</ul>
			</section>
		</div>
	);
}

function changeValue(
	c: SemanticChange,
	side: "before" | "after",
	t: (key: string, opts?: Record<string, unknown>) => string,
) {
	const raw = c[side];
	const text = side === "before" ? c.beforeText : c.afterText;
	if (text === null)
		return (
			<span className="text-muted-foreground">{t("diff.notPresent")}</span>
		);
	if (c.field === "presence")
		return t(`kinds.${String(raw)}`, {
			defaultValue: t(`faultKinds.${String(raw)}.label`, {
				defaultValue: String(raw),
			}),
		});
	if (c.field === "order") return text;
	const info = FIELDS[c.field];
	if (info.options && typeof raw === "string")
		return t(`options.${c.field}.${raw}`, { defaultValue: raw });
	if (raw === null)
		return text === "never"
			? t("common.never")
			: text === "none"
				? t("common.none")
				: text.startsWith("auto")
					? `${t("common.auto")} ${text.slice(4)}`
					: text;
	return formatUnitValue(raw, info.unit);
}

function WhatChanged({ changes }: { changes: SemanticChange[] }) {
	const { t } = useTranslation();
	const n = changes.length;
	const tone =
		n === 1
			? {
					Icon: CircleCheck,
					className: "text-ok",
					text: t("compare.oneChange"),
				}
			: n === 0
				? {
						Icon: Info,
						className: "text-muted-foreground",
						text: t("compare.noChange"),
					}
				: {
						Icon: CircleAlert,
						className: "text-gap",
						text: t("compare.manyChanges", { count: n }),
					};
	return (
		<section aria-labelledby="changed-heading">
			<h2 id="changed-heading" className="font-semibold text-lg tracking-tight">
				{t("compare.whatChanged")}
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
									{t("compare.setting")}
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
										<span className="text-muted-foreground">
											{c.scope === "run" || c.scope === "traffic"
												? t(`scope.${c.scope}`)
												: `${t(`scope.${c.scope}`)} ${c.scopeLabel}`}{" "}
											›{" "}
										</span>
										{c.field === "presence" || c.field === "order"
											? t(`diff.${c.field}`)
											: t(`fields.${c.field}.label`)}
									</th>
									<td className="px-3 py-2 tabular">
										{changeValue(c, "before", t)}
									</td>
									<td className="px-3 py-2 font-medium tabular">
										{changeValue(c, "after", t)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<p className="mt-2 text-muted-foreground text-xs">
				{t("compare.ignored")}
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
	const { t } = useTranslation();
	const narrativeOf = useCompareNarrative();
	const rows = useMemo(
		() => compareSummaries(a.metrics.summary, b.metrics.summary),
		[a, b],
	);
	const narrative = useMemo(
		() => narrativeOf(a.metrics.summary, b.metrics.summary, rows),
		[a, b, rows, narrativeOf],
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
			for (const f of r.metrics.summary.faults) {
				const events: Array<[number, string]> = [
					[
						f.startedAtMs,
						f.kind === "node-failure"
							? t("bands.crashedShort", { node: f.nodeLabel })
							: t("bands.faultShort", {
									kind: t(`faultKinds.${f.kind}.label`),
									target: f.nodeLabel,
								}),
					],
				];
				if (f.detectedAtMs !== null)
					events.push([
						f.detectedAtMs,
						t("bands.detectedShort", { node: f.nodeLabel }),
					]);
				for (const [tm, what] of events) {
					const atTime = bySide.get(tm) ?? new Map<string, string[]>();
					atTime.set(what, [...(atTime.get(what) ?? []), side]);
					bySide.set(tm, atTime);
				}
			}
		const list: ChartMarker[] = [...bySide.entries()].map(([atMs, events]) => ({
			atMs,
			label: [...events.entries()]
				.map(
					([what, sides]) =>
						`${what} (${sides.length === 2 ? t("compare.bothSides") : sides[0]})`,
				)
				.join("; "),
		}));
		return list.sort((x, y) => x.atMs - y.atMs);
	}, [a, b, t]);

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
					{t("compare.results")}
				</h2>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => exportComparison(a, b, changes, rows)}
					>
						<Download aria-hidden="true" />
						{t("compare.exportJson")}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							exportComparisonReport(a, b, changes, rows, narrative)
						}
					>
						<FileText aria-hidden="true" />
						{t("compare.exportReport")}
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
								{t("compare.metric")}
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
								{t("compare.change")}
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.id} className="border-t align-top">
								<th scope="row" className="px-3 py-2 text-left font-normal">
									{t(`rows.${row.id}`)}
									{row.samples && (
										<span className="block text-muted-foreground text-xs">
											n = {formatCount(row.samples.a)} /{" "}
											{formatCount(row.samples.b)}
										</span>
									)}
									{row.caution && (
										<span className="mt-1 block max-w-md text-gap text-xs">
											{t(`compare.caution.${row.caution}`)}
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
				{t("compare.percentileNote")}
			</p>

			{sameGrid ? (
				<>
					<div className="grid min-w-0 grid-cols-1 gap-8 xl:grid-cols-2">
						<TimeChart
							{...chartProps}
							title={t("compare.charts.failed")}
							series={pair(
								perSecond(a, a.metrics.series.failed),
								perSecond(b, b.metrics.series.failed),
							)}
							formatValue={formatCount}
						/>
						<TimeChart
							{...chartProps}
							title={t("compare.charts.endedP95")}
							subtitle={t("compare.charts.endedP95Sub")}
							series={pair(
								a.metrics.series.endedP95Ms,
								b.metrics.series.endedP95Ms,
							)}
							formatValue={formatLatency}
						/>
						<TimeChart
							{...chartProps}
							title={t("compare.charts.p95")}
							series={pair(a.metrics.series.p95Ms, b.metrics.series.p95Ms)}
							formatValue={formatLatency}
						/>
					</div>
					{markers.length > 0 && (
						<div className="text-muted-foreground text-xs">
							<p>{t("compare.markers")}</p>
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
					{t("compare.differentWindows")}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button asChild variant="outline" size="sm">
					<Link
						to="/experiments/$experimentId"
						params={{ experimentId: a.experiment.experimentId }}
						search={{ tab: "explain", screen: "results" }}
						hash="results"
					>
						{t("compare.whyA")}
					</Link>
				</Button>
				<Button asChild variant="outline" size="sm">
					<Link
						to="/experiments/$experimentId"
						params={{ experimentId: b.experiment.experimentId }}
						search={{ tab: "explain", screen: "results" }}
						hash="results"
					>
						{t("compare.whyB")}
					</Link>
				</Button>
			</div>
		</section>
	);
}

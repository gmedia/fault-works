import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { faultBands } from "#/features/charts/bands.ts";
import { TimeChart } from "#/features/charts/time-chart.tsx";
import { formatCount, formatLatency, formatPercent } from "#/lib/format.ts";
import { NODE_ICONS, seriesColor } from "#/lib/nodes.ts";
import type { RunResult } from "#/workers/protocol.ts";
import { orderedWorkers } from "../layers.ts";
import { usePlayback } from "../playback-store.ts";

export function Overview({ result }: { result: RunResult }) {
	const { t } = useTranslation();
	const { series, summary } = result.metrics;
	const timeMs = usePlayback((s) => s.timeMs);
	const setTime = usePlayback((s) => s.setTime);
	const { bands, markers } = useMemo(() => faultBands(result), [result]);
	const workersList = useMemo(
		() => orderedWorkers(result.experiment),
		[result],
	);
	const workerRows = workersList.map((w, wi) => ({
		node: w,
		index: result.topology.nodeIds.indexOf(w.id),
		color: seriesColor(wi),
	}));

	const requestSeries = useMemo(() => {
		const perSecond = 1000 / series.windowMs;
		const rate = (xs: number[]) => xs.map((v) => v * perSecond);
		return [
			{
				id: "offered",
				label: t("series.offered"),
				color: "var(--chart-offered)",
				values: rate(series.offered),
				muted: true,
			},
			{
				id: "succeeded",
				label: t("series.succeeded"),
				color: "var(--chart-success)",
				values: rate(series.succeeded),
			},
			{
				id: "failed",
				label: t("series.failed"),
				color: "var(--chart-failure)",
				values: rate(series.failed),
			},
		];
	}, [series, t]);
	const latencySeries = useMemo(
		() => [
			{
				id: "p50",
				label: t("series.p50"),
				color: "var(--chart-p50)",
				values: series.p50Ms,
			},
			{
				id: "p95",
				label: t("series.p95"),
				color: "var(--chart-p95)",
				values: series.p95Ms,
			},
			{
				id: "ended-p95",
				label: t("series.endedP95"),
				color: "var(--chart-failure)",
				values: series.endedP95Ms,
				muted: true,
			},
		],
		[series, t],
	);
	const queueSeries = useMemo(
		() =>
			workerRows.map(({ node, index, color }) => ({
				id: node.id,
				label: node.label ?? node.id,
				color,
				values: series.queueDepth[index] ?? [],
			})),
		[workerRows, series],
	);
	const busySeries = useMemo(
		() =>
			workerRows.map(({ node, index, color }) => ({
				id: node.id,
				label: node.label ?? node.id,
				color,
				values: series.busy[index] ?? [],
			})),
		[workerRows, series],
	);
	const callSeries = useMemo(() => {
		const perSecond = 1000 / series.windowMs;
		return workerRows.map(({ node, index, color }) => ({
			id: node.id,
			label: node.label ?? node.id,
			color,
			values: (series.calls[index] ?? []).map((v) => v * perSecond),
		}));
	}, [workerRows, series]);

	const common = {
		startMs: series.startMs,
		windowMs: series.windowMs,
		horizonMs: result.horizonMs,
		bands,
		markers,
		cursorMs: timeMs,
		onSeek: setTime,
	};
	const multiHop = workersList.length > 1;

	return (
		<div className="grid min-w-0 grid-cols-1 gap-8">
			<BandLegend kinds={new Set(bands.map((b) => b.kind))} />
			<div className="grid min-w-0 grid-cols-1 gap-8 xl:grid-cols-2">
				<TimeChart
					{...common}
					title={t("charts.requests")}
					subtitle={t("charts.requestsSub", {
						window: formatCount(series.windowMs),
					})}
					series={requestSeries}
					formatValue={(v) => formatCount(v)}
				/>
				<TimeChart
					{...common}
					title={t("charts.latency")}
					subtitle={t("charts.latencySub")}
					series={latencySeries}
					formatValue={(v) => formatLatency(v)}
				/>
				{multiHop && (
					<TimeChart
						{...common}
						title={t("charts.calls")}
						subtitle={t("charts.callsSub")}
						series={callSeries}
						formatValue={(v) => formatCount(v)}
						integer
					/>
				)}
				<TimeChart
					{...common}
					title={t("charts.queue")}
					subtitle={t("charts.queueSub")}
					series={queueSeries}
					formatValue={(v) => formatCount(v)}
					integer
				/>
				<TimeChart
					{...common}
					title={t("charts.busy")}
					subtitle={t("charts.busySub")}
					series={busySeries}
					formatValue={(v) => formatCount(v)}
					integer
				/>
			</div>

			<div>
				<h3 className="font-medium text-sm">{t("perNode.title")}</h3>
				<div className="mt-2 overflow-x-auto rounded-lg border">
					<table className="w-full text-sm tabular">
						<thead className="bg-muted/50 text-left text-muted-foreground text-xs">
							<tr>
								<th scope="col" className="px-3 py-2 font-medium">
									{t("perNode.component")}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t("perNode.calls")}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t("perNode.failedHere")}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t("perNode.callLatency")}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t("perNode.late")}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t("perNode.peakQueue")}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t("perNode.busy")}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t("perNode.extra")}
								</th>
							</tr>
						</thead>
						<tbody>
							{workerRows.map(({ node, index, color }) => {
								const n = summary.nodes[index];
								if (!n) return null;
								const Icon = NODE_ICONS[node.kind];
								return (
									<tr key={node.id} className="border-t">
										<th scope="row" className="px-3 py-2 text-left font-medium">
											<span className="flex items-center gap-2">
												<span
													className="size-2.5 rounded-full"
													style={{ background: color }}
													aria-hidden="true"
												/>
												<Icon
													className="size-3.5 text-muted-foreground"
													aria-hidden="true"
												/>
												{n.label}
											</span>
										</th>
										<td className="px-3 py-2 text-right">
											{formatCount(n.calls)}
										</td>
										<td className="px-3 py-2 text-right">
											{formatCount(n.failed)}
										</td>
										<td className="px-3 py-2 text-right">
											{n.callLatency
												? `${formatLatency(n.callLatency.p50Ms)} / ${formatLatency(n.callLatency.p95Ms)}`
												: "–"}
										</td>
										<td className="px-3 py-2 text-right">
											{formatCount(n.lateResponses)}
										</td>
										<td className="px-3 py-2 text-right">
											{formatCount(n.peakQueue)} /{" "}
											{formatCount(n.queueCapacity)}
										</td>
										<td className="px-3 py-2 text-right">
											{formatPercent(n.utilization, 1)}
										</td>
										<td className="px-3 py-2 text-right text-muted-foreground text-xs">
											{n.hitRatio !== null &&
												t("perNode.hitRatio", {
													pct: formatPercent(n.hitRatio, 1),
												})}
											{n.jobs &&
												t("perNode.jobs", {
													done: formatCount(n.jobs.done),
													failed: formatCount(n.jobs.failed),
													wait: formatLatency(n.jobs.maxWaitMs),
												})}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				<p className="mt-2 text-muted-foreground text-xs">
					{t("perNode.note")}
				</p>
			</div>

			{summary.links.some((l) => l.retries > 0 || l.breakerOpens > 0) && (
				<div>
					<h3 className="font-medium text-sm">{t("perLink.title")}</h3>
					<div className="mt-2 overflow-x-auto rounded-lg border">
						<table className="w-full text-sm tabular">
							<thead className="bg-muted/50 text-left text-muted-foreground text-xs">
								<tr>
									<th scope="col" className="px-3 py-2 font-medium">
										{t("perLink.link")}
									</th>
									<th scope="col" className="px-3 py-2 text-right font-medium">
										{t("perLink.calls")}
									</th>
									<th scope="col" className="px-3 py-2 text-right font-medium">
										{t("perLink.retries")}
									</th>
									<th scope="col" className="px-3 py-2 text-right font-medium">
										{t("perLink.failed")}
									</th>
									<th scope="col" className="px-3 py-2 text-right font-medium">
										{t("perLink.breakerOpens")}
									</th>
								</tr>
							</thead>
							<tbody>
								{summary.links.map((l) => (
									<tr key={l.id} className="border-t">
										<th scope="row" className="px-3 py-2 text-left font-medium">
											{summary.nodes[l.source]?.label} →{" "}
											{summary.nodes[l.target]?.label}
										</th>
										<td className="px-3 py-2 text-right">
											{formatCount(l.calls)}
										</td>
										<td className="px-3 py-2 text-right">
											{formatCount(l.retries)}
										</td>
										<td className="px-3 py-2 text-right">
											{formatCount(l.failed)}
										</td>
										<td className="px-3 py-2 text-right">
											{formatCount(l.breakerOpens)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	);
}

function BandLegend({ kinds }: { kinds: Set<string> }) {
	const { t } = useTranslation();
	if (kinds.size === 0) return null;
	return (
		<ul
			className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground text-xs"
			aria-label={t("charts.shading")}
		>
			{kinds.has("gap") && (
				<li className="flex items-center gap-2">
					<span
						className="gap-hatch inline-block h-3 w-5 rounded-sm"
						aria-hidden="true"
					/>
					{t("bands.legend.gap")}
				</li>
			)}
			{kinds.has("down") && (
				<li className="flex items-center gap-2">
					<span
						className="down-hatch inline-block h-3 w-5 rounded-sm border border-down/30"
						aria-hidden="true"
					/>
					{t("bands.legend.down")}
				</li>
			)}
			{kinds.has("off") && (
				<li className="flex items-center gap-2">
					<span
						className="inline-block h-3 w-5 rounded-sm bg-off-soft"
						aria-hidden="true"
					/>
					{t("bands.legend.off")}
				</li>
			)}
			{kinds.has("fault") && (
				<li className="flex items-center gap-2">
					<span
						className="inline-block h-3 w-5 rounded-sm"
						style={{
							background:
								"color-mix(in oklab, var(--gap-band) 20%, transparent)",
						}}
						aria-hidden="true"
					/>
					{t("bands.legend.fault")}
				</li>
			)}
			{kinds.has("breaker") && (
				<li className="flex items-center gap-2">
					<span
						className="inline-block h-3 w-5 rounded-sm"
						style={{
							background:
								"color-mix(in oklab, var(--series-7) 22%, transparent)",
						}}
						aria-hidden="true"
					/>
					{t("bands.legend.breaker")}
				</li>
			)}
			<li className="flex items-center gap-2">
				<span
					className="inline-block h-3 w-0.5"
					style={{ background: "var(--chart-cursor)" }}
					aria-hidden="true"
				/>
				{t("bands.legend.cursor")}
			</li>
		</ul>
	);
}

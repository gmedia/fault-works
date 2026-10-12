import { useMemo } from "react";
import { faultBands } from "#/features/charts/bands.ts";
import { TimeChart } from "#/features/charts/time-chart.tsx";
import { formatCount, formatLatency, formatPercent } from "#/lib/format.ts";
import { serverColor } from "#/lib/series.ts";
import type { RunResult } from "#/workers/protocol.ts";
import { usePlayback } from "../playback-store.ts";

export function Overview({ result }: { result: RunResult }) {
	const { series, summary } = result.metrics;
	const timeMs = usePlayback((s) => s.timeMs);
	const setTime = usePlayback((s) => s.setTime);
	const { bands, markers } = useMemo(() => faultBands(result), [result]);
	const requestSeries = useMemo(() => {
		const perSecond = 1000 / series.windowMs;
		const rate = (xs: number[]) => xs.map((v) => v * perSecond);
		return [
			{
				id: "offered",
				label: "Offered",
				color: "var(--chart-offered)",
				values: rate(series.offered),
				muted: true,
			},
			{
				id: "succeeded",
				label: "Succeeded",
				color: "var(--chart-success)",
				values: rate(series.succeeded),
			},
			{
				id: "failed",
				label: "Failed",
				color: "var(--chart-failure)",
				values: rate(series.failed),
			},
		];
	}, [series]);
	const latencySeries = useMemo(
		() => [
			{
				id: "p50",
				label: "p50, successful",
				color: "var(--chart-p50)",
				values: series.p50Ms,
			},
			{
				id: "p95",
				label: "p95, successful",
				color: "var(--chart-p95)",
				values: series.p95Ms,
			},
			{
				id: "ended-p95",
				label: "p95, all ended (incl. failures)",
				color: "var(--chart-failure)",
				values: series.endedP95Ms,
				muted: true,
			},
		],
		[series],
	);
	const queueSeries = useMemo(
		() =>
			result.topology.servers.map((s, i) => ({
				id: s.id,
				label: s.label,
				color: serverColor(i),
				values: series.queueDepth[i] ?? [],
			})),
		[result, series],
	);
	const busySeries = useMemo(
		() =>
			result.topology.servers.map((s, i) => ({
				id: s.id,
				label: s.label,
				color: serverColor(i),
				values: series.busy[i] ?? [],
			})),
		[result, series],
	);

	const common = {
		startMs: series.startMs,
		windowMs: series.windowMs,
		horizonMs: result.horizonMs,
		bands,
		markers,
		cursorMs: timeMs,
		onSeek: setTime,
	};

	return (
		<div className="grid min-w-0 grid-cols-1 gap-8">
			<BandLegend
				hasGap={bands.some((b) => b.kind === "gap")}
				hasDown={bands.some((b) => b.kind === "down")}
				hasOff={bands.some((b) => b.kind === "off")}
			/>
			<div className="grid min-w-0 grid-cols-1 gap-8 xl:grid-cols-2">
				<TimeChart
					{...common}
					title="Requests per second"
					subtitle={`Counted per ${formatCount(series.windowMs)} ms window by when they ended (offered: by arrival)`}
					series={requestSeries}
					formatValue={(v) => formatCount(v)}
				/>
				<TimeChart
					{...common}
					title="Latency"
					subtitle="Nearest-rank percentiles of requests that ended in each window. Timeouts count as the full timeout."
					series={latencySeries}
					formatValue={(v) => formatLatency(v)}
				/>
				<TimeChart
					{...common}
					integer
					title="Queue depth"
					subtitle="Peak requests waiting per window, by server"
					series={queueSeries}
					formatValue={(v) => formatCount(v)}
				/>
				<TimeChart
					{...common}
					integer
					title="Busy slots"
					subtitle="Peak slots in use per window, by server"
					series={busySeries}
					formatValue={(v) => formatCount(v)}
				/>
			</div>

			<div>
				<h3 className="font-medium text-sm">Per server</h3>
				<div className="mt-2 overflow-x-auto rounded-lg border">
					<table className="w-full text-sm tabular">
						<thead className="bg-muted/50 text-left text-muted-foreground text-xs">
							<tr>
								<th scope="col" className="px-3 py-2 font-medium">
									Server
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									Routed
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									Succeeded
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									Failed
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									Late responses
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									Peak queue
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									Slots busy
								</th>
							</tr>
						</thead>
						<tbody>
							{summary.servers.map((s, i) => (
								<tr key={s.id} className="border-t">
									<th scope="row" className="px-3 py-2 text-left font-medium">
										<span className="flex items-center gap-2">
											<span
												className="size-2.5 rounded-full"
												style={{ background: serverColor(i) }}
												aria-hidden="true"
											/>
											{s.label}
										</span>
									</th>
									<td className="px-3 py-2 text-right">
										{formatCount(s.routed)}
									</td>
									<td className="px-3 py-2 text-right">
										{formatCount(s.succeeded)}
									</td>
									<td className="px-3 py-2 text-right">
										{formatCount(s.failed)}
									</td>
									<td className="px-3 py-2 text-right">
										{formatCount(s.lateResponses)}
									</td>
									<td className="px-3 py-2 text-right">
										{formatCount(s.peakQueue)} / {formatCount(s.queueCapacity)}
									</td>
									<td className="px-3 py-2 text-right">
										{formatPercent(s.utilization, 1)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<p className="mt-2 text-muted-foreground text-xs">
					Requests that failed before reaching a server (no healthy backend) are
					not in this table. “Slots busy” is busy slot-time over the whole run.
				</p>
			</div>
		</div>
	);
}

function BandLegend({
	hasGap,
	hasDown,
	hasOff,
}: {
	hasGap: boolean;
	hasDown: boolean;
	hasOff: boolean;
}) {
	if (!hasGap && !hasDown && !hasOff) return null;
	return (
		<ul
			className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground text-xs"
			aria-label="Chart shading"
		>
			{hasGap && (
				<li className="flex items-center gap-2">
					<span
						className="gap-hatch inline-block h-3 w-5 rounded-sm"
						aria-hidden="true"
					/>
					Down, still routed
				</li>
			)}
			{hasDown && (
				<li className="flex items-center gap-2">
					<span
						className="down-hatch inline-block h-3 w-5 rounded-sm border border-down/30"
						aria-hidden="true"
					/>
					Down, removed from rotation
				</li>
			)}
			{hasOff && (
				<li className="flex items-center gap-2">
					<span
						className="inline-block h-3 w-5 rounded-sm bg-off-soft"
						aria-hidden="true"
					/>
					Back, waiting for healthy probes
				</li>
			)}
			<li className="flex items-center gap-2">
				<span
					className="inline-block h-3 w-0.5"
					style={{ background: "var(--chart-cursor)" }}
					aria-hidden="true"
				/>
				Replay position (click a chart to move it)
			</li>
		</ul>
	);
}

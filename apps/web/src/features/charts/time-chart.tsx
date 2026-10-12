import { Table2 } from "lucide-react";
import {
	type KeyboardEvent,
	type MouseEvent,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { create } from "zustand";
import { Button } from "#/components/ui/button.tsx";
import { formatSeconds } from "#/lib/format.ts";

export interface ChartSeries {
	id: string;
	label: string;
	color: string;
	values: Array<number | null>;
	/** Thin, de-emphasized line (e.g. offered traffic as context). */
	muted?: boolean;
}

export interface ChartBand {
	fromMs: number;
	toMs: number;
	kind: "gap" | "down" | "off";
	label: string;
}

export interface ChartMarker {
	atMs: number;
	label: string;
}

interface TimeChartProps {
	title: string;
	subtitle?: string;
	startMs: number[];
	windowMs: number;
	horizonMs: number;
	series: ChartSeries[];
	bands?: ChartBand[];
	markers?: ChartMarker[];
	cursorMs?: number | null;
	onSeek?: (ms: number) => void;
	formatValue: (v: number) => string;
	height?: number;
	/** Minimum top of the y axis so flat zero lines do not fill the plot. */
	minYMax?: number;
	/** Values are whole counts: ticks stay on integers. */
	integer?: boolean;
}

/** Hover position shared by every chart on the page, so one crosshair moves them all. */
export const useChartHover = create<{
	ms: number | null;
	set: (ms: number | null) => void;
}>()((set) => ({
	ms: null,
	set: (ms) => set({ ms }),
}));

function niceStep(range: number, target: number): number {
	const raw = range / Math.max(1, target);
	const mag = 10 ** Math.floor(Math.log10(raw));
	const n = raw / mag;
	return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function useWidth<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) =>
			setWidth(entry?.contentRect.width ?? 0),
		);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return { ref, width };
}

const PAD = { top: 10, right: 12, bottom: 24, left: 48 };

/**
 * Line chart over simulated time. Values are per sample window and drawn at window centers.
 * Hover (or arrow keys when focused) moves a shared crosshair; click/Enter seeks the replay.
 * Every value is also reachable through the table view.
 */
export function TimeChart({
	title,
	subtitle,
	startMs,
	windowMs,
	horizonMs,
	series,
	bands = [],
	markers = [],
	cursorMs,
	onSeek,
	formatValue,
	height = 168,
	minYMax = 1,
	integer = false,
}: TimeChartProps) {
	const { ref, width } = useWidth<HTMLDivElement>();
	const hoverMs = useChartHover((s) => s.ms);
	const setHover = useChartHover((s) => s.set);
	const [showTable, setShowTable] = useState(false);
	const titleId = useId();
	const descId = useId();

	const plotW = Math.max(0, width - PAD.left - PAD.right);
	const plotH = height - PAD.top - PAD.bottom;
	const yMax = useMemo(() => {
		let max = minYMax;
		for (const s of series)
			for (const v of s.values) if (v !== null && v > max) max = v;
		const step = integer ? Math.max(1, niceStep(max, 4)) : niceStep(max, 4);
		return Math.ceil(max / step) * step;
	}, [series, minYMax, integer]);
	const yTicks = useMemo(() => {
		const step = integer ? Math.max(1, niceStep(yMax, 4)) : niceStep(yMax, 4);
		const ticks: number[] = [];
		for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);
		return ticks;
	}, [yMax, integer]);
	const xTicks = useMemo(() => {
		const step = niceStep(horizonMs, Math.max(2, Math.floor(plotW / 90)));
		const ticks: number[] = [];
		for (let v = 0; v <= horizonMs + 1e-9; v += step) ticks.push(v);
		return ticks;
	}, [horizonMs, plotW]);

	const x = (ms: number) =>
		PAD.left + (horizonMs > 0 ? (ms / horizonMs) * plotW : 0);
	const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
	const center = (i: number) => (startMs[i] ?? 0) + windowMs / 2;

	const paths = useMemo(
		() =>
			series.map((s) => {
				let d = "";
				let pen = false;
				s.values.forEach((v, i) => {
					if (v === null) {
						pen = false;
						return;
					}
					const mid = (startMs[i] ?? 0) + windowMs / 2;
					const px =
						PAD.left +
						(horizonMs > 0
							? (Math.min(horizonMs, mid) / horizonMs) * plotW
							: 0);
					const py = PAD.top + plotH - (v / yMax) * plotH;
					d += `${pen ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
					pen = true;
				});
				return d;
			}),
		[series, plotW, plotH, yMax, horizonMs, startMs, windowMs],
	);

	const hoverIndex =
		hoverMs === null
			? null
			: Math.max(
					0,
					Math.min(startMs.length - 1, Math.floor(hoverMs / windowMs)),
				);

	const msFromPointer = (e: MouseEvent<HTMLDivElement>) => {
		const rect = e.currentTarget.getBoundingClientRect();
		const px = e.clientX - rect.left - PAD.left;
		return Math.max(
			0,
			Math.min(horizonMs, (px / Math.max(1, plotW)) * horizonMs),
		);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const current =
			hoverIndex ?? (cursorMs != null ? Math.floor(cursorMs / windowMs) : 0);
		let next: number | null = null;
		if (e.key === "ArrowRight")
			next = Math.min(startMs.length - 1, current + (e.shiftKey ? 10 : 1));
		if (e.key === "ArrowLeft")
			next = Math.max(0, current - (e.shiftKey ? 10 : 1));
		if (e.key === "Home") next = 0;
		if (e.key === "End") next = startMs.length - 1;
		if (next !== null) {
			e.preventDefault();
			e.stopPropagation();
			setHover((startMs[next] ?? 0) + windowMs / 2);
		}
		if ((e.key === "Enter" || e.key === " ") && hoverIndex !== null && onSeek) {
			e.preventDefault();
			e.stopPropagation();
			onSeek(startMs[hoverIndex] ?? 0);
		}
	};

	const legend = series.length > 1;
	const readIndex =
		hoverIndex ??
		(cursorMs != null
			? Math.max(
					0,
					Math.min(startMs.length - 1, Math.floor(cursorMs / windowMs)),
				)
			: 0);
	const valueText = `${formatSeconds(startMs[readIndex] ?? 0)} to ${formatSeconds((startMs[readIndex] ?? 0) + windowMs)}: ${series
		.map((s) => {
			const v = s.values[readIndex];
			return `${s.label} ${v === null || v === undefined ? "no data" : formatValue(v)}`;
		})
		.join(", ")}`;
	const tooltipLeft = hoverIndex !== null ? x(center(hoverIndex)) : 0;

	return (
		<figure className="min-w-0">
			<div className="flex items-start justify-between gap-2">
				<figcaption>
					<span id={titleId} className="font-medium text-sm">
						{title}
					</span>
					{subtitle && (
						<span id={descId} className="block text-muted-foreground text-xs">
							{subtitle}
						</span>
					)}
				</figcaption>
				<Button
					variant="ghost"
					size="xs"
					aria-pressed={showTable}
					onClick={() => setShowTable((v) => !v)}
					className="text-muted-foreground"
				>
					<Table2 aria-hidden="true" />
					{showTable ? "Chart" : "Table"}
				</Button>
			</div>
			{legend && !showTable && (
				<ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
					{series.map((s) => (
						<li key={s.id} className="flex items-center gap-1.5">
							<span
								className="inline-block h-0.5 w-3 rounded-full"
								style={{ background: s.color, opacity: s.muted ? 0.8 : 1 }}
								aria-hidden="true"
							/>
							{s.label}
						</li>
					))}
				</ul>
			)}

			{showTable ? (
				<ChartTable
					title={title}
					startMs={startMs}
					windowMs={windowMs}
					series={series}
					formatValue={formatValue}
				/>
			) : (
				<div
					ref={ref}
					// The crosshair is a slider over sample windows: arrow keys move it and screen
					// readers announce every series at that window. The SVG itself is decorative.
					role="slider"
					aria-labelledby={titleId}
					aria-describedby={subtitle ? descId : undefined}
					aria-valuemin={0}
					aria-valuemax={Math.max(0, startMs.length - 1)}
					aria-valuenow={readIndex}
					aria-valuetext={valueText}
					tabIndex={0}
					className="relative mt-1 cursor-crosshair rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
					style={{ height }}
					onPointerMove={(e) => setHover(msFromPointer(e))}
					onPointerLeave={() => setHover(null)}
					onClick={(e) => onSeek?.(msFromPointer(e))}
					onKeyDown={onKeyDown}
					onBlur={() => setHover(null)}
				>
					{width > 0 && (
						<svg
							width={width}
							height={height}
							aria-hidden="true"
							focusable="false"
							className="block"
						>
							<defs>
								<pattern
									id={`${titleId}-gap`}
									width="7"
									height="7"
									patternUnits="userSpaceOnUse"
									patternTransform="rotate(135)"
								>
									<rect
										width="7"
										height="7"
										fill="color-mix(in oklab, var(--gap-band) 14%, transparent)"
									/>
									<rect
										width="2"
										height="7"
										fill="color-mix(in oklab, var(--gap-band) 50%, transparent)"
									/>
								</pattern>
								<pattern
									id={`${titleId}-down`}
									width="6"
									height="6"
									patternUnits="userSpaceOnUse"
									patternTransform="rotate(45)"
								>
									<rect
										width="1"
										height="6"
										fill="color-mix(in oklab, var(--down) 22%, transparent)"
									/>
								</pattern>
							</defs>
							{bands.map((b) => (
								<rect
									key={`${b.kind}-${b.fromMs}-${b.toMs}`}
									x={x(b.fromMs)}
									y={PAD.top}
									width={Math.max(
										1,
										x(Math.min(b.toMs, horizonMs)) - x(b.fromMs),
									)}
									height={plotH}
									fill={
										b.kind === "gap"
											? `url(#${titleId}-gap)`
											: b.kind === "down"
												? `url(#${titleId}-down)`
												: "color-mix(in oklab, var(--off) 10%, transparent)"
									}
								>
									<title>{b.label}</title>
								</rect>
							))}
							{yTicks.map((v) => (
								<g key={v}>
									<line
										x1={PAD.left}
										x2={PAD.left + plotW}
										y1={y(v)}
										y2={y(v)}
										stroke="var(--chart-grid)"
									/>
									<text
										x={PAD.left - 6}
										y={y(v)}
										dy="0.32em"
										textAnchor="end"
										fontSize="10"
										className="tabular"
										fill="var(--muted-foreground)"
									>
										{formatValue(v)}
									</text>
								</g>
							))}
							<line
								x1={PAD.left}
								x2={PAD.left + plotW}
								y1={PAD.top + plotH}
								y2={PAD.top + plotH}
								stroke="var(--chart-axis)"
							/>
							{xTicks.map((v) => (
								<text
									key={v}
									x={x(v)}
									y={height - 6}
									textAnchor={v === 0 ? "start" : "middle"}
									fontSize="10"
									className="tabular"
									fill="var(--muted-foreground)"
								>
									{formatSeconds(v)}
								</text>
							))}
							{markers.map((m) => (
								<line
									key={`${m.atMs}-${m.label}`}
									x1={x(m.atMs)}
									x2={x(m.atMs)}
									y1={PAD.top}
									y2={PAD.top + plotH}
									stroke="var(--muted-foreground)"
									strokeWidth="1"
								>
									<title>{m.label}</title>
								</line>
							))}
							{series.map((s, i) => (
								<path
									key={s.id}
									d={paths[i]}
									fill="none"
									stroke={s.color}
									strokeWidth={s.muted ? 1.25 : 2}
									strokeLinejoin="round"
									strokeLinecap="round"
									opacity={s.muted ? 0.85 : 1}
								/>
							))}
							{cursorMs != null && (
								<line
									x1={x(cursorMs)}
									x2={x(cursorMs)}
									y1={PAD.top - 4}
									y2={PAD.top + plotH}
									stroke="var(--chart-cursor)"
									strokeWidth="1.5"
								/>
							)}
							{hoverIndex !== null && (
								<g pointerEvents="none">
									<line
										x1={tooltipLeft}
										x2={tooltipLeft}
										y1={PAD.top}
										y2={PAD.top + plotH}
										stroke="var(--muted-foreground)"
										strokeWidth="1"
									/>
									{series.map((s) => {
										const v = s.values[hoverIndex];
										return v === null || v === undefined ? null : (
											<circle
												key={s.id}
												cx={tooltipLeft}
												cy={y(v)}
												r="4"
												fill={s.color}
												stroke="var(--card)"
												strokeWidth="2"
											/>
										);
									})}
								</g>
							)}
						</svg>
					)}
					{hoverIndex !== null && width > 0 && (
						<div
							className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border bg-popover px-2.5 py-2 text-popover-foreground text-xs shadow-md"
							style={{
								left: tooltipLeft > width / 2 ? undefined : tooltipLeft + 12,
								right:
									tooltipLeft > width / 2
										? width - tooltipLeft + 12
										: undefined,
							}}
						>
							<p className="mb-1 text-muted-foreground tabular">
								{formatSeconds(startMs[hoverIndex] ?? 0)} –{" "}
								{formatSeconds((startMs[hoverIndex] ?? 0) + windowMs)}
							</p>
							<ul className="grid gap-0.5">
								{series.map((s) => {
									const v = s.values[hoverIndex];
									return (
										<li key={s.id} className="flex items-center gap-2">
											<span
												className="inline-block h-0.5 w-3 rounded-full"
												style={{ background: s.color }}
												aria-hidden="true"
											/>
											<span className="font-medium tabular">
												{v === null || v === undefined ? "–" : formatValue(v)}
											</span>
											<span className="text-muted-foreground">{s.label}</span>
										</li>
									);
								})}
							</ul>
							{bands
								.filter(
									(b) =>
										(startMs[hoverIndex] ?? 0) < b.toMs &&
										(startMs[hoverIndex] ?? 0) + windowMs > b.fromMs,
								)
								.map((b) => (
									<p key={b.label} className="mt-1 text-muted-foreground">
										{b.label}
									</p>
								))}
						</div>
					)}
				</div>
			)}
		</figure>
	);
}

function ChartTable({
	title,
	startMs,
	windowMs,
	series,
	formatValue,
}: {
	title: string;
	startMs: number[];
	windowMs: number;
	series: ChartSeries[];
	formatValue: (v: number) => string;
}) {
	return (
		<div className="mt-2 max-h-56 overflow-auto rounded-md border">
			<table className="w-full text-xs tabular">
				<caption className="sr-only">
					{title}, per {formatSeconds(windowMs)} window
				</caption>
				<thead className="sticky top-0 bg-card">
					<tr>
						<th scope="col" className="px-2 py-1.5 text-left font-medium">
							Window
						</th>
						{series.map((s) => (
							<th
								key={s.id}
								scope="col"
								className="px-2 py-1.5 text-right font-medium"
							>
								{s.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{startMs.map((start, i) => (
						<tr key={start} className="border-t">
							<th
								scope="row"
								className="px-2 py-1 text-left font-normal text-muted-foreground"
							>
								{formatSeconds(start)}
							</th>
							{series.map((s) => {
								const v = s.values[i];
								return (
									<td key={s.id} className="px-2 py-1 text-right">
										{v === null || v === undefined ? "–" : formatValue(v)}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

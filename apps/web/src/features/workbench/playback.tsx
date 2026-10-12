import {
	ChevronFirst,
	ChevronLast,
	Pause,
	Play,
	SkipBack,
	SkipForward,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef } from "react";
import { Button } from "#/components/ui/button.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { faultBands } from "#/features/charts/bands.ts";
import { formatClock, formatSeconds } from "#/lib/format.ts";
import type { RunResult } from "#/workers/protocol.ts";
import { usePlayback } from "./playback-store.ts";

const SPEEDS = [1, 2, 5, 10, 20];

/** Times worth stopping at: every crash, detection, recovery and return to rotation. */
export function stateChangeTimes(result: RunResult): number[] {
	return [...new Set(result.metrics.transitions.map((t) => t.tMs))].sort(
		(a, b) => a - b,
	);
}

/**
 * Replays a finished run over simulated time. The replay only moves a cursor over recorded
 * results; speed and frame rate can never change the numbers.
 */
export function PlaybackBar({
	result,
	disabled,
}: {
	result: RunResult;
	disabled?: boolean;
}) {
	const { timeMs, playing, speed, setTime, setPlaying, setSpeed } =
		usePlayback();
	const horizon = result.horizonMs;
	const windowMs = result.metrics.series.windowMs;
	const changes = useMemo(() => stateChangeTimes(result), [result]);
	const { bands } = useMemo(() => faultBands(result), [result]);
	const sliderId = useId();
	const last = useRef<number | null>(null);

	useEffect(() => {
		if (!playing) {
			last.current = null;
			return;
		}
		let frame = 0;
		const tick = (now: number) => {
			const prev = last.current ?? now;
			last.current = now;
			const { timeMs: t, speed: s } = usePlayback.getState();
			const next = Math.min(horizon, t + (now - prev) * s);
			usePlayback.getState().setTime(next);
			if (next >= horizon) {
				usePlayback.getState().setPlaying(false);
				return;
			}
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [playing, horizon]);

	const nextChange = changes.find((t) => t > timeMs + 0.5);
	const prevChange = [...changes].reverse().find((t) => t < timeMs - 0.5);

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-card px-3 py-2">
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Previous state change"
					title="Previous state change (Shift + ←)"
					disabled={disabled || prevChange === undefined}
					onClick={() => prevChange !== undefined && setTime(prevChange)}
				>
					<ChevronFirst />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Back one window"
					title="Back one window (←)"
					disabled={disabled || timeMs <= 0}
					onClick={() => setTime(Math.max(0, timeMs - windowMs))}
				>
					<SkipBack />
				</Button>
				<Button
					size="icon-sm"
					aria-label={playing ? "Pause replay" : "Play replay"}
					title={playing ? "Pause (Space)" : "Play (Space)"}
					disabled={disabled}
					onClick={() => {
						if (!playing && timeMs >= horizon) setTime(0);
						setPlaying(!playing);
					}}
				>
					{playing ? <Pause /> : <Play />}
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Forward one window"
					title="Forward one window (→)"
					disabled={disabled || timeMs >= horizon}
					onClick={() => setTime(Math.min(horizon, timeMs + windowMs))}
				>
					<SkipForward />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Next state change"
					title="Next state change (Shift + →)"
					disabled={disabled || nextChange === undefined}
					onClick={() => nextChange !== undefined && setTime(nextChange)}
				>
					<ChevronLast />
				</Button>
			</div>

			<div className="relative order-last flex h-8 min-w-0 basis-full items-center sm:order-none sm:basis-auto sm:flex-1">
				<label htmlFor={sliderId} className="sr-only">
					Replay position
				</label>
				<div
					className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-muted"
					aria-hidden="true"
				>
					{bands.map((b) => (
						<span
							key={`${b.kind}-${b.fromMs}`}
							className={
								b.kind === "gap"
									? "gap-hatch absolute inset-y-0"
									: b.kind === "down"
										? "down-hatch absolute inset-y-0 bg-down-soft"
										: "absolute inset-y-0 bg-off-soft"
							}
							style={{
								left: `${(b.fromMs / horizon) * 100}%`,
								width: `${(Math.max(0, Math.min(b.toMs, horizon) - b.fromMs) / horizon) * 100}%`,
							}}
						/>
					))}
					<span
						className="absolute inset-y-0 left-0 bg-foreground/15"
						style={{ width: `${(timeMs / horizon) * 100}%` }}
					/>
				</div>
				{changes.map((t) => (
					<span
						key={t}
						className="pointer-events-none absolute top-1/2 h-3.5 w-px -translate-y-1/2 bg-muted-foreground"
						style={{ left: `${(t / horizon) * 100}%` }}
						aria-hidden="true"
					/>
				))}
				<input
					id={sliderId}
					type="range"
					min={0}
					max={horizon}
					step={Math.max(1, windowMs / 10)}
					value={timeMs}
					disabled={disabled}
					onChange={(e) => {
						setPlaying(false);
						setTime(Number(e.target.value));
					}}
					aria-valuetext={`${formatSeconds(timeMs)} of ${formatSeconds(horizon)}`}
					className="relative z-10 h-8 w-full cursor-pointer appearance-none bg-transparent focus-visible:outline-none [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-card [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-card [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-ring"
				/>
			</div>

			<p className="font-mono text-xs tabular" aria-live="off">
				{formatClock(timeMs)}{" "}
				<span className="text-muted-foreground">/ {formatClock(horizon)}</span>
			</p>
			<Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
				<SelectTrigger
					size="sm"
					className="w-[4.75rem]"
					aria-label="Replay speed"
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{SPEEDS.map((s) => (
						<SelectItem key={s} value={String(s)}>
							{s}×
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

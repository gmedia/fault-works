import { type EngineInput, simulate } from "@faultworks/engine";
import { type EventLogData, EventLogRecorder } from "./log.ts";
import { createRunRecorder } from "./recorder.ts";
import type { RunMetrics } from "./types.ts";

export interface RunOptions {
	labels: string[];
	windowMs: number;
	/** Record the columnar event log for the event table (off for multi-seed sweeps). */
	recordLog: boolean;
}

export interface RunOutput {
	metrics: RunMetrics;
	log: EventLogData | null;
	durationMs: number;
}

/** Runs the engine once and reduces it. Pure apart from reading the wall clock for `durationMs`. */
export function runSimulation(
	input: EngineInput,
	options: RunOptions,
): RunOutput {
	const started = globalThis.performance?.now() ?? Date.now();
	const recorder = createRunRecorder(input, options);
	const log = options.recordLog ? new EventLogRecorder() : null;
	const result = simulate(input, (e) => {
		recorder.push(e);
		log?.push(e);
	});
	const metrics = recorder.finish(result);
	return {
		metrics,
		log: log?.finish() ?? null,
		durationMs: (globalThis.performance?.now() ?? Date.now()) - started,
	};
}

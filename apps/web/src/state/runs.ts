import type { Experiment } from "@faultworks/experiment";
import { create } from "zustand";
import { runInWorker } from "#/workers/client.ts";
import type { RunResult } from "#/workers/protocol.ts";

export interface RunRecord {
	status: "running" | "done" | "error";
	/** The run key of the input being run (or last run). */
	key: string | null;
	startedAt: number;
	error: string | null;
	/** The last successful result; kept while a re-run is in progress. */
	result: RunResult | null;
}

interface RunState {
	runs: Record<string, RunRecord>;
	run(experimentId: string, experiment: Experiment): Promise<RunResult | null>;
	forget(experimentId: string): void;
}

/**
 * Results live only in memory: they are reproducible from the experiment, so persisting them
 * would only risk serving stale numbers.
 */
export const useRuns = create<RunState>()((set, get) => ({
	runs: {},

	async run(experimentId, experiment) {
		const startedAt = Date.now();
		const previous = get().runs[experimentId];
		set((s) => ({
			runs: {
				...s.runs,
				[experimentId]: {
					status: "running",
					key: previous?.key ?? null,
					startedAt,
					error: null,
					result: previous?.result ?? null,
				},
			},
		}));
		try {
			const result = await runInWorker(experiment);
			// A newer run for the same experiment started meanwhile: let it win.
			if (get().runs[experimentId]?.startedAt !== startedAt) return result;
			set((s) => ({
				runs: {
					...s.runs,
					[experimentId]: {
						status: "done",
						key: result.runKey,
						startedAt,
						error: null,
						result,
					},
				},
			}));
			return result;
		} catch (error) {
			if (get().runs[experimentId]?.startedAt !== startedAt) return null;
			set((s) => ({
				runs: {
					...s.runs,
					[experimentId]: {
						status: "error",
						key: previous?.key ?? null,
						startedAt,
						error: error instanceof Error ? error.message : String(error),
						result: previous?.result ?? null,
					},
				},
			}));
			return null;
		}
	},

	forget(experimentId) {
		set((s) => {
			const runs = { ...s.runs };
			delete runs[experimentId];
			return { runs };
		});
	},
}));

export function useRun(experimentId: string): RunRecord | undefined {
	return useRuns((s) => s.runs[experimentId]);
}

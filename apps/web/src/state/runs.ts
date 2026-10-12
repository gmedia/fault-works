import type { ClaimedResult, Experiment } from "@faultworks/experiment";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { runInWorker } from "#/workers/client.ts";
import type { RunResult } from "#/workers/protocol.ts";
import { safeStorage } from "./storage.ts";

export interface RunRecord {
	status: "running" | "done" | "error";
	/** The run key of the input being run (or last run). */
	key: string | null;
	startedAt: number;
	error: string | null;
	/** The last successful result; kept while a re-run is in progress. */
	result: RunResult | null;
}

export interface PendingVerification extends ClaimedResult {
	/** File name or description of where the claim came from. */
	source: string;
}

interface RunState {
	runs: Record<string, RunRecord>;
	/**
	 * Run keys this browser has produced before. Opening such an experiment re-runs it, so results
	 * appear to persist without storing them (they are fully reproducible from the input).
	 */
	ranKeys: string[];
	/** Result-file claims waiting to be checked against a fresh run, by experiment id. */
	verifications: Record<string, PendingVerification>;
	run(experimentId: string, experiment: Experiment): Promise<RunResult | null>;
	forget(experimentId: string): void;
	setVerification(
		experimentId: string,
		claim: PendingVerification | null,
	): void;
}

/**
 * Results live only in memory: they are reproducible from the experiment, so persisting them
 * would only risk serving stale numbers. Only the list of run keys is remembered.
 */
export const useRuns = create<RunState>()(
	persist(
		(set, get) => ({
			runs: {},
			ranKeys: [],
			verifications: {},

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
						ranKeys: [
							result.runKey,
							...s.ranKeys.filter((k) => k !== result.runKey),
						].slice(0, 200),
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

			setVerification(experimentId, claim) {
				set((s) => {
					const verifications = { ...s.verifications };
					if (claim) verifications[experimentId] = claim;
					else delete verifications[experimentId];
					return { verifications };
				});
			},
		}),
		{
			name: "faultworks.runs",
			version: 2,
			storage: createJSONStorage(() => safeStorage),
			partialize: (state) => ({ ranKeys: state.ranKeys }),
		},
	),
);

export function useRun(experimentId: string): RunRecord | undefined {
	return useRuns((s) => s.runs[experimentId]);
}

import {
	BUILT_IN_EXPERIMENTS,
	cloneExperiment,
	type Experiment,
	findBuiltIn,
	uniqueId,
} from "@faultworks/experiment";
import { create } from "zustand";
import {
	createJSONStorage,
	persist,
	type StateStorage,
} from "zustand/middleware";

export type Origin = "built-in" | "imported" | "variant" | "created";

export interface LibraryEntry {
	experiment: Experiment;
	origin: Origin;
	/** The experiment this one was copied from, for "compare with original". */
	basedOn: string | null;
	createdAt: number;
	updatedAt: number;
}

interface History {
	past: Experiment[];
	future: Experiment[];
	lastKey: string | null;
	lastAt: number;
}

interface LibraryState {
	entries: Record<string, LibraryEntry>;
	/** Display order, most recently created first. */
	order: string[];
	/** Built-ins added at least once, so a deleted example does not come back on reload. */
	seeded: string[];
	history: Record<string, History>;

	add(experiment: Experiment, origin: Origin, basedOn?: string | null): string;
	update(
		id: string,
		recipe: (e: Experiment) => Experiment,
		coalesceKey?: string,
	): void;
	undo(id: string): boolean;
	redo(id: string): boolean;
	remove(id: string): { entry: LibraryEntry; index: number } | null;
	restoreEntry(entry: LibraryEntry, index: number): void;
	createVariant(id: string): string | null;
	resetToBuiltIn(id: string): void;
	restoreBuiltIns(): number;
}

const COALESCE_MS = 800;
const HISTORY_LIMIT = 100;

/** localStorage can throw (private mode, blocked storage); the app must still work in memory. */
const safeStorage: StateStorage = {
	getItem: (name) => {
		try {
			return window.localStorage.getItem(name);
		} catch {
			return null;
		}
	},
	setItem: (name, value) => {
		try {
			window.localStorage.setItem(name, value);
		} catch {
			// Quota or blocked storage: keep working in memory.
		}
	},
	removeItem: (name) => {
		try {
			window.localStorage.removeItem(name);
		} catch {
			// ignore
		}
	},
};

function seedEntries(now: number) {
	const entries: Record<string, LibraryEntry> = {};
	for (const experiment of BUILT_IN_EXPERIMENTS)
		entries[experiment.experimentId] = {
			experiment: structuredClone(experiment),
			origin: "built-in",
			basedOn: null,
			createdAt: now,
			updatedAt: now,
		};
	return entries;
}

export const useLibrary = create<LibraryState>()(
	persist(
		(set, get) => ({
			entries: seedEntries(Date.now()),
			order: BUILT_IN_EXPERIMENTS.map((e) => e.experimentId),
			seeded: BUILT_IN_EXPERIMENTS.map((e) => e.experimentId),
			history: {},

			add(experiment, origin, basedOn = null) {
				const state = get();
				const id = state.entries[experiment.experimentId]
					? uniqueId(experiment.experimentId, Object.keys(state.entries))
					: experiment.experimentId;
				const now = Date.now();
				set({
					entries: {
						...state.entries,
						[id]: {
							experiment: { ...structuredClone(experiment), experimentId: id },
							origin,
							basedOn,
							createdAt: now,
							updatedAt: now,
						},
					},
					order: [id, ...state.order.filter((x) => x !== id)],
				});
				return id;
			},

			update(id, recipe, coalesceKey) {
				const state = get();
				const entry = state.entries[id];
				if (!entry) return;
				const next = recipe(entry.experiment);
				if (next === entry.experiment) return;
				const now = Date.now();
				const h = state.history[id] ?? {
					past: [],
					future: [],
					lastKey: null,
					lastAt: 0,
				};
				const coalesce =
					coalesceKey !== undefined &&
					h.lastKey === coalesceKey &&
					now - h.lastAt < COALESCE_MS;
				const past = coalesce
					? h.past
					: [...h.past, entry.experiment].slice(-HISTORY_LIMIT);
				set({
					entries: {
						...state.entries,
						[id]: {
							...entry,
							experiment: { ...next, experimentId: id },
							updatedAt: now,
						},
					},
					history: {
						...state.history,
						[id]: {
							past,
							future: [],
							lastKey: coalesceKey ?? null,
							lastAt: now,
						},
					},
				});
			},

			undo(id) {
				const state = get();
				const entry = state.entries[id];
				const h = state.history[id];
				const previous = h?.past.at(-1);
				if (!entry || !h || !previous) return false;
				set({
					entries: {
						...state.entries,
						[id]: { ...entry, experiment: previous, updatedAt: Date.now() },
					},
					history: {
						...state.history,
						[id]: {
							past: h.past.slice(0, -1),
							future: [entry.experiment, ...h.future],
							lastKey: null,
							lastAt: 0,
						},
					},
				});
				return true;
			},

			redo(id) {
				const state = get();
				const entry = state.entries[id];
				const h = state.history[id];
				const next = h?.future[0];
				if (!entry || !h || !next) return false;
				set({
					entries: {
						...state.entries,
						[id]: { ...entry, experiment: next, updatedAt: Date.now() },
					},
					history: {
						...state.history,
						[id]: {
							past: [...h.past, entry.experiment],
							future: h.future.slice(1),
							lastKey: null,
							lastAt: 0,
						},
					},
				});
				return true;
			},

			remove(id) {
				const state = get();
				const entry = state.entries[id];
				if (!entry) return null;
				const index = state.order.indexOf(id);
				const entries = { ...state.entries };
				delete entries[id];
				const history = { ...state.history };
				delete history[id];
				set({ entries, history, order: state.order.filter((x) => x !== id) });
				return { entry, index };
			},

			restoreEntry(entry, index) {
				const state = get();
				const id = entry.experiment.experimentId;
				if (state.entries[id]) return;
				const order = [...state.order];
				order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
				set({ entries: { ...state.entries, [id]: entry }, order });
			},

			createVariant(id) {
				const state = get();
				const entry = state.entries[id];
				if (!entry) return null;
				const variant = cloneExperiment(
					entry.experiment,
					Object.keys(state.entries),
				);
				return get().add(variant, "variant", id);
			},

			resetToBuiltIn(id) {
				const original = findBuiltIn(id);
				if (!original) return;
				get().update(id, () => structuredClone(original));
			},

			restoreBuiltIns() {
				const state = get();
				const missing = BUILT_IN_EXPERIMENTS.filter(
					(e) => !state.entries[e.experimentId],
				);
				const now = Date.now();
				const entries = { ...state.entries };
				for (const e of missing)
					entries[e.experimentId] = {
						experiment: structuredClone(e),
						origin: "built-in",
						basedOn: null,
						createdAt: now,
						updatedAt: now,
					};
				set({
					entries,
					order: [...state.order, ...missing.map((e) => e.experimentId)],
					seeded: [
						...new Set([
							...state.seeded,
							...missing.map((e) => e.experimentId),
						]),
					],
				});
				return missing.length;
			},
		}),
		{
			name: "faultworks.library",
			version: 1,
			storage: createJSONStorage(() => safeStorage),
			partialize: (state) => ({
				entries: state.entries,
				order: state.order,
				seeded: state.seeded,
			}),
			merge: (persisted, current) => {
				const p = persisted as Partial<LibraryState> | undefined;
				if (!p?.entries || !Array.isArray(p.order)) return current;
				// Drop anything that does not even look like an experiment (hand-edited storage).
				const entries: Record<string, LibraryEntry> = {};
				for (const [id, entry] of Object.entries(p.entries))
					if (
						entry &&
						typeof entry.experiment?.experimentId === "string" &&
						entry.experiment.model
					)
						entries[id] = entry;
				const order = p.order.filter((id) => entries[id]);
				const seeded = new Set(p.seeded ?? []);
				// Built-ins shipped after this browser last visited.
				const now = Date.now();
				for (const e of BUILT_IN_EXPERIMENTS)
					if (!seeded.has(e.experimentId) && !entries[e.experimentId]) {
						entries[e.experimentId] = {
							experiment: structuredClone(e),
							origin: "built-in",
							basedOn: null,
							createdAt: now,
							updatedAt: now,
						};
						order.push(e.experimentId);
						seeded.add(e.experimentId);
					}
				return { ...current, entries, order, seeded: [...seeded] };
			},
		},
	),
);

export function useEntry(id: string): LibraryEntry | undefined {
	return useLibrary((s) => s.entries[id]);
}

export function useCanUndo(id: string) {
	return useLibrary((s) => (s.history[id]?.past.length ?? 0) > 0);
}

export function useCanRedo(id: string) {
	return useLibrary((s) => (s.history[id]?.future.length ?? 0) > 0);
}

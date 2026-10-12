import {
	builtInExperiments,
	cloneExperiment,
	EXAMPLE_IDS,
	type Experiment,
	findBuiltIn,
	type Locale,
	uniqueId,
} from "@faultworks/experiment";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { detectLanguage } from "#/i18n/index.ts";
import { safeStorage } from "./storage.ts";

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
	createVariant(
		id: string,
		label: string,
		descriptionPrompt: string,
	): string | null;
	renameExperiment(id: string, nextId: string): string | null;
	resetToBuiltIn(id: string, locale: Locale): void;
	restoreBuiltIns(locale: Locale): number;
}

const COALESCE_MS = 800;
const HISTORY_LIMIT = 100;

function seedEntries(now: number, locale: Locale) {
	const entries: Record<string, LibraryEntry> = {};
	for (const experiment of builtInExperiments(locale))
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
			entries: seedEntries(Date.now(), detectLanguage()),
			order: [...EXAMPLE_IDS],
			seeded: [...EXAMPLE_IDS],
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

			createVariant(id, label, descriptionPrompt) {
				const state = get();
				const entry = state.entries[id];
				if (!entry) return null;
				const variant = cloneExperiment(
					entry.experiment,
					Object.keys(state.entries),
					label,
					descriptionPrompt,
				);
				return get().add(variant, "variant", id);
			},

			renameExperiment(id, nextId) {
				const state = get();
				const entry = state.entries[id];
				if (!entry || nextId === id) return entry ? id : null;
				if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(nextId) || state.entries[nextId])
					return null;
				const entries: Record<string, LibraryEntry> = {};
				for (const [key, value] of Object.entries(state.entries)) {
					const moved =
						key === id
							? {
									...value,
									experiment: { ...value.experiment, experimentId: nextId },
								}
							: value;
					entries[key === id ? nextId : key] =
						moved.basedOn === id ? { ...moved, basedOn: nextId } : moved;
				}
				const history = { ...state.history };
				if (history[id]) {
					history[nextId] = history[id];
					delete history[id];
				}
				set({
					entries,
					history,
					order: state.order.map((x) => (x === id ? nextId : x)),
				});
				return nextId;
			},

			resetToBuiltIn(id, locale) {
				const original = findBuiltIn(id, locale);
				if (!original) return;
				get().update(id, () => structuredClone(original));
			},

			restoreBuiltIns(locale) {
				const state = get();
				const missing = builtInExperiments(locale).filter(
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
			version: 2,
			storage: createJSONStorage(() => safeStorage),
			partialize: (state) => ({
				entries: state.entries,
				order: state.order,
				seeded: state.seeded,
			}),
			migrate: (persisted) => persisted as never,
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
				for (const e of builtInExperiments(detectLanguage()))
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

import type { Experiment } from "@faultworks/experiment";
import { createContext, useContext } from "react";
import type { Validation } from "#/state/validation.ts";
import type { RunResult } from "#/workers/protocol.ts";

/** What the inspector shows: a component, a link, or one of the global panels. */
export type Selection =
	| { type: "node"; id: string }
	| { type: "link"; id: string }
	| null;
export type InspectorTab = "component" | "traffic" | "faults" | "run" | "notes";
export type ResultsTab = "overview" | "explain" | "events" | "checks";
/** Phone layout: one of three screens at a time. */
export type PhoneTab = "build" | "replay" | "results";

export interface WorkbenchContextValue {
	id: string;
	experiment: Experiment;
	update: (recipe: (e: Experiment) => Experiment, coalesceKey?: string) => void;
	validation: Validation;
	selection: Selection;
	select: (selection: Selection) => void;
	inspectorTab: InspectorTab;
	setInspectorTab: (tab: InspectorTab) => void;
	result: RunResult | null;
	/** The shown result was produced from different behavior settings than the current ones. */
	stale: boolean;
	running: boolean;
	run: (options?: { reveal?: boolean }) => void;
	phone: boolean;
	phoneTab: PhoneTab;
	setPhoneTab: (tab: PhoneTab) => void;
}

export const WorkbenchContext = createContext<WorkbenchContextValue | null>(
	null,
);

export function useWorkbench(): WorkbenchContextValue {
	const value = useContext(WorkbenchContext);
	if (!value) throw new Error("useWorkbench must be used inside the workbench");
	return value;
}

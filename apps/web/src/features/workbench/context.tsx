import type { Experiment } from "@faultworks/experiment";
import { createContext, useContext } from "react";
import type { Validation } from "#/state/validation.ts";
import type { RunResult } from "#/workers/protocol.ts";

export type InspectorTab = "component" | "traffic" | "faults" | "run" | "notes";
export type ResultsTab = "overview" | "explain" | "events" | "checks";

export interface WorkbenchContextValue {
	id: string;
	experiment: Experiment;
	update: (recipe: (e: Experiment) => Experiment, coalesceKey?: string) => void;
	validation: Validation;
	selectedNode: string | null;
	selectNode: (id: string | null) => void;
	inspectorTab: InspectorTab;
	setInspectorTab: (tab: InspectorTab) => void;
	result: RunResult | null;
	/** The shown result was produced from different behavior settings than the current ones. */
	stale: boolean;
	running: boolean;
	run: (options?: { reveal?: boolean }) => void;
}

export const WorkbenchContext = createContext<WorkbenchContextValue | null>(
	null,
);

export function useWorkbench(): WorkbenchContextValue {
	const value = useContext(WorkbenchContext);
	if (!value) throw new Error("useWorkbench must be used inside the workbench");
	return value;
}

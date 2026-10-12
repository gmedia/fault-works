import {
	type Experiment,
	parseExperiment,
	runKey,
	type ValidationIssue,
} from "@faultworks/experiment";
import { useMemo } from "react";

export interface Validation {
	valid: boolean;
	issues: ValidationIssue[];
	/** Issues keyed by exact path, for messages next to fields. */
	byPath: Map<string, ValidationIssue[]>;
	/** Only available for a valid experiment. */
	runKey: string | null;
}

export function validate(experiment: Experiment): Validation {
	const parsed = parseExperiment(experiment);
	const issues = parsed.ok ? [] : parsed.issues;
	const byPath = new Map<string, ValidationIssue[]>();
	for (const issue of issues)
		byPath.set(issue.path, [...(byPath.get(issue.path) ?? []), issue]);
	return {
		valid: parsed.ok,
		issues,
		byPath,
		runKey: parsed.ok ? runKey(parsed.experiment) : null,
	};
}

export function useValidation(
	experiment: Experiment | undefined,
): Validation | null {
	return useMemo(
		() => (experiment ? validate(experiment) : null),
		[experiment],
	);
}

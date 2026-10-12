import failoverOverload from "../../../examples/failover-overload.experiment.json";
import hangingBackend from "../../../examples/hanging-backend.experiment.json";
import noHealthChecks from "../../../examples/lb-failure-no-health-checks.experiment.json";
import withHealthChecks from "../../../examples/lb-failure-with-health-checks.experiment.json";
import randomTrafficBurst from "../../../examples/random-traffic-burst.experiment.json";
import type { Experiment } from "./schema.ts";
import { parseExperiment } from "./validate.ts";

const RAW: unknown[] = [
	noHealthChecks,
	withHealthChecks,
	hangingBackend,
	failoverOverload,
	randomTrafficBurst,
];

/** Bundled experiments, validated at load so a broken example fails loudly in tests and dev. */
export const BUILT_IN_EXPERIMENTS: readonly Experiment[] = RAW.map((raw) => {
	const result = parseExperiment(raw);
	if (!result.ok)
		throw new Error(
			`Built-in experiment is invalid: ${result.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`,
		);
	return result.experiment;
});

/** The first-use journey: run the baseline, then compare it with exactly one change. */
export const STARTER_COMPARISON = {
	a: "lb-failure-no-health-checks",
	b: "lb-failure-with-health-checks",
} as const;

export function findBuiltIn(id: string): Experiment | undefined {
	return BUILT_IN_EXPERIMENTS.find((e) => e.experimentId === id);
}

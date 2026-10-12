import enCacheStampede from "../../../examples/en/cache-stampede.experiment.json";
import enCascading from "../../../examples/en/cascading-failure.experiment.json";
import enCircuitBreaker from "../../../examples/en/circuit-breaker.experiment.json";
import enFailoverOverload from "../../../examples/en/failover-overload.experiment.json";
import enHangingBackend from "../../../examples/en/hanging-backend.experiment.json";
import enNoHealthChecks from "../../../examples/en/lb-failure-no-health-checks.experiment.json";
import enWithHealthChecks from "../../../examples/en/lb-failure-with-health-checks.experiment.json";
import enRandomTrafficBurst from "../../../examples/en/random-traffic-burst.experiment.json";
import enRetryStorm from "../../../examples/en/retry-storm.experiment.json";
import enWorkerQueue from "../../../examples/en/worker-queue-backlog.experiment.json";
import idCacheStampede from "../../../examples/id/cache-stampede.experiment.json";
import idCascading from "../../../examples/id/cascading-failure.experiment.json";
import idCircuitBreaker from "../../../examples/id/circuit-breaker.experiment.json";
import idFailoverOverload from "../../../examples/id/failover-overload.experiment.json";
import idHangingBackend from "../../../examples/id/hanging-backend.experiment.json";
import idNoHealthChecks from "../../../examples/id/lb-failure-no-health-checks.experiment.json";
import idWithHealthChecks from "../../../examples/id/lb-failure-with-health-checks.experiment.json";
import idRandomTrafficBurst from "../../../examples/id/random-traffic-burst.experiment.json";
import idRetryStorm from "../../../examples/id/retry-storm.experiment.json";
import idWorkerQueue from "../../../examples/id/worker-queue-backlog.experiment.json";
import type { Experiment } from "./schema.ts";
import { parseExperiment } from "./validate.ts";

export const LOCALES = ["id", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const RAW: Record<Locale, unknown[]> = {
	id: [
		idNoHealthChecks,
		idWithHealthChecks,
		idHangingBackend,
		idFailoverOverload,
		idCascading,
		idRetryStorm,
		idCircuitBreaker,
		idCacheStampede,
		idWorkerQueue,
		idRandomTrafficBurst,
	],
	en: [
		enNoHealthChecks,
		enWithHealthChecks,
		enHangingBackend,
		enFailoverOverload,
		enCascading,
		enRetryStorm,
		enCircuitBreaker,
		enCacheStampede,
		enWorkerQueue,
		enRandomTrafficBurst,
	],
};

function validateAll(list: unknown[]): Experiment[] {
	return list.map((raw) => {
		const result = parseExperiment(raw);
		if (!result.ok)
			throw new Error(
				`Built-in experiment is invalid: ${result.issues.map((i) => `${i.path} ${i.message.key} ${JSON.stringify(i.message.params ?? {})}`).join("; ")}`,
			);
		return result.experiment;
	});
}

const cache = new Map<Locale, readonly Experiment[]>();

/** Bundled experiments in one language, validated at first use so a broken example fails loudly. */
export function builtInExperiments(locale: Locale): readonly Experiment[] {
	let list = cache.get(locale);
	if (!list) {
		list = validateAll(RAW[locale]);
		cache.set(locale, list);
	}
	return list;
}

export const EXAMPLE_IDS: readonly string[] = [
	"lb-failure-no-health-checks",
	"lb-failure-with-health-checks",
	"hanging-backend",
	"failover-overload",
	"cascading-failure",
	"retry-storm",
	"circuit-breaker",
	"cache-stampede",
	"worker-queue-backlog",
	"random-traffic-burst",
];

/** The first-use journey: run the baseline, then compare it with exactly one change. */
export const STARTER_COMPARISON = {
	a: "lb-failure-no-health-checks",
	b: "lb-failure-with-health-checks",
} as const;

export function findBuiltIn(
	id: string,
	locale: Locale = "en",
): Experiment | undefined {
	return builtInExperiments(locale).find((e) => e.experimentId === id);
}

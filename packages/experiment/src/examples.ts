import enCacheStampede from "../../../examples/en/cache-stampede.experiment.json";
import enCascading from "../../../examples/en/cascading-failure.experiment.json";
import enCdnPurge from "../../../examples/en/cdn-purge.experiment.json";
import enCircuitBreaker from "../../../examples/en/circuit-breaker.experiment.json";
import enDbClusterFailover from "../../../examples/en/db-cluster-failover.experiment.json";
import enDeadlinePropagation from "../../../examples/en/deadline-propagation.experiment.json";
import enFailoverOverload from "../../../examples/en/failover-overload.experiment.json";
import enFanOutTailLatency from "../../../examples/en/fan-out-tail-latency.experiment.json";
import enFlashSaleNoRateLimit from "../../../examples/en/flash-sale-no-rate-limit.experiment.json";
import enFlashSaleWithRateLimit from "../../../examples/en/flash-sale-with-rate-limit.experiment.json";
import enHangingBackend from "../../../examples/en/hanging-backend.experiment.json";
import enNoHealthChecks from "../../../examples/en/lb-failure-no-health-checks.experiment.json";
import enWithHealthChecks from "../../../examples/en/lb-failure-with-health-checks.experiment.json";
import enMemoryLeak from "../../../examples/en/memory-leak.experiment.json";
import enPostgresTooManyConnections from "../../../examples/en/postgres-too-many-connections.experiment.json";
import enPostgresWithPooler from "../../../examples/en/postgres-with-pooler.experiment.json";
import enRandomTrafficBurst from "../../../examples/en/random-traffic-burst.experiment.json";
import enRetryStorm from "../../../examples/en/retry-storm.experiment.json";
import enRetryWithBackoff from "../../../examples/en/retry-with-backoff.experiment.json";
import enWorkerQueue from "../../../examples/en/worker-queue-backlog.experiment.json";
import idCacheStampede from "../../../examples/id/cache-stampede.experiment.json";
import idCascading from "../../../examples/id/cascading-failure.experiment.json";
import idCdnPurge from "../../../examples/id/cdn-purge.experiment.json";
import idCircuitBreaker from "../../../examples/id/circuit-breaker.experiment.json";
import idDbClusterFailover from "../../../examples/id/db-cluster-failover.experiment.json";
import idDeadlinePropagation from "../../../examples/id/deadline-propagation.experiment.json";
import idFailoverOverload from "../../../examples/id/failover-overload.experiment.json";
import idFanOutTailLatency from "../../../examples/id/fan-out-tail-latency.experiment.json";
import idFlashSaleNoRateLimit from "../../../examples/id/flash-sale-no-rate-limit.experiment.json";
import idFlashSaleWithRateLimit from "../../../examples/id/flash-sale-with-rate-limit.experiment.json";
import idHangingBackend from "../../../examples/id/hanging-backend.experiment.json";
import idNoHealthChecks from "../../../examples/id/lb-failure-no-health-checks.experiment.json";
import idWithHealthChecks from "../../../examples/id/lb-failure-with-health-checks.experiment.json";
import idMemoryLeak from "../../../examples/id/memory-leak.experiment.json";
import idPostgresTooManyConnections from "../../../examples/id/postgres-too-many-connections.experiment.json";
import idPostgresWithPooler from "../../../examples/id/postgres-with-pooler.experiment.json";
import idRandomTrafficBurst from "../../../examples/id/random-traffic-burst.experiment.json";
import idRetryStorm from "../../../examples/id/retry-storm.experiment.json";
import idRetryWithBackoff from "../../../examples/id/retry-with-backoff.experiment.json";
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
		idPostgresTooManyConnections,
		idPostgresWithPooler,
		idDbClusterFailover,
		idCdnPurge,
		idFlashSaleNoRateLimit,
		idFlashSaleWithRateLimit,
		idRetryWithBackoff,
		idDeadlinePropagation,
		idFanOutTailLatency,
		idMemoryLeak,
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
		enPostgresTooManyConnections,
		enPostgresWithPooler,
		enDbClusterFailover,
		enCdnPurge,
		enFlashSaleNoRateLimit,
		enFlashSaleWithRateLimit,
		enRetryWithBackoff,
		enDeadlinePropagation,
		enFanOutTailLatency,
		enMemoryLeak,
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
	"postgres-too-many-connections",
	"postgres-with-pooler",
	"db-cluster-failover",
	"cdn-purge",
	"flash-sale-no-rate-limit",
	"flash-sale-with-rate-limit",
	"retry-with-backoff",
	"deadline-propagation",
	"fan-out-tail-latency",
	"memory-leak",
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

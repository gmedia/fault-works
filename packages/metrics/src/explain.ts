import type { FailureReason } from "@faultworks/engine";
import type { RunSummary } from "./types.ts";

/**
 * Explains a run from recorded events and counts only; it never guesses a cause the model did
 * not produce. Every insight is a translation key with parameters so the app can render it in
 * the user's language.
 */
export interface Insight {
	id: string;
	tone: "neutral" | "good" | "warning" | "critical";
	key: string;
	params: Record<string, string | number | boolean | null>;
	/** Simulated time the insight is about, for "replay from" links. */
	atMs?: number;
}

const share = (part: number, whole: number) =>
	whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;

export function explainRun(summary: RunSummary): Insight[] {
	const out: Insight[] = [];
	const failedShare = summary.failed / Math.max(1, summary.offered);

	out.push({
		id: "outcome",
		tone:
			summary.failed === 0
				? "good"
				: failedShare > 0.05
					? "critical"
					: "warning",
		key: "insight.outcome",
		params: {
			succeeded: summary.succeeded,
			offered: summary.offered,
			failed: summary.failed,
			inFlight: summary.inFlight,
			measuredMs: summary.measuredMs,
			successPct: share(summary.succeeded, summary.offered),
		},
	});

	// Where failures originate, which is the lesson in any chain.
	const topOrigin = summary.failedByOrigin[0];
	if (topOrigin && summary.failed > 0 && summary.nodes.length > 2) {
		const node = summary.nodes[topOrigin.node];
		const reasons = node
			? (Object.entries(node.failedByReason) as Array<[FailureReason, number]>)
					.filter(([, c]) => c > 0)
					.sort((a, b) => b[1] - a[1])
			: [];
		out.push({
			id: "origin",
			tone: "critical",
			key: "insight.origin",
			params: {
				node: node?.label ?? "client",
				count: topOrigin.count,
				pct: share(topOrigin.count, summary.failed),
				reason: reasons[0]?.[0] ?? null,
				reasonCount: reasons[0]?.[1] ?? 0,
			},
		});
	}

	for (const f of summary.faults) {
		if (f.kind === "node-failure") {
			const watched = f.possibleDetectionMs !== null;
			out.push({
				id: `fault-${f.id}`,
				tone: f.failedWhileUndetected > 0 ? "critical" : "warning",
				key: watched
					? f.detectedAtMs !== null
						? "insight.crashDetected"
						: f.endedAtMs !== null
							? "insight.crashRecoveredFirst"
							: "insight.crashNeverDetected"
					: "insight.crashUnwatched",
				params: {
					node: f.nodeLabel,
					atMs: f.startedAtMs,
					behavior: f.behavior,
					detectedAtMs: f.detectedAtMs,
					delayMs: f.detectionDelayMs,
					recoveredAtMs: f.endedAtMs,
					restoredAtMs: f.restoredAtMs,
					restoreDelayMs:
						f.restoredAtMs !== null && f.endedAtMs !== null
							? f.restoredAtMs - f.endedAtMs
							: null,
					lost: f.failedWhileUndetected,
					minMs: f.possibleDetectionMs?.min ?? null,
					maxMs: f.possibleDetectionMs?.max ?? null,
					onTick: f.crashOnProbeTick,
				},
				atMs: f.startedAtMs,
			});
		} else {
			out.push({
				id: `fault-${f.id}`,
				tone: "warning",
				key: `insight.fault.${f.kind}`,
				params: {
					target: f.nodeLabel,
					atMs: f.startedAtMs,
					untilMs: f.endedAtMs,
				},
				atMs: f.startedAtMs,
			});
		}
	}

	const reasons = (
		Object.entries(summary.failedByReason) as Array<[FailureReason, number]>
	)
		.filter(([, c]) => c > 0)
		.sort((a, b) => b[1] - a[1]);
	const top = reasons[0];
	if (top && summary.failed > 0)
		out.push({
			id: "failure-mix",
			tone: "neutral",
			key: "insight.failureMix",
			params: {
				reason: top[0],
				count: top[1],
				failed: summary.failed,
				pct: share(top[1], summary.failed),
				others: reasons
					.slice(1)
					.map(([r, c]) => `${r}:${c}`)
					.join(","),
			},
		});

	for (const n of summary.nodes) {
		if (
			n.kind === "client" ||
			n.kind === "load-balancer" ||
			n.kind === "db-cluster"
		)
			continue;
		if (n.kind === "rate-limiter") {
			const limited = n.failedByReason["rate-limited"];
			if (limited > 0)
				out.push({
					id: `limited-${n.id}`,
					tone: "warning",
					key: "insight.rateLimited",
					params: {
						node: n.label,
						count: limited,
						pct: share(limited, summary.offered),
					},
				});
			continue;
		}
		const rejected = n.failedByReason["queue-full"];
		// Contention: own work took clearly longer than at a concurrency of one.
		if (
			(n.contention > 0 || n.coherency > 0) &&
			n.baseWorkMs !== null &&
			n.meanWorkMs !== null &&
			n.meanWorkMs >= n.baseWorkMs * 1.3
		)
			out.push({
				id: `contention-${n.id}`,
				tone: n.meanWorkMs >= n.baseWorkMs * 3 ? "critical" : "warning",
				key: "insight.contention",
				params: {
					node: n.label,
					factor: Math.round((n.meanWorkMs / n.baseWorkMs) * 10) / 10,
					peakBusy: n.peakBusy,
					optimal:
						n.coherency > 0
							? Math.max(
									1,
									Math.round(Math.sqrt((1 - n.contention) / n.coherency)),
								)
							: null,
				},
			});
		const waitedOut = n.failedByReason["queue-timeout"];
		if (waitedOut > 0)
			out.push({
				id: `queue-timeout-${n.id}`,
				tone: "warning",
				key: "insight.queueTimeout",
				params: { node: n.label, count: waitedOut, capacity: n.capacity },
			});
		if (n.queueCapacity === 0 && rejected > 0 && n.kind !== "queue")
			out.push({
				id: `full-${n.id}`,
				tone: "critical",
				key: "insight.noRoom",
				params: { node: n.label, capacity: n.capacity, rejected },
			});
		if (n.queueCapacity > 0 && n.peakQueue >= n.queueCapacity)
			out.push({
				id: `saturation-${n.id}`,
				tone: rejected > 0 ? "critical" : "warning",
				key: "insight.saturated",
				params: {
					node: n.label,
					queueCapacity: n.queueCapacity,
					rejected,
					utilizationPct: share(n.utilization, 1),
				},
			});
		else if (n.utilization >= 0.85)
			out.push({
				id: `busy-${n.id}`,
				tone: "warning",
				key: "insight.nearlySaturated",
				params: {
					node: n.label,
					utilizationPct: share(n.utilization, 1),
					peakQueue: n.peakQueue,
					queueCapacity: n.queueCapacity,
				},
			});
		if (n.kind === "cache" && n.hitRatio !== null)
			out.push({
				id: `cache-${n.id}`,
				tone: "neutral",
				key: "insight.cache",
				params: {
					node: n.label,
					hitPct: share(n.hitRatio, 1),
					lookups: n.calls,
				},
			});
		if (n.kind === "queue" && n.jobs)
			out.push({
				id: `queue-${n.id}`,
				tone:
					n.jobs.maxWaitMs > 5000 || n.jobs.failed > 0 ? "warning" : "neutral",
				key: "insight.queue",
				params: {
					node: n.label,
					done: n.jobs.done,
					failed: n.jobs.failed,
					maxWaitMs: n.jobs.maxWaitMs,
					meanWaitMs: n.jobs.meanWaitMs,
					peakBacklog: n.peakQueue,
				},
			});
	}

	for (const p of summary.promotions)
		out.push({
			id: `promoted-${p.cluster}-${p.atMs}`,
			tone: "warning",
			key: "insight.failover",
			params: {
				cluster: summary.nodes[p.cluster]?.label ?? "",
				from: summary.nodes[p.from]?.label ?? "",
				to: summary.nodes[p.to]?.label ?? "",
				atMs: p.atMs,
				failed: summary.nodes[p.from]?.failed ?? 0,
			},
			atMs: p.atMs,
		});

	const skipped = summary.nodes.reduce(
		(sum, n) => sum + n.abandoned.deadline,
		0,
	);
	if (skipped > 0)
		out.push({
			id: "deadline",
			tone: "good",
			key: "insight.deadlineSkipped",
			params: { count: skipped },
		});

	// Retries: calls on a link far above the requests that needed them.
	for (const l of summary.links) {
		if (l.retries > 0 && l.retries >= 0.2 * (l.calls - l.retries)) {
			const target = summary.nodes[l.target];
			out.push({
				id: `retries-${l.id}`,
				tone: "warning",
				key: "insight.retries",
				params: {
					target: target?.label ?? l.id,
					calls: l.calls,
					retries: l.retries,
					pct: share(l.retries, l.calls),
				},
			});
		}
		if (l.breakerOpens > 0) {
			const target = summary.nodes[l.target];
			const source = summary.nodes[l.source];
			out.push({
				id: `breaker-${l.id}`,
				tone: "neutral",
				key: "insight.breaker",
				params: {
					source: source?.label ?? "",
					target: target?.label ?? "",
					opens: l.breakerOpens,
					rejected: summary.failedByReason["circuit-open"],
				},
			});
		}
	}

	const lat = summary.successLatency;
	if (lat) {
		const spread = lat.p95Ms >= lat.p50Ms * 2 && lat.p95Ms - lat.p50Ms >= 5;
		const ended = summary.completedLatency;
		const failuresSlow =
			ended !== null &&
			ended.p95Ms >= lat.p95Ms * 1.5 &&
			ended.p95Ms - lat.p95Ms >= 5;
		out.push({
			id: "latency",
			tone: spread || failuresSlow ? "warning" : "neutral",
			key: failuresSlow
				? "insight.latencyFailuresSlow"
				: spread
					? "insight.latencyTail"
					: "insight.latencyFlat",
			params: {
				p50Ms: lat.p50Ms,
				p95Ms: lat.p95Ms,
				n: lat.n,
				endedP95Ms: ended?.p95Ms ?? null,
				endedN: ended?.n ?? null,
			},
		});
	}

	if (summary.probes > 0)
		out.push({
			id: "probes",
			tone: "neutral",
			key: "insight.probes",
			params: { probes: summary.probes },
		});
	if (summary.lateResponses > 0)
		out.push({
			id: "late",
			tone: "warning",
			key: "insight.late",
			params: { late: summary.lateResponses },
		});
	if (summary.status === "event-limit")
		out.push({
			id: "event-limit",
			tone: "critical",
			key: "insight.eventLimit",
			params: { measuredMs: summary.measuredMs },
		});

	return out;
}

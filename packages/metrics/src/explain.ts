import type { FailureReason } from "@faultworks/engine";
import type { RunSummary } from "./types.ts";

export const FAILURE_REASON_INFO: Record<
	FailureReason,
	{ label: string; description: string }
> = {
	"backend-refused": {
		label: "Backend refused",
		description:
			"The load balancer sent the request to a server that had crashed.",
	},
	"server-crashed": {
		label: "Lost in crash",
		description:
			"The request was being served or waiting in a queue when the server crashed.",
	},
	timeout: {
		label: "Timed out",
		description: "No response arrived before the client timeout.",
	},
	"queue-full": {
		label: "Queue full",
		description: "Every slot was busy and the queue had no room left.",
	},
	"no-healthy-backend": {
		label: "No healthy backend",
		description:
			"The load balancer had no backend marked healthy to send the request to.",
	},
};

export interface Insight {
	id: string;
	tone: "neutral" | "good" | "warning" | "critical";
	title: string;
	body: string;
	/** Simulated time the insight is about, for "jump to" links. */
	atMs?: number;
}

const n = (v: number) => v.toLocaleString("en-US");
export const formatMs = (ms: number) =>
	ms >= 1000
		? `${(ms / 1000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 3 })} s`
		: `${ms.toLocaleString("en-US", { maximumFractionDigits: 1 })} ms`;
const pct = (part: number, whole: number) =>
	whole === 0
		? "0%"
		: `${((part / whole) * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

/**
 * Explains a run in plain sentences built only from recorded events and their counts. It never
 * guesses a cause the model did not produce.
 */
export function explainRun(
	summary: RunSummary,
	healthChecks: boolean,
): Insight[] {
	const out: Insight[] = [];

	out.push({
		id: "outcome",
		tone:
			summary.failed === 0
				? "good"
				: summary.failed / Math.max(1, summary.offered) > 0.05
					? "critical"
					: "warning",
		title: `${pct(summary.succeeded, summary.offered)} of requests succeeded`,
		body: `${n(summary.succeeded)} of ${n(summary.offered)} offered requests succeeded and ${n(summary.failed)} failed${summary.inFlight > 0 ? `; ${n(summary.inFlight)} were still in flight when the run stopped at ${formatMs(summary.measuredMs)}` : ""}.`,
	});

	for (const f of summary.faults) {
		const behavior =
			f.behavior === "refuse"
				? "refusing connections"
				: "hanging without answering";
		let detection: string;
		if (!healthChecks)
			detection = `Health checks were off, so the load balancer kept sending it traffic${f.recoveredAtMs !== null ? ` until it recovered at ${formatMs(f.recoveredAtMs)}` : " for the rest of the run"}.`;
		else if (f.detectedAtMs !== null && f.detectionDelayMs !== null)
			detection = `The load balancer marked it unhealthy at ${formatMs(f.detectedAtMs)}, ${formatMs(f.detectionDelayMs)} after the crash.`;
		else
			detection =
				f.recoveredAtMs !== null
					? `It recovered at ${formatMs(f.recoveredAtMs)} before the health checks noticed.`
					: "The health checks never marked it unhealthy before the run ended.";
		const lost = `${n(f.failedWhileUndetected)} request${f.failedWhileUndetected === 1 ? "" : "s"} failed because ${f.failedWhileUndetected === 1 ? "it was" : "they were"} lost in the crash or sent to the server before the failure was noticed.`;
		let restore = "";
		if (f.recoveredAtMs !== null && healthChecks)
			restore =
				f.restoredAtMs !== null
					? ` It got traffic again at ${formatMs(f.restoredAtMs)}, ${formatMs(f.restoredAtMs - f.recoveredAtMs)} after it recovered.`
					: " It had not been put back into rotation when the run ended.";
		out.push({
			id: `fault-${f.id}`,
			tone: f.failedWhileUndetected > 0 ? "critical" : "warning",
			title: `${f.serverLabel} failed at ${formatMs(f.failedAtMs)}`,
			body: `${f.serverLabel} went down at ${formatMs(f.failedAtMs)}, ${behavior}. ${detection} ${lost}${restore}`,
			atMs: f.failedAtMs,
		});
	}

	const reasons = (
		Object.entries(summary.failedByReason) as Array<[FailureReason, number]>
	)
		.filter(([, count]) => count > 0)
		.sort((a, b) => b[1] - a[1]);
	const top = reasons[0];
	if (top && summary.failed > 0) {
		const [reason, count] = top;
		out.push({
			id: "failure-mix",
			tone: "neutral",
			title: `Most failures: ${FAILURE_REASON_INFO[reason].label.toLowerCase()}`,
			body: `${n(count)} of ${n(summary.failed)} failures (${pct(count, summary.failed)}) were "${FAILURE_REASON_INFO[reason].label}". ${FAILURE_REASON_INFO[reason].description}${
				reasons.length > 1
					? ` Others: ${reasons
							.slice(1)
							.map(
								([r, c]) =>
									`${FAILURE_REASON_INFO[r].label.toLowerCase()} ${n(c)}`,
							)
							.join(", ")}.`
					: ""
			}`,
		});
	}

	for (const s of summary.servers) {
		const rejected = s.failedByReason["queue-full"];
		if (s.queueCapacity > 0 && s.peakQueue >= s.queueCapacity)
			out.push({
				id: `saturation-${s.id}`,
				tone: rejected > 0 ? "critical" : "warning",
				title: `${s.label} ran out of room`,
				body: `${s.label}'s queue reached its limit of ${n(s.queueCapacity)} requests${rejected > 0 ? ` and ${n(rejected)} requests were rejected` : ""}. Its slots were busy ${pct(s.utilization, 1)} of the run.`,
			});
		else if (s.utilization >= 0.85)
			out.push({
				id: `busy-${s.id}`,
				tone: "warning",
				title: `${s.label} was nearly saturated`,
				body: `${s.label}'s slots were busy ${pct(s.utilization, 1)} of the run; peak queue ${n(s.peakQueue)} of ${n(s.queueCapacity)}.`,
			});
	}

	const lat = summary.successLatency;
	if (lat) {
		const spread = lat.p95Ms >= lat.p50Ms * 2 && lat.p95Ms - lat.p50Ms >= 5;
		const ended = summary.completedLatency;
		// Failures hidden from success latency (timeouts above all) can dominate what clients wait.
		const failuresSlow =
			ended !== null &&
			ended.p95Ms >= lat.p95Ms * 1.5 &&
			ended.p95Ms - lat.p95Ms >= 5;
		out.push({
			id: "latency",
			tone: spread || failuresSlow ? "warning" : "neutral",
			title: failuresSlow
				? "Failed requests made clients wait longest"
				: spread
					? "Latency has a long tail"
					: "Successful requests were consistently fast",
			body: `Successful requests took ${formatMs(lat.p50Ms)} at the median and ${formatMs(lat.p95Ms)} at p95 (n = ${n(lat.n)}).${spread ? " The gap comes from time spent waiting in queues." : ""}${
				failuresSlow && ended
					? ` Counting every request that ended, failures included, p95 is ${formatMs(ended.p95Ms)} (n = ${n(ended.n)}): a timed-out client waits the full timeout before it learns the request failed.`
					: ""
			}`,
		});
	}

	if (summary.lateResponses > 0)
		out.push({
			id: "late",
			tone: "warning",
			title: `${n(summary.lateResponses)} responses arrived too late`,
			body: `Servers finished ${n(summary.lateResponses)} requests after the client had already given up. That work used capacity but counts only as a timeout.`,
		});

	if (summary.status === "event-limit")
		out.push({
			id: "event-limit",
			tone: "critical",
			title: "The run stopped early",
			body: `The run hit the event limit at ${formatMs(summary.measuredMs)}. Results cover only that part; shorten the traffic or lower the rate.`,
		});

	return out;
}

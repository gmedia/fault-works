import {
	compileExperiment,
	type Experiment,
	findBuiltIn,
} from "@faultworks/experiment";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compareSummaries } from "./compare.ts";
import { explainRun } from "./explain.ts";
import { firstEventAtOrAfter, readEventRow } from "./log.ts";
import { nearestRank } from "./percentile.ts";
import { runSimulation } from "./run.ts";

function runBuiltIn(id: string, edit?: (e: Experiment) => void) {
	const experiment = structuredClone(findBuiltIn(id) as Experiment);
	edit?.(experiment);
	const compiled = compileExperiment(experiment);
	return runSimulation(compiled.engine, {
		labels: compiled.topology.nodeLabels,
		windowMs: compiled.sampleWindowMs,
		recordLog: true,
	});
}

const node = (metrics: ReturnType<typeof runBuiltIn>["metrics"], id: string) =>
	metrics.summary.nodes.find((n) => n.id === id);

describe("golden scenarios (unchanged from v0.1)", () => {
	it("no health checks: every request sent to dead Server B fails", () => {
		const { metrics } = runBuiltIn("lb-failure-no-health-checks");
		const s = metrics.summary;
		expect(s.offered).toBe(6000);
		expect(s.failedByReason.refused).toBe(1000);
		expect(s.failedByReason["lost-in-crash"]).toBe(5);
		expect(s.failed).toBe(1005);
		expect(s.succeeded).toBe(4995);
		expect(s.inFlight).toBe(0);
		expect(s.successLatency).toMatchObject({ p50Ms: 100, p95Ms: 100, n: 4995 });
		expect(s.faults[0]).toMatchObject({
			detectedAtMs: null,
			restoredAtMs: 40_000,
			failedWhileUndetected: 1005,
			possibleDetectionMs: null,
		});
		expect(metrics.checks.every((c) => c.passed)).toBe(true);
	});

	it("health checks: failures stop after the second failed probe", () => {
		const { metrics } = runBuiltIn("lb-failure-with-health-checks");
		const s = metrics.summary;
		expect(s.faults[0]).toMatchObject({
			startedAtMs: 20_000,
			detectedAtMs: 25_000,
			detectionDelayMs: 5000,
			endedAtMs: 40_000,
			restoredAtMs: 45_000,
			failedWhileUndetected: 255,
			possibleDetectionMs: { min: 5000, max: 10_000 },
			crashOnProbeTick: true,
		});
		expect(s.failedByReason.refused).toBe(250);
		expect(s.failed).toBe(255);
		expect(s.succeeded).toBe(5745);
	});

	it("hanging backend: requests time out and detection waits for probe timeouts", () => {
		const { metrics } = runBuiltIn("hanging-backend");
		const s = metrics.summary;
		expect(s.faults[0]).toMatchObject({
			detectedAtMs: 27_000,
			detectionDelayMs: 7000,
			possibleDetectionMs: { min: 7000, max: 12_000 },
		});
		expect(s.failedByReason.timeout).toBe(355);
		expect(s.failed).toBe(355);
		expect(s.completedLatency?.maxMs).toBe(1000);
		expect(s.failedWaitMs).toBe(355 * 1000);
	});

	it("failover overload: Server A's queue fills and rejects", () => {
		const { metrics } = runBuiltIn("failover-overload");
		const a = node(metrics, "server-a");
		expect(a?.peakQueue).toBe(50);
		expect(a?.failedByReason["queue-full"]).toBeGreaterThan(0);
		expect(metrics.summary.successLatency?.p95Ms).toBeGreaterThan(500);
	});

	it("random burst: deterministic per seed, different across seeds, window-size invariant", () => {
		const first = runBuiltIn("random-traffic-burst");
		const again = runBuiltIn("random-traffic-burst");
		const other = runBuiltIn("random-traffic-burst", (e) => {
			e.seed = 8;
		});
		const coarse = runBuiltIn("random-traffic-burst", (e) => {
			e.run.sampleWindowMs = 5000;
		});
		expect(again.metrics.traceDigest).toBe(first.metrics.traceDigest);
		expect(again.metrics.summary).toEqual(first.metrics.summary);
		expect(other.metrics.traceDigest).not.toBe(first.metrics.traceDigest);
		expect(coarse.metrics.traceDigest).toBe(first.metrics.traceDigest);
		expect(coarse.metrics.summary).toEqual(first.metrics.summary);
		expect(first.metrics.checks.every((c) => c.passed)).toBe(true);
	});
});

describe("new scenarios", () => {
	it("cascading failure: a slow database makes clients time out at the API", () => {
		const { metrics } = runBuiltIn("cascading-failure");
		const s = metrics.summary;
		const api = node(metrics, "api");
		expect(s.failed).toBeGreaterThan(1500);
		// The API never rejects: its queue is large, so requests wait for a slot and time out instead.
		// Timed-out requests still reach a slot, finish without calling the database and drain fast,
		// which keeps the queue far below its size.
		expect(api?.peakQueue).toBeGreaterThan(100);
		expect(api?.failedByReason["queue-full"] ?? 0).toBe(0);
		expect(s.failedByReason.timeout).toBeGreaterThan(1500);
		// After the database recovers the API still has to drain the old queue (late responses).
		expect(s.lateResponses).toBeGreaterThan(1000);
		// Failures originate at the API and at the database (timeouts attributed to the slow node).
		const origins = s.failedByOrigin.map((o) => s.nodes[o.node]?.id);
		expect(origins).toEqual(expect.arrayContaining(["api"]));
		expect(explainRun(s).some((i) => i.id === "origin")).toBe(true);
		expect(metrics.checks.every((c) => c.passed)).toBe(true);
	});

	it("retry storm: database calls multiply beyond client requests", () => {
		const { metrics } = runBuiltIn("retry-storm");
		const link = metrics.summary.links.find((l) => l.id === "api-db");
		expect(link?.retries).toBeGreaterThan(1000);
		expect((link?.calls ?? 0) > metrics.summary.offered * 1.3).toBe(true);
		expect(
			explainRun(metrics.summary).some((i) => i.id === "retries-api-db"),
		).toBe(true);
	});

	it("circuit breaker: opens during the slowdown, fails fast, and closes after recovery", () => {
		const { metrics } = runBuiltIn("circuit-breaker");
		const s = metrics.summary;
		const link = s.links.find((l) => l.id === "api-db");
		expect(link?.breakerOpens).toBeGreaterThan(0);
		expect(s.failedByReason["circuit-open"]).toBeGreaterThan(1000);
		const last = metrics.transitions.filter((t) => t.kind === "breaker").at(-1);
		expect(last).toMatchObject({ kind: "breaker", state: "closed" });
		// Fail fast: a failed request waits milliseconds, not most of a client timeout.
		expect(s.failedWaitMs / s.failed).toBeLessThan(100);
		const cascading = runBuiltIn("cascading-failure").metrics.summary;
		expect(cascading.failedWaitMs / cascading.failed).toBeGreaterThan(300);
	});

	it("cache stampede: the database saturates only while the cache is flushed", () => {
		const { metrics } = runBuiltIn("cache-stampede");
		const cache = node(metrics, "cache");
		const db = node(metrics, "db");
		expect(cache?.hitRatio).toBeGreaterThan(0.8);
		expect(db?.peakQueue).toBe(20);
		const dbIndex = metrics.summary.nodes.findIndex((n) => n.id === "db");
		const queue = metrics.series.queueDepth[dbIndex] as number[];
		expect(Math.max(...queue.slice(0, 19))).toBeLessThan(5);
		expect(Math.max(...queue.slice(20, 25))).toBe(20);
		expect(Math.max(...queue.slice(40))).toBeLessThan(5);
	});

	it("worker queue: clients are answered at once while the backlog grows and drains", () => {
		const { metrics } = runBuiltIn("worker-queue-backlog");
		const s = metrics.summary;
		const q = node(metrics, "queue");
		expect(s.failed).toBe(0);
		expect(s.successLatency?.p95Ms).toBeLessThan(20);
		expect(q?.jobs?.done).toBe(s.offered);
		expect(q?.jobs?.maxWaitMs).toBeGreaterThan(5000);
		expect(q?.peakQueue).toBeGreaterThan(500);
		const qIndex = s.nodes.findIndex((n) => n.id === "queue");
		const backlog = metrics.series.queueDepth[qIndex] as number[];
		expect(backlog[30]).toBeGreaterThan(200);
		expect(backlog[88]).toBeLessThan(5);
		expect(metrics.checks.every((c) => c.passed)).toBe(true);
	});
});

describe("series and log", () => {
	it("windows add up to the totals and track node state", () => {
		const { metrics } = runBuiltIn("lb-failure-with-health-checks");
		const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
		expect(sum(metrics.series.offered)).toBe(metrics.summary.offered);
		expect(sum(metrics.series.succeeded)).toBe(metrics.summary.succeeded);
		expect(sum(metrics.series.failed)).toBe(metrics.summary.failed);
		expect(metrics.series.startMs).toHaveLength(61);
		const b = metrics.summary.nodes.findIndex((n) => n.id === "server-b");
		expect(metrics.series.up[b]?.[30]).toBe(false);
		expect(metrics.series.healthy[b]?.[30]).toBe(false);
		expect(metrics.series.healthy[b]?.[50]).toBe(true);
		expect(sum(metrics.series.calls[b] as number[])).toBe(
			node(metrics, "server-b")?.calls,
		);
	});

	it("records a readable, searchable event log", () => {
		const { log, metrics } = runBuiltIn("lb-failure-with-health-checks");
		expect(log?.length).toBe(metrics.eventCount);
		if (!log) return;
		const i = firstEventAtOrAfter(log, 20_000);
		expect(readEventRow(log, i)).toMatchObject({
			kind: "node-down",
			tMs: 20_000,
			node: 3,
			fault: 0,
		});
		const rows = Array.from({ length: 12 }, (_, k) =>
			readEventRow(log, firstEventAtOrAfter(log, 20_010) + k),
		);
		expect(
			rows.some((r) => r.kind === "failed" && r.reason === "refused"),
		).toBe(true);
	});
});

describe("percentiles", () => {
	it("uses nearest rank and always returns an observed sample", () => {
		expect(nearestRank([1, 2, 3, 4], 50)).toBe(2);
		expect(nearestRank([1, 2, 3, 4], 95)).toBe(4);
		fc.assert(
			fc.property(
				fc.array(fc.integer(), { minLength: 1 }),
				fc.integer({ min: 1, max: 100 }),
				(values, p) => {
					const sorted = [...values].sort((a, b) => a - b);
					const v = nearestRank(sorted, p);
					expect(sorted).toContain(v);
					expect(
						sorted.filter((x) => x <= v).length / sorted.length,
					).toBeGreaterThanOrEqual(p / 100);
				},
			),
		);
	});
});

describe("explanations and comparison", () => {
	it("explains detection with its possible range", () => {
		const { metrics } = runBuiltIn("lb-failure-with-health-checks");
		const fault = explainRun(metrics.summary).find(
			(i) => i.id === "fault-server-b-crash",
		);
		expect(fault).toMatchObject({
			key: "insight.crashDetected",
			params: {
				delayMs: 5000,
				lost: 255,
				minMs: 5000,
				maxMs: 10_000,
				onTick: true,
			},
		});
	});

	it("compares the starter pair with the right direction and flags survivor latency", () => {
		const a = runBuiltIn("lb-failure-no-health-checks").metrics.summary;
		const b = runBuiltIn("lb-failure-with-health-checks").metrics.summary;
		expect(compareSummaries(a, b).find((r) => r.id === "failed")).toMatchObject(
			{ a: 1005, b: 255, delta: -750, better: "lower" },
		);
		const c = runBuiltIn("random-traffic-burst").metrics.summary;
		const d = runBuiltIn("random-traffic-burst", (e) => {
			for (const n of e.model.nodes)
				if (n.kind === "service") n.config.queueCapacity = 0;
		}).metrics.summary;
		expect(d.succeeded).toBeLessThan(c.succeeded);
		const p95 = compareSummaries(c, d).find((r) => r.id === "p95");
		expect(p95?.delta).toBeLessThan(0);
		expect(p95?.caution).toBe("fewerSuccesses");
	});
});

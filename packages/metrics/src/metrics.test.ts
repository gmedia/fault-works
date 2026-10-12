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
		labels: compiled.topology.servers.map((s) => s.label),
		windowMs: compiled.sampleWindowMs,
		recordLog: true,
	});
}

describe("golden scenarios", () => {
	it("no health checks: every request sent to dead Server B fails", () => {
		const { metrics } = runBuiltIn("lb-failure-no-health-checks");
		const s = metrics.summary;
		expect(s.offered).toBe(6000);
		// B gets 50 req/s and is down from 20 s to 40 s.
		expect(s.failedByReason["backend-refused"]).toBe(1000);
		expect(s.failedByReason["server-crashed"]).toBe(5);
		expect(s.failed).toBe(1005);
		expect(s.succeeded).toBe(4995);
		expect(s.inFlight).toBe(0);
		expect(s.successLatency).toMatchObject({ p50Ms: 100, p95Ms: 100, n: 4995 });
		expect(s.faults[0]).toMatchObject({
			detectedAtMs: null,
			restoredAtMs: 40_000,
			failedWhileUndetected: 1005,
		});
		expect(metrics.checks.every((c) => c.passed)).toBe(true);
	});

	it("health checks: failures stop after the second failed probe", () => {
		const { metrics } = runBuiltIn("lb-failure-with-health-checks");
		const s = metrics.summary;
		// Probes every 5 s; B fails at 20 s, second failed probe at 25 s.
		expect(s.faults[0]).toMatchObject({
			failedAtMs: 20_000,
			detectedAtMs: 25_000,
			detectionDelayMs: 5000,
			recoveredAtMs: 40_000,
			restoredAtMs: 45_000,
			failedWhileUndetected: 255,
		});
		expect(s.failedByReason["backend-refused"]).toBe(250);
		expect(s.failed).toBe(255);
		expect(s.succeeded).toBe(5745);
	});

	it("hanging backend: requests time out and detection waits for probe timeouts", () => {
		const { metrics } = runBuiltIn("hanging-backend");
		const s = metrics.summary;
		expect(s.faults[0]).toMatchObject({
			detectedAtMs: 27_000,
			detectionDelayMs: 7000,
		});
		// 5 requests in service at the crash plus 350 routed to B before detection.
		expect(s.failedByReason.timeout).toBe(355);
		expect(s.failed).toBe(355);
		expect(s.completedLatency?.maxMs).toBe(1000);
	});

	it("failover overload: Server A's queue fills and rejects", () => {
		const { metrics } = runBuiltIn("failover-overload");
		const a = metrics.summary.servers[0];
		expect(a?.peakQueue).toBe(50);
		expect(a?.failedByReason["queue-full"]).toBeGreaterThan(0);
		expect(metrics.summary.successLatency?.p95Ms).toBeGreaterThan(500);
	});

	it("random burst: deterministic per seed, different across seeds", () => {
		const first = runBuiltIn("random-traffic-burst");
		const again = runBuiltIn("random-traffic-burst");
		const other = runBuiltIn("random-traffic-burst", (e) => {
			e.seed = 8;
		});
		expect(again.metrics.traceDigest).toBe(first.metrics.traceDigest);
		expect(again.metrics.summary).toEqual(first.metrics.summary);
		expect(other.metrics.traceDigest).not.toBe(first.metrics.traceDigest);
		expect(first.metrics.checks.every((c) => c.passed)).toBe(true);
	});

	it("chart window changes the series but never the results", () => {
		const coarse = runBuiltIn("random-traffic-burst", (e) => {
			e.run.sampleWindowMs = 5000;
		});
		const fine = runBuiltIn("random-traffic-burst", (e) => {
			e.run.sampleWindowMs = 250;
		});
		expect(coarse.metrics.traceDigest).toBe(fine.metrics.traceDigest);
		expect(coarse.metrics.summary).toEqual(fine.metrics.summary);
		expect(coarse.metrics.series.offered.reduce((x, y) => x + y)).toBe(
			fine.metrics.series.offered.reduce((x, y) => x + y),
		);
	});
});

describe("series and log", () => {
	it("windows add up to the totals", () => {
		const { metrics } = runBuiltIn("lb-failure-with-health-checks");
		const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
		expect(sum(metrics.series.offered)).toBe(metrics.summary.offered);
		expect(sum(metrics.series.succeeded)).toBe(metrics.summary.succeeded);
		expect(sum(metrics.series.failed)).toBe(metrics.summary.failed);
		expect(metrics.series.startMs).toHaveLength(61);
		// B is down and marked unhealthy during [25 s, 40 s).
		expect(metrics.series.up[1]?.[30]).toBe(false);
		expect(metrics.series.healthy[1]?.[30]).toBe(false);
		expect(metrics.series.healthy[1]?.[50]).toBe(true);
	});

	it("records a readable, searchable event log", () => {
		const { log, metrics } = runBuiltIn("lb-failure-with-health-checks");
		expect(log?.length).toBe(metrics.eventCount);
		if (!log) return;
		const i = firstEventAtOrAfter(log, 20_000);
		const row = readEventRow(log, i);
		expect(row).toMatchObject({
			kind: "node-down",
			tMs: 20_000,
			server: 1,
			fault: 0,
		});
		const failed = readEventRow(log, firstEventAtOrAfter(log, 20_010) + 2);
		expect(failed).toMatchObject({ kind: "failed", reason: "backend-refused" });
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
					const below = sorted.filter((x) => x <= v).length;
					expect(below / sorted.length).toBeGreaterThanOrEqual(p / 100);
				},
			),
		);
	});
});

describe("explanations and comparison", () => {
	it("explains detection delay and failures from recorded events", () => {
		const { metrics } = runBuiltIn("lb-failure-with-health-checks");
		const insights = explainRun(metrics.summary, true);
		const fault = insights.find((i) => i.id === "fault-server-b-crash");
		expect(fault?.body).toContain(
			"marked it unhealthy at 25.0 s, 5.0 s after the crash",
		);
		expect(fault?.body).toContain("255 requests failed");
	});

	it("compares the starter pair with the right direction", () => {
		const a = runBuiltIn("lb-failure-no-health-checks").metrics.summary;
		const b = runBuiltIn("lb-failure-with-health-checks").metrics.summary;
		const failed = compareSummaries(a, b).find((r) => r.id === "failed");
		expect(failed).toMatchObject({
			a: 1005,
			b: 255,
			delta: -750,
			better: "lower",
		});
	});
});

describe("pilot findings", () => {
	it("reports the possible detection range and whether the crash hit a probe tick", () => {
		const onTick = runBuiltIn("lb-failure-with-health-checks").metrics.summary
			.faults[0];
		expect(onTick).toMatchObject({
			possibleDetectionMs: { min: 5000, max: 10_000 },
			crashOnProbeTick: true,
		});
		const offTick = runBuiltIn("lb-failure-with-health-checks", (e) => {
			const f = e.faults[0];
			if (f) f.atMs = 22_500;
		}).metrics.summary;
		expect(offTick.faults[0]).toMatchObject({
			detectionDelayMs: 7500,
			crashOnProbeTick: false,
		});
		const hang = runBuiltIn("hanging-backend").metrics.summary.faults[0];
		expect(hang?.possibleDetectionMs).toEqual({ min: 7000, max: 12_000 });
		expect(
			explainRun(
				runBuiltIn("lb-failure-with-health-checks").metrics.summary,
				true,
			).find((i) => i.id === "fault-server-b-crash")?.body,
		).toContain("shortest delay these settings allow");
	});

	it("measures the time clients spent on failures, which percentiles hide", () => {
		const noChecks = runBuiltIn("hanging-backend", (e) => {
			for (const n of e.model.nodes)
				if (n.kind === "load-balancer") n.config.healthCheck.enabled = false;
		}).metrics.summary;
		const withChecks = runBuiltIn("hanging-backend").metrics.summary;
		expect(withChecks.failedWaitMs).toBe(355 * 1000);
		const rows = compareSummaries(noChecks, withChecks);
		expect(rows.find((r) => r.id === "ended-p95")?.delta).toBe(0);
		expect(rows.find((r) => r.id === "failed-wait")).toMatchObject({
			a: 1005,
			b: 355,
		});
		expect(rows.find((r) => r.id === "timed-out")).toMatchObject({
			a: 1005,
			b: 355,
		});
	});

	it("flags survivor latency instead of calling it an improvement", () => {
		const a = runBuiltIn("random-traffic-burst").metrics.summary;
		const b = runBuiltIn("random-traffic-burst", (e) => {
			for (const n of e.model.nodes)
				if (n.kind === "server") n.config.queueCapacity = 0;
		}).metrics.summary;
		expect(b.succeeded).toBeLessThan(a.succeeded);
		const p95 = compareSummaries(a, b).find((r) => r.id === "p95");
		expect(p95?.delta).toBeLessThan(0);
		expect(p95?.caution).toMatch(/fewer successful requests/);
	});
});

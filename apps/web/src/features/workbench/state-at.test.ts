import { findBuiltIn } from "@faultworks/experiment";
import { describe, expect, it } from "vitest";
import { executeRun } from "#/workers/protocol.ts";
import { snapshotAt, stateChangeTimes } from "./state-at.ts";

function run(id: string) {
	const experiment = findBuiltIn(id);
	if (!experiment) throw new Error(`missing example ${id}`);
	const result = executeRun(experiment, false);
	const node = (nodeId: string) => result.topology.nodeIds.indexOf(nodeId);
	return { result, node };
}

describe("snapshotAt", () => {
	it("follows a crash through detection, recovery and re-admission", () => {
		// Server B refuses from 20 s to 40 s; probes every 5 s, two failures to remove, two successes to re-add.
		const { result, node } = run("lb-failure-with-health-checks");
		const b = node("server-b");
		expect(snapshotAt(result, 10_000).nodes[b]?.status).toBe("up");
		expect(snapshotAt(result, 20_000).nodes[b]?.status).toBe("down-routed");
		expect(snapshotAt(result, 26_000).nodes[b]?.status).toBe("down-removed");
		expect(snapshotAt(result, 41_000).nodes[b]?.status).toBe("recovering");
		expect(snapshotAt(result, 55_000).nodes[b]?.status).toBe("up");
	});

	it("keeps a crashed node routed when nothing watches it", () => {
		const { result, node } = run("lb-failure-no-health-checks");
		const b = node("server-b");
		expect(snapshotAt(result, 30_000).nodes[b]?.status).toBe("down-routed");
		expect(snapshotAt(result, 45_000).nodes[b]?.status).toBe("up");
		// Refused calls never arrive, so they are not counted as calls, but their failures originate here.
		const during = snapshotAt(result, 30_000);
		expect(during.nodes[b]?.callsRps).toBe(0);
		expect(during.nodes[b]?.failedRps).toBeGreaterThan(0);
		expect(during.failedRps).toBeGreaterThan(0);
	});

	it("marks a slowed-down node as degraded and lists the active fault", () => {
		const { result, node } = run("cascading-failure");
		const slow = result.experiment.faults.find((f) => f.kind === "slowdown");
		if (!slow || !("untilMs" in slow) || slow.untilMs === undefined)
			throw new Error("example changed");
		const target = node(slow.target);
		const before = snapshotAt(result, slow.atMs - 1);
		const during = snapshotAt(result, slow.atMs + 1000);
		expect(before.nodes[target]?.status).toBe("up");
		expect(during.nodes[target]?.status).toBe("degraded");
		expect(during.nodes[target]?.activeFaults).toEqual([
			result.experiment.faults.indexOf(slow),
		]);
	});

	it("reports breaker state per link", () => {
		const { result } = run("circuit-breaker");
		const opens = result.metrics.transitions.filter(
			(t) => t.kind === "breaker" && t.state === "open",
		);
		expect(opens.length).toBeGreaterThan(0);
		const first = opens[0] as { tMs: number; edge: number };
		expect(snapshotAt(result, first.tMs - 1).links[first.edge]?.breaker).toBe(
			"closed",
		);
		expect(snapshotAt(result, first.tMs).links[first.edge]?.breaker).toBe(
			"open",
		);
	});

	it("clamps the window to the run and reports per-second rates", () => {
		const { result } = run("lb-failure-with-health-checks");
		const last = snapshotAt(result, 10 * 60 * 60 * 1000);
		expect(last.window).toBe(result.metrics.series.startMs.length - 1);
		const steady = snapshotAt(result, 10_000);
		// 100 req/s offered during steady traffic.
		expect(steady.offeredRps).toBeCloseTo(100, 0);
		expect(steady.succeededRps).toBeCloseTo(100, 0);
	});
});

describe("stateChangeTimes", () => {
	it("lists every transition time once, in order", () => {
		const { result } = run("lb-failure-with-health-checks");
		const times = stateChangeTimes(result);
		expect(times).toContain(20_000);
		expect(times).toContain(40_000);
		expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
	});
});

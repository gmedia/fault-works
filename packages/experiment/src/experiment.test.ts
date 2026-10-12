import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalJson, inputDigest, runKey } from "./canonical.ts";
import {
	compileExperiment,
	compilePhases,
	effectiveHorizonMs,
} from "./compile.ts";
import { semanticDiff } from "./diff.ts";
import {
	addFault,
	addServer,
	cloneExperiment,
	removeServer,
	uniqueId,
} from "./edit.ts";
import {
	BUILT_IN_EXPERIMENTS,
	findBuiltIn,
	STARTER_COMPARISON,
} from "./examples.ts";
import proposal from "./fixtures/proposal-0.1.0.json";
import type { Experiment } from "./schema.ts";
import { sha256Hex } from "./sha256.ts";
import {
	checkExperiment,
	parseExperiment,
	parseExperimentJson,
} from "./validate.ts";

const base = (): Experiment =>
	structuredClone(findBuiltIn(STARTER_COMPARISON.a) as Experiment);

function issuesOf(value: unknown) {
	const result = parseExperiment(value);
	return result.ok ? [] : result.issues;
}

describe("built-in experiments", () => {
	it("all validate and have unique ids", () => {
		expect(BUILT_IN_EXPERIMENTS.length).toBeGreaterThanOrEqual(5);
		const ids = BUILT_IN_EXPERIMENTS.map((e) => e.experimentId);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("the starter pair differs in exactly one behavioral variable", () => {
		const a = findBuiltIn(STARTER_COMPARISON.a) as Experiment;
		const b = findBuiltIn(STARTER_COMPARISON.b) as Experiment;
		expect(semanticDiff(a, b)).toEqual([
			expect.objectContaining({
				key: "lb.healthCheck.enabled",
				before: "off",
				after: "on",
			}),
		]);
	});
});

describe("parseExperiment", () => {
	it("migrates the 0.1.0-proposal example", () => {
		const result = parseExperiment(proposal);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.migratedFrom).toBe("0.1.0-proposal");
		const lb = result.experiment.model.nodes.find(
			(n) => n.kind === "load-balancer",
		);
		expect(
			lb?.kind === "load-balancer" && lb.config.healthCheck.unhealthyThreshold,
		).toBe(1);
		expect(result.experiment.faults[0]?.behavior).toBe("refuse");
	});

	it("rejects unknown schema versions with an explanation", () => {
		const issues = issuesOf({ ...base(), schemaVersion: "2.0.0" });
		expect(issues[0]?.message).toMatch(/schema version 2\.0\.0/);
	});

	it("rejects negative service time with a path to the field", () => {
		const e = base();
		const server = e.model.nodes[2];
		if (server?.kind === "server") server.config.serviceTimeMs = -5;
		const issues = issuesOf(e);
		expect(issues).toContainEqual({
			path: "model.nodes[2].config.serviceTimeMs",
			message: "Service time must be greater than 0 ms",
		});
	});

	it("rejects unknown fields instead of ignoring them", () => {
		const issues = issuesOf({ ...base(), script: "alert(1)" });
		expect(issues.length).toBeGreaterThan(0);
	});

	it("rejects unsupported links with an actionable message", () => {
		const e = base();
		e.model.links.push({ source: "server-a", target: "client" });
		expect(
			issuesOf(e)
				.map((i) => i.message)
				.join(" "),
		).toMatch(/client → load balancer → servers/);
	});

	it("rejects a server that is not connected", () => {
		const e = base();
		e.model.links = e.model.links.filter((l) => l.target !== "server-b");
		expect(
			issuesOf(e)
				.map((i) => i.message)
				.join(" "),
		).toMatch(/Server B" is not connected/);
	});

	it("rejects faults on non-servers, recovery before failure and overlapping faults", () => {
		const e = base();
		e.faults = [
			{
				id: "a",
				kind: "node-failure",
				target: "lb",
				atMs: 10,
				recoverAtMs: 20,
				behavior: "refuse",
			},
			{
				id: "b",
				kind: "node-failure",
				target: "server-a",
				atMs: 50,
				recoverAtMs: 40,
				behavior: "refuse",
			},
			{
				id: "c",
				kind: "node-failure",
				target: "server-b",
				atMs: 0,
				recoverAtMs: 100,
				behavior: "refuse",
			},
			{
				id: "d",
				kind: "node-failure",
				target: "server-b",
				atMs: 50,
				recoverAtMs: null,
				behavior: "hang",
			},
		];
		const paths = issuesOf(e).map((i) => i.path);
		expect(paths).toEqual(
			expect.arrayContaining([
				"faults[0].target",
				"faults[1].recoverAtMs",
				"faults[3].atMs",
			]),
		);
	});

	it("rejects runs that exceed the request budget", () => {
		const e = base();
		e.workload.offeredRps = 5000;
		e.workload.durationMs = 600_000;
		expect(issuesOf(e).map((i) => i.path)).toContain("workload.offeredRps");
	});

	it("explains broken JSON and oversized files", () => {
		const broken = parseExperimentJson("{ nope");
		expect(broken.ok).toBe(false);
		if (!broken.ok) expect(broken.issues[0]?.message).toMatch(/not valid JSON/);
		const huge = parseExperimentJson(`"${"x".repeat(600 * 1024)}"`);
		if (!huge.ok) expect(huge.issues[0]?.message).toMatch(/limited to 512 KB/);
	});
});

describe("compile", () => {
	it("merges bursts into non-overlapping phases", () => {
		const phases = compilePhases({
			arrival: "constant",
			offeredRps: 100,
			startMs: 0,
			durationMs: 10_000,
			timeoutMs: 1000,
			bursts: [{ atMs: 2000, durationMs: 1000, extraRps: 50 }],
		});
		expect(phases).toEqual([
			{ startUs: 0, endUs: 2_000_000, rps: 100 },
			{ startUs: 2_000_000, endUs: 3_000_000, rps: 150 },
			{ startUs: 3_000_000, endUs: 10_000_000, rps: 100 },
		]);
	});

	it("defaults the horizon to traffic end plus one timeout", () => {
		expect(effectiveHorizonMs(base())).toBe(61_000);
	});

	it("converts milliseconds to integer microseconds and keeps server order", () => {
		const compiled = compileExperiment(base());
		expect(compiled.engine.servers.map((s) => s.id)).toEqual([
			"server-a",
			"server-b",
		]);
		expect(compiled.engine.servers[0]?.serviceTimeUs).toBe(100_000);
		expect(compiled.engine.faults[0]).toMatchObject({
			server: 1,
			atUs: 20_000_000,
		});
		expect(compiled.engine.healthCheck).toBeNull();
	});
});

describe("canonical form and digests", () => {
	it("sorts keys and ignores key order", () => {
		expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
			'{"a":[2,{"c":2,"d":1}],"b":1}',
		);
		fc.assert(
			fc.property(fc.dictionary(fc.string(), fc.integer()), (obj) => {
				const reversed = Object.fromEntries(Object.entries(obj).reverse());
				expect(canonicalJson(reversed)).toBe(canonicalJson(obj));
			}),
		);
	});

	it("matches the standard SHA-256", () => {
		fc.assert(
			fc.property(fc.string({ unit: "binary", maxLength: 300 }), (text) => {
				expect(sha256Hex(text)).toBe(
					createHash("sha256").update(text, "utf8").digest("hex"),
				);
			}),
		);
	});

	it("ignores layout in the input digest and labels in the run key", () => {
		const a = base();
		const b = structuredClone(a);
		b.layout = { client: { x: 999, y: 1 } };
		expect(inputDigest(b)).toBe(inputDigest(a));
		b.title = "Renamed";
		const node = b.model.nodes[2];
		if (node) node.label = "Primary";
		expect(inputDigest(b)).not.toBe(inputDigest(a));
		expect(runKey(b)).toBe(runKey(a));
		b.seed = 43;
		expect(runKey(b)).not.toBe(runKey(a));
	});
});

describe("editing helpers", () => {
	it("adds a wired server that copies the last server", () => {
		const { experiment, id } = addServer(base());
		expect(id).toBe("server-c");
		expect(checkExperiment(experiment)).toEqual([]);
		expect(experiment.model.links).toContainEqual({
			source: "lb",
			target: "server-c",
		});
	});

	it("removes a server with its links and faults", () => {
		const { experiment, removedFaults } = removeServer(base(), "server-b");
		expect(removedFaults).toBe(1);
		expect(checkExperiment(experiment)).toEqual([]);
	});

	it("adds a valid fault and clones under a fresh id", () => {
		const { experiment } = addFault(base());
		expect(checkExperiment(experiment).length).toBeGreaterThan(0); // overlaps the existing crash
		const clone = cloneExperiment(base(), [
			"lb-failure-no-health-checks-variant",
		]);
		expect(clone.experimentId).toBe("lb-failure-no-health-checks-variant-2");
		expect(semanticDiff(base(), clone)).toEqual([]);
	});

	it("normalizes ids", () => {
		expect(uniqueId("My Experiment!", [])).toBe("my-experiment");
		expect(uniqueId("a", ["a", "a-2"])).toBe("a-3");
	});
});

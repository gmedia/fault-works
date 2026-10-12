import { type Experiment, findBuiltIn } from "@faultworks/experiment";
import { describe, expect, it } from "vitest";
import { faultBands } from "#/features/charts/bands.ts";
import { canonicalResult, resultArtifact } from "#/features/library/export.ts";
import { executeRun } from "#/workers/protocol.ts";
import { snapshotAt } from "./state-at.ts";

const builtIn = (id: string) => findBuiltIn(id) as Experiment;
const withChecks = executeRun(builtIn("lb-failure-with-health-checks"), true);
const without = executeRun(builtIn("lb-failure-no-health-checks"), true);

describe("snapshotAt", () => {
	it("tracks a server from up, through undetected and removed, back to rotation", () => {
		const status = (t: number) => snapshotAt(withChecks, t).servers[1]?.status;
		expect(status(10_000)).toBe("up");
		expect(status(22_000)).toBe("down-routed");
		expect(status(30_000)).toBe("down-removed");
		expect(status(42_000)).toBe("recovering");
		expect(status(50_000)).toBe("up");
	});

	it("keeps routing to a dead server when health checks are off", () => {
		const snap = snapshotAt(without, 30_000);
		expect(snap.servers[1]?.status).toBe("down-routed");
		expect(snap.inRotation).toBe(2);
		expect(snap.servers[1]?.routedRps).toBe(50);
	});
});

describe("faultBands", () => {
	it("draws the detection gap only until detection", () => {
		const { bands } = faultBands(withChecks);
		expect(bands.map((b) => [b.kind, b.fromMs, b.toMs])).toEqual([
			["gap", 20_000, 25_000],
			["down", 25_000, 40_000],
			["off", 40_000, 45_000],
		]);
		expect(faultBands(without).bands.map((b) => b.kind)).toEqual(["gap"]);
	});
});

describe("result artifact", () => {
	it("is reproducible byte for byte and carries digests and limitations", () => {
		const again = executeRun(builtIn("lb-failure-with-health-checks"), false);
		expect(canonicalResult(again)).toBe(canonicalResult(withChecks));
		const artifact = resultArtifact(withChecks);
		expect(artifact.inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(artifact.limitations.length).toBeGreaterThan(3);
		// Wall-clock values never enter the artifact.
		expect(artifact).not.toHaveProperty("durationMs");
		expect(JSON.stringify(artifact)).not.toMatch(/finishedAt/);
	});
});

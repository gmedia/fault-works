// @vitest-environment jsdom
import {
	addFault,
	addNode,
	EXAMPLE_IDS,
	type Experiment,
	findBuiltIn,
} from "@faultworks/experiment";
import { beforeEach, describe, expect, it } from "vitest";
import { useLibrary } from "./library.ts";

function fresh(): Experiment {
	const e = findBuiltIn("lb-failure-with-health-checks");
	if (!e) throw new Error("missing example");
	return structuredClone(e);
}

beforeEach(() => {
	window.localStorage.clear();
	const now = Date.now();
	const entries = Object.fromEntries(
		EXAMPLE_IDS.map((id) => [
			id,
			{
				experiment: structuredClone(findBuiltIn(id) as Experiment),
				origin: "built-in" as const,
				basedOn: null,
				createdAt: now,
				updatedAt: now,
			},
		]),
	);
	useLibrary.setState({
		entries,
		order: [...EXAMPLE_IDS],
		seeded: [...EXAMPLE_IDS],
		history: {},
	});
});

describe("library store", () => {
	it("seeds every built-in example", () => {
		const { entries, order } = useLibrary.getState();
		expect(order).toEqual([...EXAMPLE_IDS]);
		for (const id of EXAMPLE_IDS) expect(entries[id]?.origin).toBe("built-in");
	});

	it("adds under a fresh id when the id is taken", () => {
		const id = useLibrary.getState().add(fresh(), "imported");
		expect(id).not.toBe("lb-failure-with-health-checks");
		expect(useLibrary.getState().entries[id]?.experiment.experimentId).toBe(id);
		expect(useLibrary.getState().order[0]).toBe(id);
	});

	it("records history for undo and redo", () => {
		const id = "lb-failure-with-health-checks";
		const s = useLibrary.getState();
		s.update(id, (e) => addNode(e, "cache", { from: "server-a" }).experiment);
		expect(
			useLibrary.getState().entries[id]?.experiment.model.nodes,
		).toHaveLength(5);
		expect(useLibrary.getState().undo(id)).toBe(true);
		expect(
			useLibrary.getState().entries[id]?.experiment.model.nodes,
		).toHaveLength(4);
		expect(useLibrary.getState().redo(id)).toBe(true);
		expect(
			useLibrary.getState().entries[id]?.experiment.model.nodes,
		).toHaveLength(5);
		expect(useLibrary.getState().redo(id)).toBe(false);
	});

	it("coalesces rapid edits with the same key into one undo step", () => {
		const id = "lb-failure-with-health-checks";
		const s = useLibrary.getState();
		s.update(id, (e) => ({ ...e, title: "a" }), "title");
		s.update(id, (e) => ({ ...e, title: "ab" }), "title");
		s.update(id, (e) => ({ ...e, title: "abc" }), "title");
		expect(useLibrary.getState().undo(id)).toBe(true);
		expect(useLibrary.getState().entries[id]?.experiment.title).toBe(
			fresh().title,
		);
	});

	it("removes and restores an entry at its position", () => {
		const id = EXAMPLE_IDS[2] as string;
		const removed = useLibrary.getState().remove(id);
		expect(removed?.index).toBe(2);
		expect(useLibrary.getState().entries[id]).toBeUndefined();
		if (!removed) throw new Error("nothing removed");
		useLibrary.getState().restoreEntry(removed.entry, removed.index);
		expect(useLibrary.getState().order[2]).toBe(id);
	});

	it("creates a variant linked to its original", () => {
		const id = useLibrary
			.getState()
			.createVariant(
				"lb-failure-with-health-checks",
				"variant",
				"Variant of “{{title}}”.",
			);
		expect(id).toBeTruthy();
		const entry = useLibrary.getState().entries[id as string];
		expect(entry?.origin).toBe("variant");
		expect(entry?.basedOn).toBe("lb-failure-with-health-checks");
		expect(entry?.experiment.faults).toEqual(fresh().faults);
	});

	it("renames an experiment and keeps variants pointing at it", () => {
		const variant = useLibrary
			.getState()
			.createVariant("lb-failure-with-health-checks", "variant", "") as string;
		expect(
			useLibrary
				.getState()
				.renameExperiment("lb-failure-with-health-checks", "Bad Id"),
		).toBeNull();
		expect(
			useLibrary
				.getState()
				.renameExperiment("lb-failure-with-health-checks", "cascading-failure"),
		).toBeNull();
		expect(
			useLibrary
				.getState()
				.renameExperiment("lb-failure-with-health-checks", "lab-1"),
		).toBe("lab-1");
		const state = useLibrary.getState();
		expect(state.entries["lab-1"]?.experiment.experimentId).toBe("lab-1");
		expect(state.entries["lb-failure-with-health-checks"]).toBeUndefined();
		expect(state.entries[variant]?.basedOn).toBe("lab-1");
		expect(state.order).toContain("lab-1");
	});

	it("resets a built-in to its shipped version", () => {
		const id = "lb-failure-with-health-checks";
		useLibrary
			.getState()
			.update(id, (e) => addFault(e, "slowdown", "server-a")?.experiment ?? e);
		expect(useLibrary.getState().entries[id]?.experiment.faults).toHaveLength(
			2,
		);
		useLibrary.getState().resetToBuiltIn(id, "en");
		expect(useLibrary.getState().entries[id]?.experiment.faults).toHaveLength(
			1,
		);
	});

	it("restores only the missing built-ins", () => {
		useLibrary.getState().remove("retry-storm");
		useLibrary.getState().remove("cache-stampede");
		expect(useLibrary.getState().restoreBuiltIns("id")).toBe(2);
		expect(useLibrary.getState().restoreBuiltIns("id")).toBe(0);
		expect(useLibrary.getState().order).toHaveLength(EXAMPLE_IDS.length);
	});
});

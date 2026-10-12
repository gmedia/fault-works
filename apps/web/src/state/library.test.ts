import { STARTER_COMPARISON } from "@faultworks/experiment";
import { beforeEach, describe, expect, it } from "vitest";
import { useLibrary } from "./library.ts";

const initial = useLibrary.getState();
beforeEach(() => useLibrary.setState(initial, true));

describe("library store", () => {
	it("starts with the built-in examples", () => {
		expect(useLibrary.getState().order).toContain(STARTER_COMPARISON.a);
	});

	it("coalesces rapid edits to the same field into one undo step", () => {
		const { update, undo } = useLibrary.getState();
		const id = STARTER_COMPARISON.a;
		update(id, (e) => ({ ...e, seed: 1 }), "seed");
		update(id, (e) => ({ ...e, seed: 2 }), "seed");
		update(id, (e) => ({ ...e, title: "Renamed" }), "title");
		expect(useLibrary.getState().entries[id]?.experiment.seed).toBe(2);
		undo(id);
		expect(useLibrary.getState().entries[id]?.experiment.title).not.toBe(
			"Renamed",
		);
		undo(id);
		expect(useLibrary.getState().entries[id]?.experiment.seed).toBe(42);
		expect(useLibrary.getState().redo(id)).toBe(true);
		expect(useLibrary.getState().entries[id]?.experiment.seed).toBe(2);
	});

	it("creates variants that remember their original and never collide", () => {
		const { createVariant } = useLibrary.getState();
		const a = createVariant(STARTER_COMPARISON.a);
		const b = createVariant(STARTER_COMPARISON.a);
		expect(a).not.toBe(b);
		expect(useLibrary.getState().entries[a ?? ""]?.basedOn).toBe(
			STARTER_COMPARISON.a,
		);
	});

	it("restores a deleted experiment at its old position", () => {
		const { remove, restoreEntry } = useLibrary.getState();
		const before = useLibrary.getState().order;
		const removed = remove(before[1] ?? "");
		expect(removed).not.toBeNull();
		if (removed) restoreEntry(removed.entry, removed.index);
		expect(useLibrary.getState().order).toEqual(before);
	});
});

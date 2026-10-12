import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRng, fnv1a32 } from "./prng.ts";
import { EventQueue, type Scheduled } from "./queue.ts";

describe("createRng", () => {
	it("repeats the same sequence for the same seed and stream", () => {
		const a = createRng(42, "arrivals");
		const b = createRng(42, "arrivals");
		for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
	});

	it("matches the golden sequence (algorithm is part of the reproducibility contract)", () => {
		const rng = createRng(42, "arrivals");
		const first = Array.from({ length: 3 }, () => rng.next().toFixed(12));
		expect(first).toMatchSnapshot();
	});

	it("gives independent streams different sequences", () => {
		const a = createRng(42, "service:a");
		const b = createRng(42, "service:b");
		const same = Array.from({ length: 50 }, () => a.next() === b.next()).filter(
			Boolean,
		);
		expect(same.length).toBe(0);
	});

	it("stays in [0, 1) and draws positive exponentials", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 2 ** 32 - 1 }),
				fc.string(),
				(seed, stream) => {
					const rng = createRng(seed, stream);
					for (let i = 0; i < 20; i++) {
						const u = rng.next();
						expect(u).toBeGreaterThanOrEqual(0);
						expect(u).toBeLessThan(1);
						expect(rng.exponential(10)).toBeGreaterThanOrEqual(0);
					}
				},
			),
		);
	});

	it("hashes stream names with FNV-1a", () => {
		expect(fnv1a32("")).toBe(0x811c9dc5);
		expect(fnv1a32("a")).toBe(0xe40c292c);
	});
});

describe("EventQueue", () => {
	it("pops in (time, priority, sequence) order", () => {
		fc.assert(
			fc.property(
				fc.array(fc.record({ t: fc.nat(50), priority: fc.nat(5) }), {
					maxLength: 200,
				}),
				(entries) => {
					const queue = new EventQueue<Scheduled>();
					entries.forEach((e, seq) => {
						queue.push({ ...e, seq });
					});
					const popped: Scheduled[] = [];
					for (let item = queue.pop(); item; item = queue.pop())
						popped.push(item);
					const expected = entries
						.map((e, seq) => ({ ...e, seq }))
						.sort(
							(a, b) => a.t - b.t || a.priority - b.priority || a.seq - b.seq,
						);
					expect(popped).toEqual(expected);
				},
			),
		);
	});
});

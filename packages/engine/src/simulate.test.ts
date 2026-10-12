import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createArrivalSource, simulate } from "./simulate.ts";
import type { EngineInput, FaultInput, SimEvent } from "./types.ts";

const MS = 1000;

function input(overrides: Partial<EngineInput> = {}): EngineInput {
	return {
		seed: 42,
		horizonUs: 2000 * MS,
		maxEvents: 1_000_000,
		healthCheck: null,
		servers: [
			{
				id: "server-a",
				capacity: 1,
				queueCapacity: 0,
				serviceTimeUs: 50 * MS,
				distribution: "fixed",
			},
			{
				id: "server-b",
				capacity: 1,
				queueCapacity: 0,
				serviceTimeUs: 50 * MS,
				distribution: "fixed",
			},
		],
		arrival: "constant",
		phases: [{ startUs: 0, endUs: 1000 * MS, rps: 10 }],
		timeoutUs: 1000 * MS,
		faults: [],
		...overrides,
	};
}

function run(engineInput: EngineInput) {
	const events: SimEvent[] = [];
	const result = simulate(engineInput, (e) => events.push(e));
	return { events, result };
}

function outcomes(events: SimEvent[]) {
	return events.filter(
		(e): e is Extract<SimEvent, { kind: "succeeded" | "failed" }> =>
			e.kind === "succeeded" || e.kind === "failed",
	);
}

function fault(overrides: Partial<FaultInput> = {}): FaultInput {
	return {
		id: "b-down",
		server: 1,
		atUs: 500 * MS,
		recoverAtUs: null,
		behavior: "refuse",
		...overrides,
	};
}

describe("reference cases", () => {
	it("alternates round robin between two healthy backends", () => {
		const { events } = run(input());
		const routed = events.filter((e) => e.kind === "routed");
		expect(routed.map((e) => e.server)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
		const done = outcomes(events);
		expect(done).toHaveLength(10);
		expect(
			done.every((e) => e.kind === "succeeded" && e.latencyUs === 50 * MS),
		).toBe(true);
	});

	it("fails requests routed to a dead backend when nothing detects the failure", () => {
		const { events } = run(input({ faults: [fault()] }));
		const failed = events.filter((e) => e.kind === "failed");
		// Arrivals every 100 ms; odd requests go to B; B is down from 500 ms.
		expect(failed.map((e) => e.req)).toEqual([5, 7, 9]);
		expect(
			failed.every(
				(e) => e.kind === "failed" && e.reason === "backend-refused",
			),
		).toBe(true);
		expect(events.filter((e) => e.kind === "succeeded")).toHaveLength(7);
	});

	it("stops routing to a backend only after the health check detects the failure", () => {
		const { events } = run(
			input({
				faults: [fault()],
				healthCheck: {
					intervalUs: 300 * MS,
					probeTimeoutUs: 100 * MS,
					unhealthyThreshold: 1,
					healthyThreshold: 1,
				},
			}),
		);
		const change = events.find((e) => e.kind === "health-changed");
		expect(change).toMatchObject({
			t: 600 * MS,
			server: 1,
			healthy: false,
			fault: 0,
		});
		// Request 5 (500 ms) still goes to B before the 600 ms probe; everything after goes to A.
		expect(events.filter((e) => e.kind === "failed").map((e) => e.req)).toEqual(
			[5],
		);
		const lateRouting = events.filter(
			(e) => e.kind === "routed" && e.t >= 600 * MS,
		);
		expect(
			lateRouting.every((e) => e.kind === "routed" && e.server === 0),
		).toBe(true);
	});

	it("brings a backend back after the healthy threshold is met", () => {
		const { events } = run(
			input({
				horizonUs: 3000 * MS,
				phases: [{ startUs: 0, endUs: 3000 * MS, rps: 10 }],
				faults: [fault({ atUs: 500 * MS, recoverAtUs: 1000 * MS })],
				healthCheck: {
					intervalUs: 300 * MS,
					probeTimeoutUs: 100 * MS,
					unhealthyThreshold: 1,
					healthyThreshold: 2,
				},
			}),
		);
		const changes = events.filter((e) => e.kind === "health-changed");
		// Probes at 1200 and 1500 ms succeed after recovery at 1000 ms.
		expect(
			changes.map((e) => [e.t / MS, e.kind === "health-changed" && e.healthy]),
		).toEqual([
			[600, false],
			[1500, true],
		]);
	});

	it("rejects requests when every slot and queue position is taken", () => {
		const { events } = run(
			input({
				servers: [
					{
						id: "only",
						capacity: 1,
						queueCapacity: 1,
						serviceTimeUs: 250 * MS,
						distribution: "fixed",
					},
				],
				timeoutUs: 5000 * MS,
				horizonUs: 5000 * MS,
			}),
		);
		const rejected = events.filter(
			(e): e is Extract<SimEvent, { kind: "failed" }> =>
				e.kind === "failed" && e.reason === "queue-full",
		);
		expect(rejected.length).toBeGreaterThan(0);
		expect(rejected[0]?.req).toBe(2);
		const queued = events.find(
			(e) => e.kind === "service-start" && e.req === 1,
		);
		expect(queued).toMatchObject({ t: 250 * MS, queuedUs: 150 * MS });
	});

	it("times out slow responses and never counts the late response as success", () => {
		const { events } = run(
			input({
				phases: [{ startUs: 0, endUs: 1 * MS, rps: 1000 }],
				servers: [
					{
						id: "slow",
						capacity: 1,
						queueCapacity: 0,
						serviceTimeUs: 300 * MS,
						distribution: "fixed",
					},
				],
				timeoutUs: 200 * MS,
			}),
		);
		expect(events.map((e) => e.kind)).toEqual([
			"arrival",
			"routed",
			"service-start",
			"failed",
			"service-end",
			"late-response",
		]);
		expect(events[3]).toMatchObject({
			reason: "timeout",
			latencyUs: 200 * MS,
			server: 0,
		});
	});

	it("counts a response landing exactly on the deadline as success", () => {
		const { events } = run(
			input({
				phases: [{ startUs: 0, endUs: 1 * MS, rps: 1000 }],
				timeoutUs: 50 * MS,
			}),
		);
		expect(outcomes(events)).toMatchObject([
			{ kind: "succeeded", latencyUs: 50 * MS },
		]);
	});

	it("lets requests to a hanging backend run into the client timeout", () => {
		const { events } = run(
			input({
				faults: [fault({ atUs: 0, behavior: "hang" })],
				timeoutUs: 400 * MS,
			}),
		);
		const failed = events.filter((e) => e.kind === "failed");
		expect(
			failed.every((e) => e.kind === "failed" && e.reason === "timeout"),
		).toBe(true);
		expect(failed.map((e) => e.req)).toEqual([1, 3, 5, 7, 9]);
		expect(failed[0]).toMatchObject({
			t: 500 * MS,
			latencyUs: 400 * MS,
			server: 1,
		});
	});

	it("fails in-flight work immediately when a backend crashes with refuse", () => {
		const { events } = run(
			input({
				phases: [{ startUs: 0, endUs: 1 * MS, rps: 1000 }],
				servers: [
					{
						id: "a",
						capacity: 1,
						queueCapacity: 0,
						serviceTimeUs: 300 * MS,
						distribution: "fixed",
					},
				],
				faults: [fault({ server: 0, atUs: 100 * MS })],
			}),
		);
		expect(events.map((e) => e.kind)).toEqual([
			"arrival",
			"routed",
			"service-start",
			"node-down",
			"evicted",
			"failed",
		]);
		expect(events[5]).toMatchObject({ reason: "server-crashed", t: 100 * MS });
	});

	it("fails fast with no-healthy-backend once every backend is marked down", () => {
		const { events } = run(
			input({
				servers: [
					{
						id: "a",
						capacity: 1,
						queueCapacity: 0,
						serviceTimeUs: 10 * MS,
						distribution: "fixed",
					},
				],
				faults: [fault({ server: 0, atUs: 0 })],
				healthCheck: {
					intervalUs: 1000 * MS,
					probeTimeoutUs: 100 * MS,
					unhealthyThreshold: 1,
					healthyThreshold: 1,
				},
			}),
		);
		const reasons = events.flatMap((e) =>
			e.kind === "failed" ? [e.reason] : [],
		);
		expect(reasons).toEqual(Array(10).fill("no-healthy-backend"));
	});

	it("stops cleanly at the event ceiling", () => {
		const { result, events } = run(input({ maxEvents: 7 }));
		expect(result.status).toBe("event-limit");
		expect(events).toHaveLength(7);
	});
});

describe("arrivals", () => {
	it("produces exactly rps × seconds constant arrivals", () => {
		const source = createArrivalSource(
			"constant",
			[
				{ startUs: 0, endUs: 2_000_000, rps: 100 },
				{ startUs: 2_000_000, endUs: 3_000_000, rps: 33 },
			],
			1,
		);
		let count = 0;
		let last = -1;
		for (let t = source.next(); t !== null; t = source.next()) {
			expect(t).toBeGreaterThanOrEqual(last);
			expect(Number.isInteger(t)).toBe(true);
			last = t;
			count++;
		}
		expect(count).toBe(233);
	});

	it("keeps poisson arrivals inside their phases with roughly the right rate", () => {
		const source = createArrivalSource(
			"poisson",
			[{ startUs: 1_000_000, endUs: 101_000_000, rps: 50 }],
			7,
		);
		const times: number[] = [];
		for (let t = source.next(); t !== null; t = source.next()) times.push(t);
		expect(times.every((t) => t >= 1_000_000 && t < 101_000_000)).toBe(true);
		expect(times.length).toBeGreaterThan(4700);
		expect(times.length).toBeLessThan(5300);
	});
});

const engineInputArb: fc.Arbitrary<EngineInput> = fc
	.record({
		seed: fc.integer({ min: 0, max: 2 ** 31 }),
		serverCount: fc.integer({ min: 1, max: 4 }),
		capacity: fc.integer({ min: 1, max: 4 }),
		queueCapacity: fc.integer({ min: 0, max: 5 }),
		serviceMs: fc.integer({ min: 1, max: 400 }),
		distribution: fc.constantFrom("fixed" as const, "exponential" as const),
		arrival: fc.constantFrom("constant" as const, "poisson" as const),
		rps: fc.integer({ min: 1, max: 80 }),
		durationMs: fc.integer({ min: 100, max: 3000 }),
		timeoutMs: fc.integer({ min: 10, max: 1000 }),
		healthCheck: fc.option(
			fc.record({
				intervalUs: fc.integer({ min: 50, max: 1000 }).map((v) => v * MS),
				probeTimeoutUs: fc.integer({ min: 10, max: 500 }).map((v) => v * MS),
				unhealthyThreshold: fc.integer({ min: 1, max: 3 }),
				healthyThreshold: fc.integer({ min: 1, max: 3 }),
			}),
			{ nil: null },
		),
		faults: fc.array(
			fc.record({
				server: fc.nat(3),
				atMs: fc.integer({ min: 0, max: 3000 }),
				lengthMs: fc.option(fc.integer({ min: 1, max: 2000 }), { nil: null }),
				behavior: fc.constantFrom("refuse" as const, "hang" as const),
			}),
			{ maxLength: 3 },
		),
		extraHorizonMs: fc.integer({ min: 0, max: 1500 }),
	})
	.map((r) => ({
		seed: r.seed,
		horizonUs: (r.durationMs + r.extraHorizonMs) * MS,
		maxEvents: 1_000_000,
		healthCheck: r.healthCheck,
		servers: Array.from({ length: r.serverCount }, (_, i) => ({
			id: `s${i}`,
			capacity: r.capacity,
			queueCapacity: r.queueCapacity,
			serviceTimeUs: r.serviceMs * MS,
			distribution: r.distribution,
		})),
		arrival: r.arrival,
		phases: [{ startUs: 0, endUs: r.durationMs * MS, rps: r.rps }],
		timeoutUs: r.timeoutMs * MS,
		faults: r.faults.map((f, i) => ({
			id: `f${i}`,
			server: f.server % r.serverCount,
			atUs: f.atMs * MS,
			recoverAtUs: f.lengthMs === null ? null : (f.atMs + f.lengthMs) * MS,
			behavior: f.behavior,
		})),
	}));

describe("invariants (property-based)", () => {
	it("is deterministic for the same input and seed", () => {
		fc.assert(
			fc.property(engineInputArb, (engineInput) => {
				const a = run(engineInput).events;
				const b = run(engineInput).events;
				expect(JSON.stringify(a)).toBe(JSON.stringify(b));
			}),
			{ numRuns: 60 },
		);
	});

	it("conserves requests, never double-terminates and respects capacity", () => {
		fc.assert(
			fc.property(engineInputArb, (engineInput) => {
				const { events, result } = run(engineInput);
				const terminal = new Map<number, number>();
				const busy = new Map<number, number>();
				const queued = new Map<number, number>();
				const waiting = new Set<number>();
				let arrivals = 0;
				let lastT = 0;

				for (const e of events) {
					expect(e.t).toBeGreaterThanOrEqual(lastT);
					expect(e.t).toBeLessThanOrEqual(engineInput.horizonUs);
					lastT = e.t;
					switch (e.kind) {
						case "arrival":
							arrivals++;
							break;
						case "succeeded":
						case "failed":
							terminal.set(e.req, (terminal.get(e.req) ?? 0) + 1);
							break;
						case "enqueued":
							waiting.add(e.req);
							queued.set(e.server, (queued.get(e.server) ?? 0) + 1);
							break;
						case "service-start": {
							if (waiting.delete(e.req))
								queued.set(e.server, (queued.get(e.server) ?? 0) - 1);
							const n = (busy.get(e.server) ?? 0) + 1;
							busy.set(e.server, n);
							const capacity = engineInput.servers[e.server]?.capacity ?? 0;
							expect(n).toBeLessThanOrEqual(capacity);
							break;
						}
						case "service-end":
							busy.set(e.server, (busy.get(e.server) ?? 0) - 1);
							break;
						case "evicted":
							if (e.from === "service")
								busy.set(e.server, (busy.get(e.server) ?? 0) - 1);
							else if (waiting.delete(e.req))
								queued.set(e.server, (queued.get(e.server) ?? 0) - 1);
							break;
						case "late-response":
							expect(terminal.get(e.req)).toBe(1);
							break;
						default:
							break;
					}
					for (const v of busy.values()) expect(v).toBeGreaterThanOrEqual(0);
					for (const [server, v] of queued) {
						expect(v).toBeGreaterThanOrEqual(0);
						const cap = engineInput.servers[server]?.queueCapacity ?? 0;
						expect(v).toBeLessThanOrEqual(cap);
					}
				}

				expect(result.requests).toBe(arrivals);
				for (const count of terminal.values()) expect(count).toBe(1);
				// offered = success + failure + still in flight at the horizon
				expect(terminal.size).toBeLessThanOrEqual(arrivals);
			}),
			{ numRuns: 150 },
		);
	});
});

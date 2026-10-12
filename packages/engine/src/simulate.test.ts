import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createArrivalSource, simulate } from "./simulate.ts";
import type {
	EdgeInput,
	EngineInput,
	FaultInput,
	NodeInput,
	SimEvent,
} from "./types.ts";

const MS = 1000;

type Service = Extract<NodeInput, { kind: "service" | "database" }>;
type Balancer = Extract<NodeInput, { kind: "load-balancer" }>;

const worker = (id: string, over: Partial<Service> = {}): NodeInput => ({
	kind: "service",
	id,
	capacity: 1,
	queueCapacity: 0,
	serviceTimeUs: 50 * MS,
	distribution: "fixed",
	...over,
});

const edge = (
	id: string,
	source: number,
	target: number,
	over: Partial<EdgeInput> = {},
): EdgeInput => ({
	id,
	source,
	target,
	latencyUs: 0,
	timeoutUs: null,
	retries: 0,
	circuitBreaker: null,
	...over,
});

/** The v0.1 shape: client(0) → load balancer(1) → servers(2..). */
function lbInput(
	overrides: Partial<EngineInput> & {
		servers?: NodeInput[];
		lb?: Partial<Balancer>;
	} = {},
): EngineInput {
	const {
		servers = [worker("server-a"), worker("server-b")],
		lb = {},
		...rest
	} = overrides;
	const nodes: NodeInput[] = [
		{ kind: "client", id: "client" },
		{
			kind: "load-balancer",
			id: "lb",
			algorithm: "round-robin",
			healthCheck: null,
			retries: 0,
			...lb,
		},
		...servers,
	];
	const edges: EdgeInput[] = [
		edge("c-lb", 0, 1),
		...servers.map((s, i) => edge(`lb-${s.id}`, 1, 2 + i)),
	];
	return {
		seed: 42,
		horizonUs: 2000 * MS,
		maxEvents: 1_000_000,
		nodes,
		edges,
		client: 0,
		arrival: "constant",
		phases: [{ startUs: 0, endUs: 1000 * MS, rps: 10 }],
		timeoutUs: 1000 * MS,
		faults: [],
		...rest,
	};
}

/** A chain: client(0) → api(1) → db(2). */
function chainInput(
	overrides: Partial<EngineInput> & {
		api?: Partial<Service>;
		db?: Partial<Service>;
		apiDb?: Partial<EdgeInput>;
	} = {},
): EngineInput {
	const { api = {}, db = {}, apiDb = {}, ...rest } = overrides;
	return {
		seed: 1,
		horizonUs: 3000 * MS,
		maxEvents: 1_000_000,
		nodes: [
			{ kind: "client", id: "client" },
			worker("api", {
				capacity: 4,
				queueCapacity: 4,
				serviceTimeUs: 10 * MS,
				...api,
			}),
			worker("db", {
				capacity: 2,
				queueCapacity: 10,
				serviceTimeUs: 20 * MS,
				...db,
			}),
		],
		edges: [edge("c-api", 0, 1), edge("api-db", 1, 2, apiDb)],
		client: 0,
		arrival: "constant",
		phases: [{ startUs: 0, endUs: 1000 * MS, rps: 20 }],
		timeoutUs: 500 * MS,
		faults: [],
		...rest,
	};
}

const crash = (
	node: number,
	over: Partial<Extract<FaultInput, { kind: "node-failure" }>> = {},
): FaultInput => ({
	kind: "node-failure",
	id: "crash",
	node,
	atUs: 500 * MS,
	recoverAtUs: null,
	behavior: "refuse",
	...over,
});

function run(input: EngineInput) {
	const events: SimEvent[] = [];
	const result = simulate(input, (e) => events.push(e));
	return { events, result };
}

const outcomes = (events: SimEvent[]) =>
	events.filter(
		(e): e is Extract<SimEvent, { kind: "succeeded" | "failed" }> =>
			e.kind === "succeeded" || e.kind === "failed",
	);
const failures = (events: SimEvent[]) =>
	events.filter(
		(e): e is Extract<SimEvent, { kind: "failed" }> => e.kind === "failed",
	);
const reasons = (events: SimEvent[]) => failures(events).map((e) => e.reason);
const routedTo = (events: SimEvent[]) =>
	events
		.filter(
			(e): e is Extract<SimEvent, { kind: "routed" }> => e.kind === "routed",
		)
		.map((e) => e.to);

describe("load balancer reference cases (v0.1 semantics)", () => {
	it("alternates round robin between two healthy backends", () => {
		const { events } = run(lbInput());
		expect(routedTo(events)).toEqual([2, 3, 2, 3, 2, 3, 2, 3, 2, 3]);
		const done = outcomes(events);
		expect(done).toHaveLength(10);
		expect(
			done.every((e) => e.kind === "succeeded" && e.latencyUs === 50 * MS),
		).toBe(true);
	});

	it("fails requests routed to a dead backend when nothing detects the failure", () => {
		const { events } = run(lbInput({ faults: [crash(3)] }));
		expect(failures(events).map((e) => e.req)).toEqual([5, 7, 9]);
		expect(new Set(reasons(events))).toEqual(new Set(["refused"]));
		expect(failures(events).every((e) => e.node === 3)).toBe(true);
	});

	it("stops routing to a backend only after the health check detects the failure", () => {
		const { events } = run(
			lbInput({
				faults: [crash(3)],
				lb: {
					healthCheck: {
						intervalUs: 300 * MS,
						probeTimeoutUs: 100 * MS,
						unhealthyThreshold: 1,
						healthyThreshold: 1,
					},
				},
			}),
		);
		expect(events.find((e) => e.kind === "health-changed")).toMatchObject({
			t: 600 * MS,
			node: 3,
			healthy: false,
			fault: 0,
		});
		expect(failures(events).map((e) => e.req)).toEqual([5]);
		const late = events.filter(
			(e): e is Extract<SimEvent, { kind: "routed" }> =>
				e.kind === "routed" && e.t >= 600 * MS,
		);
		expect(late.every((e) => e.to === 2)).toBe(true);
	});

	it("brings a backend back after the healthy threshold is met", () => {
		const { events } = run(
			lbInput({
				horizonUs: 3000 * MS,
				phases: [{ startUs: 0, endUs: 3000 * MS, rps: 10 }],
				faults: [crash(3, { recoverAtUs: 1000 * MS })],
				lb: {
					healthCheck: {
						intervalUs: 300 * MS,
						probeTimeoutUs: 100 * MS,
						unhealthyThreshold: 1,
						healthyThreshold: 2,
					},
				},
			}),
		);
		const changes = events.filter(
			(e): e is Extract<SimEvent, { kind: "health-changed" }> =>
				e.kind === "health-changed",
		);
		expect(changes.map((e) => [e.t / MS, e.healthy])).toEqual([
			[600, false],
			[1500, true],
		]);
	});

	it("rejects requests when every slot and queue position is taken", () => {
		const { events } = run(
			lbInput({
				servers: [
					worker("only", { queueCapacity: 1, serviceTimeUs: 250 * MS }),
				],
				timeoutUs: 5000 * MS,
				horizonUs: 5000 * MS,
			}),
		);
		const rejected = failures(events).filter((e) => e.reason === "queue-full");
		expect(rejected[0]?.req).toBe(2);
		expect(
			events.find((e) => e.kind === "service-start" && e.req === 1),
		).toMatchObject({ t: 250 * MS, queuedUs: 150 * MS });
	});

	it("times out slow responses and never counts the late response as success", () => {
		const { events } = run(
			lbInput({
				phases: [{ startUs: 0, endUs: 1 * MS, rps: 1000 }],
				servers: [worker("slow", { serviceTimeUs: 300 * MS })],
				timeoutUs: 200 * MS,
			}),
		);
		expect(events.map((e) => e.kind)).toEqual([
			"arrival",
			"call-start",
			"routed",
			"call-start",
			"service-start",
			"failed",
			"service-end",
			"late-response",
			"call-end",
			"call-end",
		]);
		expect(events[5]).toMatchObject({
			reason: "timeout",
			latencyUs: 200 * MS,
			node: 2,
		});
	});

	it("frees a slot held for a downstream call when the answer arrives after the client deadline", () => {
		// The database is 100× slower for the first second. Clients give up after 200 ms, but the
		// api slot stays busy until the database answers; once it does, the api must serve again.
		const { events } = run(
			chainInput({
				api: { capacity: 1, queueCapacity: 0 },
				db: { serviceTimeUs: 10 * MS },
				phases: [{ startUs: 0, endUs: 3000 * MS, rps: 5 }],
				timeoutUs: 200 * MS,
				faults: [
					{
						kind: "slowdown",
						id: "slow-db",
						node: 2,
						atUs: 0,
						untilUs: 1000 * MS,
						factor: 100,
						addUs: 0,
					},
				],
			}),
		);
		const lateArrivals = events
			.filter((e) => e.kind === "arrival" && e.t >= 1500 * MS)
			.map((e) => e.req);
		expect(lateArrivals.length).toBeGreaterThan(5);
		const succeededLate = outcomes(events).filter(
			(e) => e.kind === "succeeded" && lateArrivals.includes(e.req),
		);
		expect(succeededLate.length).toBe(lateArrivals.length);
		// The wasted answer is reported by the workers that produced it, never as a success.
		const late = events.filter((e) => e.kind === "late-response");
		expect(late.map((e) => e.node)).toEqual([2, 1]);
	});

	it("counts a response landing exactly on the deadline as success", () => {
		const { events } = run(
			lbInput({
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
			lbInput({
				faults: [crash(3, { atUs: 0, behavior: "hang" })],
				timeoutUs: 400 * MS,
			}),
		);
		expect(new Set(reasons(events))).toEqual(new Set(["timeout"]));
		expect(failures(events).map((e) => e.req)).toEqual([1, 3, 5, 7, 9]);
		expect(failures(events)[0]).toMatchObject({
			t: 500 * MS,
			latencyUs: 400 * MS,
			node: 3,
		});
	});

	it("fails in-flight work immediately when a backend crashes with refuse", () => {
		const { events } = run(
			lbInput({
				phases: [{ startUs: 0, endUs: 1 * MS, rps: 1000 }],
				servers: [worker("a", { serviceTimeUs: 300 * MS })],
				faults: [crash(2, { atUs: 100 * MS })],
			}),
		);
		expect(failures(events)).toMatchObject([
			{ reason: "lost-in-crash", t: 100 * MS, node: 2 },
		]);
	});

	it("fails fast with no-healthy-backend once every backend is marked down", () => {
		const { events } = run(
			lbInput({
				servers: [worker("a", { serviceTimeUs: 10 * MS })],
				faults: [crash(2, { atUs: 0 })],
				lb: {
					healthCheck: {
						intervalUs: 1000 * MS,
						probeTimeoutUs: 100 * MS,
						unhealthyThreshold: 1,
						healthyThreshold: 1,
					},
				},
			}),
		);
		expect(reasons(events)).toEqual(Array(10).fill("no-healthy-backend"));
	});

	it("stops cleanly at the event ceiling", () => {
		const { result, events } = run(lbInput({ maxEvents: 7 }));
		expect(result.status).toBe("event-limit");
		expect(events).toHaveLength(7);
	});

	it("retries on another backend when the balancer is told to", () => {
		const { events } = run(lbInput({ faults: [crash(3)], lb: { retries: 1 } }));
		expect(failures(events)).toHaveLength(0);
		const routed = events.filter(
			(e): e is Extract<SimEvent, { kind: "routed" }> =>
				e.kind === "routed" && e.req === 5,
		);
		expect(routed.map((e) => e.to)).toEqual([3, 2]);
	});

	it("least-connections prefers the backend with fewer outstanding calls", () => {
		const servers = [
			worker("fast", { capacity: 10, serviceTimeUs: 10 * MS }),
			worker("slow", { capacity: 10, serviceTimeUs: 900 * MS }),
		];
		const burst = { phases: [{ startUs: 0, endUs: 5 * MS, rps: 1000 }] };
		const lc = run(
			lbInput({ servers, lb: { algorithm: "least-connections" }, ...burst }),
		);
		const rr = run(lbInput({ servers, ...burst }));
		// Five arrivals within 5 ms: nothing completes, so least-connections alternates like round
		// robin. At 10 req/s "fast" is always idle again, so least-connections never picks "slow".
		expect(routedTo(lc.events)).toEqual([2, 3, 2, 3, 2]);
		expect(routedTo(rr.events)).toEqual([2, 3, 2, 3, 2]);
		const spaced = run(
			lbInput({ servers, lb: { algorithm: "least-connections" } }),
		);
		expect(routedTo(spaced.events).slice(0, 4)).toEqual([2, 2, 2, 2]);
	});
});

describe("call chains", () => {
	it("holds the caller's slot while the dependency works and adds both service times", () => {
		const { events } = run(
			chainInput({ phases: [{ startUs: 0, endUs: 1 * MS, rps: 1000 }] }),
		);
		expect(outcomes(events)).toMatchObject([
			{ kind: "succeeded", latencyUs: 30 * MS },
		]);
		expect(events.map((e) => e.kind)).toEqual([
			"arrival",
			"call-start",
			"service-start",
			"call-start",
			"service-start",
			"service-end",
			"call-end",
			"service-end",
			"call-end",
			"succeeded",
		]);
	});

	it("propagates the origin of a failure deep in the chain", () => {
		const { events } = run(
			chainInput({
				faults: [crash(2, { atUs: 0 })],
				phases: [{ startUs: 0, endUs: 1 * MS, rps: 1000 }],
			}),
		);
		expect(failures(events)).toMatchObject([{ reason: "refused", node: 2 }]);
	});

	it("a slow database fills the api's slots and queue (cascading failure)", () => {
		const { events } = run(
			chainInput({
				db: { capacity: 1, queueCapacity: 100, serviceTimeUs: 200 * MS },
				api: { capacity: 2, queueCapacity: 2, serviceTimeUs: 1 * MS },
				timeoutUs: 400 * MS,
			}),
		);
		const r = reasons(events);
		expect(r.filter((x) => x === "queue-full").length).toBeGreaterThan(0);
		expect(r.filter((x) => x === "timeout").length).toBeGreaterThan(0);
		expect(failures(events).every((e) => e.node === 1 || e.node === 2)).toBe(
			true,
		);
	});

	it("per-edge timeouts cut a call short and discard the late answer", () => {
		const { events } = run(
			chainInput({
				db: { serviceTimeUs: 100 * MS },
				apiDb: { timeoutUs: 30 * MS },
				phases: [{ startUs: 0, endUs: 1 * MS, rps: 1000 }],
			}),
		);
		expect(failures(events)).toMatchObject([
			{ reason: "timeout", node: 2, latencyUs: 40 * MS },
		]);
		expect(events.filter((e) => e.kind === "late-response")).toMatchObject([
			{ node: 2 },
		]);
	});

	it("retries make a flaky dependency succeed and show up as extra attempts", () => {
		const { events } = run(
			chainInput({
				phases: [{ startUs: 0, endUs: 1000 * MS, rps: 10 }],
				apiDb: { retries: 3 },
				faults: [
					{
						kind: "error-rate",
						id: "flaky",
						node: 2,
						atUs: 0,
						untilUs: null,
						rate: 0.5,
					},
				],
			}),
		);
		const attempts = events.filter(
			(e): e is Extract<SimEvent, { kind: "call-start" }> =>
				e.kind === "call-start" && e.edge === 1,
		);
		expect(attempts.some((a) => a.attempt > 1)).toBe(true);
		expect(
			outcomes(events).filter((e) => e.kind === "succeeded").length,
		).toBeGreaterThan(7);
	});

	it("a circuit breaker opens after consecutive failures and lets a trial call through later", () => {
		const { events } = run(
			chainInput({
				phases: [{ startUs: 0, endUs: 1000 * MS, rps: 10 }],
				apiDb: { circuitBreaker: { failureThreshold: 2, openUs: 300 * MS } },
				faults: [crash(2, { atUs: 0, recoverAtUs: 500 * MS })],
			}),
		);
		const breaker = events.filter(
			(e): e is Extract<SimEvent, { kind: "breaker" }> => e.kind === "breaker",
		);
		expect(breaker.map((e) => [e.t / MS, e.state]).slice(0, 4)).toEqual([
			[110, "open"],
			[410, "half-open"],
			[410, "open"],
			[710, "half-open"],
		]);
		expect(
			reasons(events).filter((r) => r === "circuit-open").length,
		).toBeGreaterThan(0);
		// After recovery the trial call at 710 ms succeeds and the breaker closes.
		expect(breaker.at(-1)).toMatchObject({ state: "closed" });
	});

	it("link latency adds to both directions and link loss hangs the call until its timeout", () => {
		const lat = run(
			chainInput({
				apiDb: { latencyUs: 5 * MS },
				phases: [{ startUs: 0, endUs: 1 * MS, rps: 1000 }],
			}),
		);
		expect(outcomes(lat.events)).toMatchObject([
			{ kind: "succeeded", latencyUs: 40 * MS },
		]);
		const loss = run(
			chainInput({
				apiDb: { timeoutUs: 50 * MS },
				phases: [{ startUs: 0, endUs: 1 * MS, rps: 1000 }],
				faults: [
					{
						kind: "link-loss",
						id: "loss",
						edge: 1,
						atUs: 0,
						untilUs: null,
						rate: 1,
					},
				],
			}),
		);
		expect(failures(loss.events)).toMatchObject([
			{ reason: "timeout", latencyUs: 60 * MS },
		]);
	});
});

describe("other components and faults", () => {
	it("a cache serves hits itself and misses from downstream", () => {
		const input: EngineInput = {
			...chainInput({ phases: [{ startUs: 0, endUs: 1000 * MS, rps: 100 }] }),
			nodes: [
				{ kind: "client", id: "client" },
				{
					kind: "cache",
					id: "cache",
					capacity: 100,
					queueCapacity: 0,
					serviceTimeUs: 1 * MS,
					distribution: "fixed",
					hitRatio: 0.8,
				},
				worker("db", { capacity: 100, serviceTimeUs: 50 * MS }),
			],
			faults: [
				{
					kind: "cache-flush",
					id: "flush",
					node: 1,
					atUs: 500 * MS,
					untilUs: 700 * MS,
				},
			],
		};
		const { events } = run(input);
		const hits = events.filter(
			(e): e is Extract<SimEvent, { kind: "cache-hit" }> =>
				e.kind === "cache-hit",
		);
		const before = hits.filter((h) => h.t < 500 * MS);
		const during = hits.filter((h) => h.t >= 500 * MS && h.t < 700 * MS);
		expect(before.filter((h) => h.hit).length / before.length).toBeGreaterThan(
			0.7,
		);
		expect(during.every((h) => !h.hit)).toBe(true);
		const fast = outcomes(events).filter(
			(e) => e.kind === "succeeded" && e.latencyUs === 1 * MS,
		).length;
		expect(fast).toBe(hits.filter((h) => h.hit).length);
	});

	it("a queue acknowledges at once, processes later and loses jobs in a crash", () => {
		const input: EngineInput = {
			...chainInput({
				phases: [{ startUs: 0, endUs: 100 * MS, rps: 100 }],
				horizonUs: 5000 * MS,
			}),
			nodes: [
				{ kind: "client", id: "client" },
				{
					kind: "queue",
					id: "jobs",
					capacity: 1,
					queueCapacity: 5,
					serviceTimeUs: 100 * MS,
					distribution: "fixed",
				},
				worker("db", { capacity: 10, serviceTimeUs: 10 * MS }),
			],
			faults: [crash(1, { atUs: 250 * MS })],
		};
		const { events } = run(input);
		const done = outcomes(events);
		expect(
			done.filter((e) => e.kind === "succeeded" && e.latencyUs === 0).length,
		).toBe(6);
		expect(reasons(events).filter((r) => r === "queue-full").length).toBe(4);
		const jobsDone = events.filter(
			(e): e is Extract<SimEvent, { kind: "job-done" }> =>
				e.kind === "job-done",
		);
		expect(jobsDone.filter((j) => j.ok).length).toBe(2);
		expect(jobsDone.filter((j) => !j.ok).length).toBe(4);
	});

	it("slowdown and capacity faults change service time and concurrency for their window", () => {
		const slow = run(
			chainInput({
				phases: [{ startUs: 0, endUs: 1 * MS, rps: 1000 }],
				faults: [
					{
						kind: "slowdown",
						id: "slow",
						node: 2,
						atUs: 0,
						untilUs: 100 * MS,
						factor: 3,
						addUs: 5 * MS,
					},
				],
			}),
		);
		expect(outcomes(slow.events)).toMatchObject([
			{ latencyUs: 10 * MS + 65 * MS },
		]);
		const cap = run(
			lbInput({
				servers: [
					worker("a", {
						capacity: 4,
						queueCapacity: 0,
						serviceTimeUs: 500 * MS,
					}),
				],
				phases: [{ startUs: 0, endUs: 10 * MS, rps: 400 }],
				faults: [
					{
						kind: "capacity",
						id: "half",
						node: 2,
						atUs: 0,
						untilUs: null,
						capacity: 2,
					},
				],
			}),
		);
		expect(reasons(cap.events).filter((r) => r === "queue-full")).toHaveLength(
			2,
		);
	});

	it("error-rate faults fail a share of calls at the node", () => {
		const { events } = run(
			lbInput({
				servers: [worker("a", { capacity: 100 })],
				phases: [{ startUs: 0, endUs: 1000 * MS, rps: 200 }],
				faults: [
					{
						kind: "error-rate",
						id: "err",
						node: 2,
						atUs: 0,
						untilUs: null,
						rate: 0.25,
					},
				],
			}),
		);
		const injected = reasons(events).filter(
			(r) => r === "injected-error",
		).length;
		expect(injected).toBeGreaterThan(30);
		expect(injected).toBeLessThan(70);
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

type WorkerKind = "service" | "database" | "cache" | "queue";

/** Random graphs: client → (lb | worker) with a few workers, optional chain, random faults. */
const engineInputArb: fc.Arbitrary<EngineInput> = fc
	.record({
		seed: fc.integer({ min: 0, max: 2 ** 31 }),
		workerCount: fc.integer({ min: 1, max: 4 }),
		kinds: fc.array(
			fc.constantFrom<WorkerKind>("service", "database", "cache", "queue"),
			{ minLength: 4, maxLength: 4 },
		),
		useLb: fc.boolean(),
		algorithm: fc.constantFrom<Balancer["algorithm"]>(
			"round-robin",
			"least-connections",
			"random",
		),
		lbRetries: fc.integer({ min: 0, max: 2 }),
		capacity: fc.integer({ min: 1, max: 4 }),
		queueCapacity: fc.integer({ min: 0, max: 5 }),
		serviceMs: fc.integer({ min: 1, max: 300 }),
		distribution: fc.constantFrom<Service["distribution"]>(
			"fixed",
			"exponential",
		),
		arrival: fc.constantFrom<EngineInput["arrival"]>("constant", "poisson"),
		rps: fc.integer({ min: 1, max: 60 }),
		durationMs: fc.integer({ min: 100, max: 2000 }),
		timeoutMs: fc.integer({ min: 10, max: 800 }),
		edgeTimeoutMs: fc.option(fc.integer({ min: 5, max: 400 }), { nil: null }),
		edgeRetries: fc.integer({ min: 0, max: 2 }),
		latencyMs: fc.integer({ min: 0, max: 20 }),
		breaker: fc.option(
			fc.record({
				failureThreshold: fc.integer({ min: 1, max: 4 }),
				openUs: fc.integer({ min: 50, max: 500 }).map((v) => v * MS),
			}),
			{ nil: null },
		),
		chain: fc.boolean(),
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
				kind: fc.constantFrom<FaultInput["kind"]>(
					"node-failure",
					"slowdown",
					"error-rate",
					"capacity",
					"link-latency",
					"link-loss",
					"cache-flush",
				),
				target: fc.nat(5),
				atMs: fc.integer({ min: 0, max: 2000 }),
				lengthMs: fc.option(fc.integer({ min: 1, max: 1500 }), { nil: null }),
				behavior: fc.constantFrom<"refuse" | "hang">("refuse", "hang"),
				rate: fc.double({ min: 0, max: 1, noNaN: true }),
				factor: fc.double({ min: 1, max: 5, noNaN: true }),
				n: fc.integer({ min: 1, max: 3 }),
			}),
			{ maxLength: 4 },
		),
		extraHorizonMs: fc.integer({ min: 0, max: 1000 }),
	})
	.map((r): EngineInput => {
		const nodes: NodeInput[] = [{ kind: "client", id: "client" }];
		if (r.useLb)
			nodes.push({
				kind: "load-balancer",
				id: "lb",
				algorithm: r.algorithm,
				healthCheck: r.healthCheck,
				retries: r.lbRetries,
			});
		const firstWorker = nodes.length;
		for (let i = 0; i < r.workerCount; i++) {
			const kind = r.kinds[i] as WorkerKind;
			const base = {
				id: `w${i}`,
				capacity: r.capacity,
				queueCapacity: r.queueCapacity,
				serviceTimeUs: r.serviceMs * MS,
				distribution: r.distribution,
			};
			nodes.push(
				kind === "cache" ? { kind, hitRatio: 0.5, ...base } : { kind, ...base },
			);
		}
		const edges: EdgeInput[] = [];
		const policy = {
			latencyUs: r.latencyMs * MS,
			timeoutUs: r.edgeTimeoutMs === null ? null : r.edgeTimeoutMs * MS,
			retries: r.edgeRetries,
			circuitBreaker: r.breaker,
		};
		if (r.useLb) {
			edges.push(edge("c-lb", 0, 1));
			for (let i = 0; i < r.workerCount; i++)
				edges.push(edge(`lb-w${i}`, 1, firstWorker + i, policy));
		} else edges.push(edge("c-w0", 0, firstWorker, policy));
		if (r.chain)
			for (let i = 0; i + 1 < r.workerCount; i++)
				edges.push(
					edge(`w${i}-w${i + 1}`, firstWorker + i, firstWorker + i + 1, policy),
				);
		const workerIndex = (t: number) => firstWorker + (t % r.workerCount);
		const faults: FaultInput[] = r.faults.map((f, i): FaultInput => {
			const atUs = f.atMs * MS;
			const untilUs = f.lengthMs === null ? null : (f.atMs + f.lengthMs) * MS;
			const id = `f${i}`;
			switch (f.kind) {
				case "node-failure":
					return {
						kind: "node-failure",
						id,
						node: workerIndex(f.target),
						atUs,
						recoverAtUs: untilUs,
						behavior: f.behavior,
					};
				case "slowdown":
					return {
						kind: "slowdown",
						id,
						node: workerIndex(f.target),
						atUs,
						untilUs,
						factor: f.factor,
						addUs: f.n * MS,
					};
				case "error-rate":
					return {
						kind: "error-rate",
						id,
						node: workerIndex(f.target),
						atUs,
						untilUs,
						rate: f.rate,
					};
				case "capacity":
					return {
						kind: "capacity",
						id,
						node: workerIndex(f.target),
						atUs,
						untilUs,
						capacity: f.n,
					};
				case "link-latency":
					return {
						kind: "link-latency",
						id,
						edge: f.target % edges.length,
						atUs,
						untilUs,
						addUs: f.n * MS,
					};
				case "link-loss":
					return {
						kind: "link-loss",
						id,
						edge: f.target % edges.length,
						atUs,
						untilUs,
						rate: f.rate,
					};
				default:
					return {
						kind: "cache-flush",
						id,
						node: workerIndex(f.target),
						atUs,
						untilUs,
					};
			}
		});
		return {
			seed: r.seed,
			horizonUs: (r.durationMs + r.extraHorizonMs) * MS,
			maxEvents: 2_000_000,
			nodes,
			edges,
			client: 0,
			arrival: r.arrival,
			phases: [{ startUs: 0, endUs: r.durationMs * MS, rps: r.rps }],
			timeoutUs: r.timeoutMs * MS,
			faults,
		};
	});

describe("invariants (property-based)", () => {
	it("is deterministic for the same input and seed", () => {
		fc.assert(
			fc.property(engineInputArb, (input) => {
				expect(JSON.stringify(run(input).events)).toBe(
					JSON.stringify(run(input).events),
				);
			}),
			{ numRuns: 50 },
		);
	});

	it("conserves requests, ends each exactly once, and respects capacity and queue bounds", () => {
		fc.assert(
			fc.property(engineInputArb, (input) => {
				const { events, result } = run(input);
				const terminal = new Map<number, number>();
				const busy = new Map<number, number>();
				const queued = new Map<number, number>();
				const waitingCalls = new Set<number>();
				const callOpen = new Set<number>();
				let arrivals = 0;
				let lastT = 0;
				const capacityOf = (node: number) => {
					const n = input.nodes[node];
					return n && "capacity" in n ? n.capacity : 0;
				};
				for (const e of events) {
					expect(e.t).toBeGreaterThanOrEqual(lastT);
					expect(e.t).toBeLessThanOrEqual(input.horizonUs);
					lastT = e.t;
					switch (e.kind) {
						case "arrival":
							arrivals++;
							break;
						case "succeeded":
						case "failed":
							terminal.set(e.req, (terminal.get(e.req) ?? 0) + 1);
							break;
						case "call-start":
							expect(callOpen.has(e.call)).toBe(false);
							callOpen.add(e.call);
							break;
						case "call-end":
							expect(callOpen.delete(e.call)).toBe(true);
							break;
						case "enqueued":
							if (input.nodes[e.node]?.kind !== "queue")
								waitingCalls.add(e.call);
							queued.set(e.node, (queued.get(e.node) ?? 0) + 1);
							break;
						case "service-start": {
							if (waitingCalls.delete(e.call))
								queued.set(e.node, (queued.get(e.node) ?? 0) - 1);
							const n = (busy.get(e.node) ?? 0) + 1;
							busy.set(e.node, n);
							expect(n).toBeLessThanOrEqual(capacityOf(e.node));
							break;
						}
						case "service-end":
							busy.set(e.node, (busy.get(e.node) ?? 0) - 1);
							break;
						case "evicted":
							if (e.from === "service")
								busy.set(e.node, (busy.get(e.node) ?? 0) - 1);
							else if (waitingCalls.delete(e.call))
								queued.set(e.node, (queued.get(e.node) ?? 0) - 1);
							break;
						default:
							break;
					}
					for (const v of busy.values()) expect(v).toBeGreaterThanOrEqual(0);
					for (const [node, v] of queued) {
						expect(v).toBeGreaterThanOrEqual(0);
						const n = input.nodes[node];
						if (n && "queueCapacity" in n && n.kind !== "queue")
							expect(v).toBeLessThanOrEqual(n.queueCapacity);
					}
				}
				expect(result.requests).toBe(arrivals);
				for (const count of terminal.values()) expect(count).toBe(1);
				expect(terminal.size).toBeLessThanOrEqual(arrivals);
			}),
			{ numRuns: 150 },
		);
	});
});

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
	addLink,
	addNode,
	cloneExperiment,
	linkProblem,
	removeLink,
	removeNode,
	uniqueId,
} from "./edit.ts";
import {
	builtInExperiments,
	EXAMPLE_IDS,
	findBuiltIn,
	LOCALES,
	STARTER_COMPARISON,
} from "./examples.ts";
import proposal from "./fixtures/proposal-0.1.0.json";
import v1 from "./fixtures/v0.1.0.json";
import { parseImportJson } from "./import.ts";
import { CATALOG } from "./presets.ts";
import type { Experiment } from "./schema.ts";
import { sha256Hex } from "./sha256.ts";
import { TEMPLATE_IDS, templateExperiment } from "./templates.ts";
import {
	checkExperiment,
	parseExperiment,
	parseExperimentJson,
} from "./validate.ts";

const base = (): Experiment =>
	structuredClone(findBuiltIn(STARTER_COMPARISON.a) as Experiment);
const linkAt = (e: Experiment, i: number) =>
	e.model.links[i] as Experiment["model"]["links"][number];
const chain = (): Experiment =>
	structuredClone(findBuiltIn("cascading-failure") as Experiment);

function keysOf(value: unknown) {
	const result = parseExperiment(value);
	return result.ok
		? []
		: result.issues.map((i) => `${i.path}:${i.message.key}`);
}

const TEXT = {
	client: "Client",
	balancer: "Load balancer",
	api: "API",
	database: "Database",
	cache: "Cache",
	queue: "Queue",
	auth: "Auth",
	worker: "Worker",
	server: (l: string) => `Server ${l}`,
	pooler: "PgBouncer",
	cluster: "Cluster",
	primary: "Primary",
	replica: (n: number) => `Replica ${n}`,
	cdn: "CDN",
	webServer: (l: string) => `Web ${l}`,
	gateway: "Gateway",
	assumptions: ["abstract model"],
};

describe("built-in experiments", () => {
	it("validate in every language with the same ids", () => {
		for (const locale of LOCALES) {
			const list = builtInExperiments(locale);
			expect(list.map((e) => e.experimentId)).toEqual(EXAMPLE_IDS);
		}
		// Translations never change behavior.
		for (const id of EXAMPLE_IDS)
			expect(runKey(findBuiltIn(id, "id") as Experiment)).toBe(
				runKey(findBuiltIn(id, "en") as Experiment),
			);
	});

	it("the starter pair differs in exactly one behavioral variable", () => {
		const a = findBuiltIn(STARTER_COMPARISON.a) as Experiment;
		const b = findBuiltIn(STARTER_COMPARISON.b) as Experiment;
		expect(semanticDiff(a, b)).toMatchObject([
			{
				key: "node.lb.hc.enabled",
				before: false,
				after: true,
				field: "healthCheck.enabled",
			},
		]);
	});

	it("templates are valid experiments", () => {
		for (const id of TEMPLATE_IDS) {
			const e = templateExperiment(id, `t-${id}`, "Template", TEXT);
			const issues = checkExperiment(e).filter(
				(i) => i.message.key !== "graph.clientOneLink",
			);
			expect(issues, id).toEqual([]);
			if (id !== "blank") expect(checkExperiment(e)).toEqual([]);
		}
	});
});

describe("migrations", () => {
	it("upgrades 0.1.0-proposal and 0.1.0 files to the current schema", () => {
		const p = parseExperiment(proposal);
		expect(p.ok && p.migratedFrom).toBe("0.1.0-proposal");
		const v = parseExperiment(v1);
		expect(v.ok && v.migratedFrom).toBe("0.1.0");
		if (!v.ok) return;
		expect(v.experiment.model.nodes.map((n) => n.kind)).toEqual([
			"client",
			"load-balancer",
			"service",
			"service",
		]);
		expect(v.experiment.model.links[0]).toMatchObject({
			id: "client-lb",
			latencyMs: 0,
			timeoutMs: null,
			retries: 0,
		});
		// A migrated v1 file behaves exactly like the current example.
		expect(runKey(v.experiment)).toBe(
			runKey(findBuiltIn(STARTER_COMPARISON.b) as Experiment),
		);
	});

	it("rejects unknown schema versions with a translatable message", () => {
		const issues = parseExperiment({ ...base(), schemaVersion: "9.0.0" });
		expect(issues.ok).toBe(false);
		if (!issues.ok)
			expect(issues.issues[0]?.message).toMatchObject({
				key: "import.unknownVersion",
				params: { version: "9.0.0" },
			});
	});
});

describe("validation", () => {
	it("reports field problems with a path, a key and the field name", () => {
		const e = base();
		const server = e.model.nodes[2];
		if (server?.kind === "service") server.config.serviceTimeMs = -5;
		const result = parseExperiment(e);
		expect(result.ok).toBe(false);
		if (!result.ok)
			expect(result.issues).toContainEqual({
				path: "model.nodes[2].config.serviceTimeMs",
				message: {
					key: "validation.gt",
					params: { field: "worker.serviceTimeMs", unit: "ms", value: 0 },
				},
			});
	});

	it("rejects unknown fields instead of ignoring them", () => {
		expect(keysOf({ ...base(), script: "alert(1)" }).length).toBeGreaterThan(0);
	});

	it("checks the graph: cycles, dangling links, client links, unreachable nodes", () => {
		const e = chain();
		e.model.links.push({
			...linkAt(e, 1),
			id: "back",
			source: "db",
			target: "api",
		});
		expect(keysOf(e)).toContain("model.links:graph.cycle");

		const dangling = chain();
		linkAt(dangling, 1).target = "nowhere";
		expect(keysOf(dangling)).toContain("model.links[1]:graph.danglingLink");

		const twoClientLinks = chain();
		twoClientLinks.model.links.push({
			...linkAt(twoClientLinks, 0),
			id: "c2",
			target: "db",
		});
		expect(keysOf(twoClientLinks)).toContain("model.links:graph.clientOneLink");

		const unreachable = chain();
		unreachable.model.links = unreachable.model.links.filter(
			(l) => l.id !== "api-db",
		);
		expect(keysOf(unreachable)).toContain("model.links:graph.unreachable");

		const cache = structuredClone(findBuiltIn("cache-stampede") as Experiment);
		cache.model.links.push({
			...linkAt(cache, 2),
			id: "cache-api",
			source: "cache",
			target: "api",
		});
		expect(
			keysOf(cache).some(
				(k) =>
					k.endsWith("graph.cacheOneDownstream") || k.endsWith("graph.cycle"),
			),
		).toBe(true);
	});

	it("checks fault targets and windows", () => {
		const e = chain();
		e.faults = [
			{
				id: "a",
				kind: "node-failure",
				target: "client",
				atMs: 10,
				recoverAtMs: 20,
				behavior: "refuse",
			},
			{ id: "b", kind: "cache-flush", target: "api", atMs: 10, untilMs: 20 },
			{
				id: "c",
				kind: "link-loss",
				target: "api",
				atMs: 10,
				untilMs: 20,
				rate: 0.5,
			},
			{
				id: "d",
				kind: "slowdown",
				target: "db",
				atMs: 50,
				untilMs: 40,
				factor: 2,
				addMs: 0,
				ramp: false,
			},
			{
				id: "e",
				kind: "capacity",
				target: "db",
				atMs: 0,
				untilMs: null,
				capacity: 999,
			},
		];
		const keys = keysOf(e);
		expect(keys).toEqual(
			expect.arrayContaining([
				"faults[0].target:fault.targetNotWorker",
				"faults[1].target:fault.flushNeedsCache",
				"faults[2].target:fault.targetNotLink",
				"faults[3].untilMs:fault.endBeforeStart",
				"faults[4].capacity:fault.capacityAboveNode",
			]),
		);
	});

	it("rejects runs that exceed the request budget", () => {
		const e = base();
		e.workload.offeredRps = 5000;
		e.workload.durationMs = 600_000;
		expect(keysOf(e)).toContain("workload.offeredRps:budget.requests");
	});

	it("explains broken JSON and oversized files", () => {
		const broken = parseExperimentJson("{ nope");
		expect(!broken.ok && broken.issues[0]?.message.key).toBe(
			"import.invalidJson",
		);
		const huge = parseExperimentJson(`"${"x".repeat(600 * 1024)}"`);
		expect(!huge.ok && huge.issues[0]?.message.key).toBe("import.tooLarge");
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
			propagateDeadline: false,
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

	it("maps nodes, links and faults to engine indexes", () => {
		const compiled = compileExperiment(
			structuredClone(findBuiltIn("circuit-breaker") as Experiment),
		);
		expect(compiled.topology.nodeIds).toEqual(["client", "api", "db"]);
		expect(compiled.engine.edges[1]).toMatchObject({
			source: 1,
			target: 2,
			timeoutUs: 300_000,
			circuitBreaker: { failureThreshold: 5, openUs: 5_000_000 },
		});
		expect(compiled.engine.faults[0]).toMatchObject({
			kind: "slowdown",
			node: 2,
			atUs: 20_000_000,
			factor: 50,
		});
	});
});

describe("canonical form and digests", () => {
	it("sorts keys and ignores key order", () => {
		expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
			'{"a":[2,{"c":2,"d":1}],"b":1}',
		);
		fc.assert(
			fc.property(fc.dictionary(fc.string(), fc.integer()), (obj) => {
				expect(
					canonicalJson(Object.fromEntries(Object.entries(obj).reverse())),
				).toBe(canonicalJson(obj));
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

	it("ignores layout in the input digest and names in the run key", () => {
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
	it("adds a node linked from another, copying a sibling's settings", () => {
		const { experiment, id } = addNode(base(), "service", { from: "lb" });
		expect(id).toBe("service-3");
		expect(checkExperiment(experiment)).toEqual([]);
		const added = experiment.model.nodes.find((n) => n.id === id);
		expect(added?.kind === "service" && added.config.serviceTimeMs).toBe(100);
		expect(experiment.model.links.at(-1)).toMatchObject({
			source: "lb",
			target: id,
		});
	});

	it("removes a node with its links and faults", () => {
		const { experiment, removedFaults } = removeNode(base(), "server-b");
		expect(removedFaults).toBe(1);
		expect(checkExperiment(experiment)).toEqual([]);
	});

	it("adds and removes links, refusing duplicates and self links", () => {
		const e = chain();
		expect(addLink(e, "api", "db").id).toBeNull();
		expect(addLink(e, "api", "api").id).toBeNull();
		// The client already calls the api; a second entry point is refused up front.
		expect(addLink(e, "client", "db").id).toBeNull();
		const withCache = addNode(e, "cache", {});
		const { experiment, id } = addLink(
			withCache.experiment,
			"api",
			withCache.id,
		);
		expect(id).toBe(`api-${withCache.id}`);
		expect(removeLink(experiment, id as string).model.links).toHaveLength(2);
	});

	it("adds faults of every kind with valid defaults", () => {
		const e = structuredClone(findBuiltIn("cache-stampede") as Experiment);
		e.faults = [];
		for (const kind of [
			"node-failure",
			"slowdown",
			"error-rate",
			"capacity",
			"link-latency",
			"link-loss",
			"cache-flush",
		] as const) {
			const added = addFault(e, kind);
			expect(added, kind).not.toBeNull();
			if (added) expect(checkExperiment(added.experiment), kind).toEqual([]);
		}
	});

	it("clones under a fresh id without the original's hypotheses", () => {
		const clone = cloneExperiment(
			base(),
			["lb-failure-no-health-checks-variant"],
			"variant",
			"Describe the change.",
		);
		expect(clone.experimentId).toBe("lb-failure-no-health-checks-variant-2");
		expect(clone.expectedObservations).toEqual([]);
		expect(semanticDiff(base(), clone)).toEqual([]);
	});

	it("normalizes ids", () => {
		expect(uniqueId("My Experiment!", [])).toBe("my-experiment");
		expect(uniqueId("a", ["a", "a-2"])).toBe("a-3");
	});
});

describe("parseImportJson", () => {
	const result = (experiment: unknown) => ({
		resultSchemaVersion: "0.1.0",
		engineVersion: "0.2.0",
		behaviorDigest: "sha256:abc",
		traceDigest: "fnv1a32x2:0011",
		metrics: { offered: 6000, failed: 1005 },
		experiment,
	});

	it("imports the experiment embedded in a result file, with its claimed digests", () => {
		expect(parseImportJson(JSON.stringify(result(base())))).toMatchObject({
			ok: true,
			kind: "result",
			claimed: { behaviorDigest: "abc", traceDigest: "0011", failed: 1005 },
		});
	});

	it("imports both sides of a comparison bundle", () => {
		const parsed = parseImportJson(
			JSON.stringify({
				comparisonSchemaVersion: "0.1.0",
				a: result(base()),
				b: result(findBuiltIn(STARTER_COMPARISON.b)),
			}),
		);
		expect(parsed.ok && parsed.kind).toBe("comparison");
	});

	it("still validates the embedded experiment", () => {
		const broken = base();
		broken.seed = -1;
		const parsed = parseImportJson(JSON.stringify(result(broken)));
		expect(!parsed.ok && parsed.issues[0]?.path).toBe("experiment.seed");
	});
});

describe("v0.3 contract", () => {
	const lb = () =>
		templateExperiment("load-balanced", "t", "T", TEXT) as Experiment;

	it("migrates 0.2.0 files with every new switch off", () => {
		const old = structuredClone(
			findBuiltIn("retry-storm") as Experiment,
		) as unknown as {
			schemaVersion: string;
			model: {
				nodes: Array<{ config?: Record<string, unknown> }>;
				links: Array<Record<string, unknown>>;
			};
			workload: Record<string, unknown>;
			faults: Array<Record<string, unknown>>;
		};
		old.schemaVersion = "0.2.0";
		for (const n of old.model.nodes)
			if (n.config)
				for (const k of [
					"contention",
					"coherency",
					"queueTimeoutMs",
					"callMode",
				])
					delete n.config[k];
		for (const l of old.model.links)
			for (const k of ["retryBackoffMs", "retryJitter", "retryBudget"])
				delete l[k];
		delete old.workload.propagateDeadline;
		for (const f of old.faults) delete f.ramp;
		const parsed = parseExperiment(old);
		expect(parsed.ok && parsed.migratedFrom).toBe("0.2.0");
		if (!parsed.ok) return;
		const original = findBuiltIn("retry-storm") as Experiment;
		expect(runKey(parsed.experiment)).toBe(runKey(original));
	});

	it("refuses links that could never be valid, before they are made", () => {
		const e = lb();
		const [client, balancer, a] = e.model.nodes.map((n) => n.id) as [
			string,
			string,
			string,
		];
		expect(linkProblem(e, a, a)?.key).toBe("graph.selfLink");
		expect(linkProblem(e, balancer, a)?.key).toBe("graph.duplicateLink");
		expect(linkProblem(e, a, client)?.key).toBe("graph.intoClient");
		expect(linkProblem(e, a, balancer)?.key).toBe("graph.cycle");
		expect(linkProblem(e, client, a)?.key).toBe("graph.clientOneLink");
		const withDb = addNode(e, "database", { from: a }).experiment;
		const db = withDb.model.nodes.at(-1)?.id as string;
		const b = e.model.nodes[3]?.id as string;
		expect(linkProblem(withDb, b, db)).toBeNull();
		expect(addLink(withDb, a, client).id).toBeNull();
		expect(addLink(withDb, b, db).id).not.toBeNull();
	});

	it("lets a pooler and a rate limiter have exactly one downstream", () => {
		let e = lb();
		const a = e.model.nodes[2]?.id as string;
		const pooled = addNode(e, "pooler", { from: a });
		e = pooled.experiment;
		e = addNode(e, "database", { from: pooled.id }).experiment;
		const other = addNode(e, "database", {});
		expect(linkProblem(other.experiment, pooled.id, other.id)?.key).toBe(
			"graph.oneDownstream",
		);
	});

	it("builds every catalog component as a valid node", () => {
		for (const entry of CATALOG) {
			let e = lb();
			const a = e.model.nodes[2]?.id as string;
			const r = addNode(e, entry.kind, { from: a, preset: entry.id });
			e = r.experiment;
			// Routers need something behind them to be valid.
			if (
				["pooler", "rate-limiter", "load-balancer", "db-cluster"].includes(
					entry.kind,
				)
			) {
				e = addNode(e, "database", { from: r.id }).experiment;
				if (entry.kind === "db-cluster")
					e = addNode(e, "database", { from: r.id }).experiment;
			}
			const node = e.model.nodes.find((n) => n.id === r.id);
			expect(node?.preset ?? node?.kind, entry.id).toBe(entry.id);
			expect(checkExperiment(e), entry.id).toEqual([]);
			const parsed = parseExperiment(e);
			expect(parsed.ok, entry.id).toBe(true);
		}
	});

	it("rejects a ramp without an end and a cluster with a single node", () => {
		const e = templateExperiment("db-cluster", "c", "C", TEXT) as Experiment;
		expect(checkExperiment(e)).toEqual([]);
		const cluster = e.model.nodes.find((n) => n.kind === "db-cluster")
			?.id as string;
		const single = {
			...e,
			model: {
				...e.model,
				links: e.model.links.filter(
					(l) =>
						l.source !== cluster ||
						l === e.model.links.find((x) => x.source === cluster),
				),
			},
		};
		expect(checkExperiment(single).map((i) => i.message.key)).toContain(
			"graph.clusterNeedsNodes",
		);
		const db = e.model.nodes.find((n) => n.kind === "database")?.id as string;
		const ramped = {
			...e,
			faults: [
				{
					id: "leak",
					kind: "slowdown" as const,
					target: db,
					atMs: 0,
					untilMs: null,
					factor: 2,
					addMs: 0,
					ramp: true,
				},
			],
		};
		expect(checkExperiment(ramped).map((i) => i.message.key)).toContain(
			"fault.rampNeedsEnd",
		);
	});
});

describe("adding components", () => {
	it("inserts after a component that can only call one other, instead of branching", () => {
		const e = templateExperiment("api-database", "t", "T", TEXT) as Experiment;
		const api = e.model.nodes.find((n) => n.kind === "service")?.id as string;
		// Client → API already exists: a CDN added after the client goes in between.
		const cdn = addNode(e, "cache", { from: "client", preset: "cdn" });
		const links = cdn.experiment.model.links.map(
			(l) => `${l.source}>${l.target}`,
		);
		expect(links).toContain(`client>${cdn.id}`);
		expect(links).toContain(`${cdn.id}>${api}`);
		expect(links).not.toContain(`client>${api}`);
		expect(checkExperiment(cdn.experiment)).toEqual([]);
	});
});

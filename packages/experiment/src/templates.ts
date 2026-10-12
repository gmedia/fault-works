import { addLink, addNode, DEFAULT_HEALTH_CHECK, makeNode } from "./edit.ts";
import { type Experiment, SCHEMA_VERSION } from "./schema.ts";

export const TEMPLATE_IDS = [
	"blank",
	"load-balanced",
	"api-database",
	"cache-database",
	"worker-queue",
	"microservices",
	"pooled-database",
	"db-cluster",
	"cdn-origin",
	"api-gateway",
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** Node labels per language; everything else in a template is language-neutral. */
export interface TemplateText {
	client: string;
	balancer: string;
	api: string;
	database: string;
	cache: string;
	queue: string;
	auth: string;
	worker: string;
	server: (letter: string) => string;
	pooler: string;
	cluster: string;
	primary: string;
	replica: (n: number) => string;
	cdn: string;
	webServer: (letter: string) => string;
	gateway: string;
	assumptions: string[];
}

function base(id: string, title: string, text: TemplateText): Experiment {
	return {
		schemaVersion: SCHEMA_VERSION,
		experimentId: id,
		title,
		question: "",
		description: "",
		seed: 42,
		model: { nodes: [makeNode("client", "client", text.client)], links: [] },
		workload: {
			arrival: "constant",
			offeredRps: 100,
			startMs: 0,
			durationMs: 60_000,
			timeoutMs: 1000,
			propagateDeadline: false,
			bursts: [],
		},
		faults: [],
		run: { sampleWindowMs: 1000 },
		assumptions: text.assumptions,
		expectedObservations: [],
		layout: { client: { x: 0, y: 0 } },
	};
}

/**
 * Starting topologies. They are built with the same helpers the editor uses, so a template is
 * nothing a user could not build by hand.
 */
export function templateExperiment(
	template: TemplateId,
	id: string,
	title: string,
	text: TemplateText,
): Experiment {
	let e = base(id, title, text);
	const place = (nodeId: string, x: number, y: number) => {
		e = { ...e, layout: { ...e.layout, [nodeId]: { x, y } } };
	};
	const add = (
		kind: Parameters<typeof addNode>[1],
		from: string,
		label: string,
		x: number,
		y: number,
		preset?: string,
	) => {
		const r = addNode(e, kind, { from, label, preset, position: { x, y } });
		e = r.experiment;
		return r.id;
	};
	switch (template) {
		case "blank":
			break;
		case "load-balanced": {
			const lb = add("load-balancer", "client", text.balancer, 300, 0);
			e = {
				...e,
				model: {
					...e.model,
					nodes: e.model.nodes.map((n) =>
						n.id === lb && n.kind === "load-balancer"
							? {
									...n,
									config: {
										...n.config,
										healthCheck: { ...DEFAULT_HEALTH_CHECK },
									},
								}
							: n,
					),
				},
			};
			add("service", lb, text.server("A"), 620, -80);
			add("service", lb, text.server("B"), 620, 80);
			break;
		}
		case "api-database": {
			const api = add("service", "client", text.api, 300, 0);
			add("database", api, text.database, 600, 0);
			break;
		}
		case "cache-database": {
			const api = add("service", "client", text.api, 300, 0);
			const cache = add("cache", api, text.cache, 600, 0);
			add("database", cache, text.database, 900, 0);
			break;
		}
		case "worker-queue": {
			const api = add("service", "client", text.api, 300, 0);
			const queue = add("queue", api, text.queue, 600, 0);
			add("database", queue, text.database, 900, 0);
			break;
		}
		case "microservices": {
			const lb = add("load-balancer", "client", text.balancer, 280, 0);
			const api1 = add("service", lb, text.server("A"), 560, -90);
			const api2 = add("service", lb, text.server("B"), 560, 90);
			const auth = add("service", api1, text.auth, 840, -180);
			e = addLink(e, api2, auth).experiment;
			const db = add("database", api1, text.database, 840, 0);
			e = addLink(e, api2, db).experiment;
			place(auth, 840, -180);
			place(db, 840, 20);
			break;
		}
		case "pooled-database": {
			const api = add("service", "client", text.api, 300, 0);
			const pooler = add("pooler", api, text.pooler, 600, 0);
			add("database", pooler, text.database, 900, 0);
			break;
		}
		case "db-cluster": {
			const api = add("service", "client", text.api, 300, 0);
			const cluster = add("db-cluster", api, text.cluster, 600, 0);
			add("database", cluster, text.primary, 900, -170);
			add("database", cluster, text.replica(1), 900, 0);
			add("database", cluster, text.replica(2), 900, 170);
			break;
		}
		case "cdn-origin": {
			const cdn = add("cache", "client", text.cdn, 280, 0, "cdn");
			const lb = add("load-balancer", cdn, text.balancer, 560, 0);
			const a = add("service", lb, text.webServer("A"), 840, -90, "web-server");
			const b = add("service", lb, text.webServer("B"), 840, 90, "web-server");
			const db = add("database", a, text.database, 1120, 0);
			e = addLink(e, b, db).experiment;
			break;
		}
		case "api-gateway": {
			const gateway = add(
				"rate-limiter",
				"client",
				text.gateway,
				280,
				0,
				"api-gateway",
			);
			const lb = add("load-balancer", gateway, text.balancer, 560, 0);
			add("service", lb, text.server("A"), 840, -80);
			add("service", lb, text.server("B"), 840, 80);
			break;
		}
	}
	return e;
}

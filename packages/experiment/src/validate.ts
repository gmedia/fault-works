import { compilePhases, effectiveHorizonMs } from "./compile.ts";
import { decodeMessage, type Message } from "./messages.ts";
import { migrate } from "./migrate.ts";
import {
	type Experiment,
	experimentSchema,
	isWorker,
	LIMITS,
	LINK_FAULT_KINDS,
} from "./schema.ts";

export interface ValidationIssue {
	/** Dotted path with array indexes, e.g. `model.nodes[2].config.capacity`. Empty for the root. */
	path: string;
	message: Message;
}

export type ParseResult =
	| { ok: true; experiment: Experiment; migratedFrom: string | null }
	| { ok: false; issues: ValidationIssue[] };

export function formatPath(path: ReadonlyArray<PropertyKey>): string {
	let out = "";
	for (const part of path) {
		if (typeof part === "number") out += `[${part}]`;
		else out += out === "" ? String(part) : `.${String(part)}`;
	}
	return out;
}

const issue = (
	path: string,
	key: string,
	params?: Message["params"],
): ValidationIssue => ({
	path,
	message: params ? { key, params } : { key },
});

/** Parses and validates JSON text from an untrusted source (file import, paste). */
export function parseExperimentJson(text: string): ParseResult {
	const bytes = new TextEncoder().encode(text).length;
	if (bytes > LIMITS.maxImportBytes)
		return {
			ok: false,
			issues: [
				issue("", "import.tooLarge", {
					kb: Math.ceil(bytes / 1024),
					limitKb: LIMITS.maxImportBytes / 1024,
				}),
			],
		};
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return {
			ok: false,
			issues: [
				issue("", "import.invalidJson", {
					detail: error instanceof Error ? error.message : "parse error",
				}),
			],
		};
	}
	return parseExperiment(value);
}

/** Migrates, validates the schema and then checks topology and budget rules. */
export function parseExperiment(value: unknown): ParseResult {
	const migrated = migrate(value);
	if (!migrated.ok)
		return { ok: false, issues: [issue("", migrated.key, migrated.params)] };

	const parsed = experimentSchema.safeParse(migrated.value);
	if (!parsed.success)
		return {
			ok: false,
			issues: parsed.error.issues.map((i) => ({
				path: formatPath(i.path),
				message: decodeMessage(i.message),
			})),
		};

	const issues = checkExperiment(parsed.data);
	if (issues.length > 0) return { ok: false, issues };
	return { ok: true, experiment: parsed.data, migratedFrom: migrated.from };
}

/**
 * Rules that a schema cannot express: the graph shape, references between fields, and the run
 * budget. Also used by the editor to show hints next to the fields they concern.
 */
export function checkExperiment(experiment: Experiment): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const { nodes, links } = experiment.model;
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const labelOf = (id: string) => byId.get(id)?.label ?? id;

	const seen = new Set<string>();
	nodes.forEach((node, i) => {
		if (seen.has(node.id))
			issues.push(
				issue(`model.nodes[${i}].id`, "graph.duplicateNodeId", { id: node.id }),
			);
		seen.add(node.id);
	});

	const clients = nodes.filter((n) => n.kind === "client");
	if (clients.length !== 1)
		issues.push(
			issue("model.nodes", "graph.oneClient", { count: clients.length }),
		);
	const client = clients[0];

	const outgoing = new Map<string, string[]>();
	const incoming = new Map<string, string[]>();
	const linkKeys = new Set<string>();
	const linkIds = new Set<string>();
	links.forEach((link, i) => {
		const path = `model.links[${i}]`;
		if (linkIds.has(link.id))
			issues.push(
				issue(`${path}.id`, "graph.duplicateLinkId", { id: link.id }),
			);
		linkIds.add(link.id);
		const source = byId.get(link.source);
		const target = byId.get(link.target);
		if (!source || !target) {
			issues.push(
				issue(path, "graph.danglingLink", {
					source: link.source,
					target: link.target,
				}),
			);
			return;
		}
		if (link.source === link.target)
			issues.push(
				issue(path, "graph.selfLink", { node: labelOf(link.source) }),
			);
		const key = `${link.source}->${link.target}`;
		if (linkKeys.has(key))
			issues.push(
				issue(path, "graph.duplicateLink", {
					source: labelOf(link.source),
					target: labelOf(link.target),
				}),
			);
		linkKeys.add(key);
		if (target.kind === "client")
			issues.push(
				issue(path, "graph.intoClient", { source: labelOf(link.source) }),
			);
		if (source.kind === "load-balancer" && target.kind === "load-balancer")
			issues.push(
				issue(path, "graph.balancerToBalancer", {
					source: labelOf(link.source),
					target: labelOf(link.target),
				}),
			);
		outgoing.set(link.source, [
			...(outgoing.get(link.source) ?? []),
			link.target,
		]);
		incoming.set(link.target, [
			...(incoming.get(link.target) ?? []),
			link.source,
		]);
	});

	if (client) {
		const out = outgoing.get(client.id) ?? [];
		if (out.length !== 1)
			issues.push(
				issue("model.links", "graph.clientOneLink", { count: out.length }),
			);
	}
	for (const node of nodes) {
		const out = outgoing.get(node.id) ?? [];
		if (node.kind === "load-balancer" && out.length === 0)
			issues.push(
				issue("model.links", "graph.balancerNeedsBackend", {
					node: labelOf(node.id),
				}),
			);
		if (node.kind === "cache" && out.length > 1)
			issues.push(
				issue("model.links", "graph.cacheOneDownstream", {
					node: labelOf(node.id),
				}),
			);
		if (node.kind !== "client" && (incoming.get(node.id) ?? []).length === 0)
			issues.push(
				issue("model.links", "graph.unreachable", { node: labelOf(node.id) }),
			);
	}

	// Cycles: a request must never be able to call itself.
	const state = new Map<string, "visiting" | "done">();
	let cycle: string | null = null;
	const visit = (id: string, trail: string[]) => {
		if (cycle) return;
		const s = state.get(id);
		if (s === "done") return;
		if (s === "visiting") {
			cycle = [...trail.slice(trail.indexOf(id)), id].map(labelOf).join(" → ");
			return;
		}
		state.set(id, "visiting");
		for (const next of outgoing.get(id) ?? []) visit(next, [...trail, id]);
		state.set(id, "done");
	};
	for (const node of nodes) visit(node.id, []);
	if (cycle) issues.push(issue("model.links", "graph.cycle", { cycle }));

	// Faults
	const faultIds = new Set<string>();
	const crashWindows = new Map<
		string,
		Array<{ from: number; to: number; i: number }>
	>();
	experiment.faults.forEach((fault, i) => {
		const path = `faults[${i}]`;
		if (faultIds.has(fault.id))
			issues.push(issue(`${path}.id`, "fault.duplicateId", { id: fault.id }));
		faultIds.add(fault.id);
		if (LINK_FAULT_KINDS.includes(fault.kind)) {
			if (!linkIds.has(fault.target))
				issues.push(
					issue(`${path}.target`, "fault.targetNotLink", {
						id: fault.id,
						target: fault.target,
					}),
				);
		} else {
			const node = byId.get(fault.target);
			if (!node || !isWorker(node))
				issues.push(
					issue(`${path}.target`, "fault.targetNotWorker", {
						id: fault.id,
						target: fault.target,
					}),
				);
			else if (fault.kind === "cache-flush" && node.kind !== "cache")
				issues.push(
					issue(`${path}.target`, "fault.flushNeedsCache", {
						id: fault.id,
						target: labelOf(fault.target),
					}),
				);
			else if (
				fault.kind === "capacity" &&
				fault.capacity > node.config.capacity
			)
				issues.push(
					issue(`${path}.capacity`, "fault.capacityAboveNode", {
						capacity: fault.capacity,
						node: labelOf(fault.target),
						nodeCapacity: node.config.capacity,
					}),
				);
		}
		const end =
			fault.kind === "node-failure" ? fault.recoverAtMs : fault.untilMs;
		if (end !== null && end <= fault.atMs)
			issues.push(
				issue(
					`${path}.${fault.kind === "node-failure" ? "recoverAtMs" : "untilMs"}`,
					"fault.endBeforeStart",
					{ end, start: fault.atMs },
				),
			);
		if (fault.kind === "node-failure") {
			const list = crashWindows.get(fault.target) ?? [];
			list.push({
				from: fault.atMs,
				to: fault.recoverAtMs ?? Number.POSITIVE_INFINITY,
				i,
			});
			crashWindows.set(fault.target, list);
		}
	});
	for (const [target, list] of crashWindows) {
		const sorted = [...list].sort((a, b) => a.from - b.from);
		for (let k = 1; k < sorted.length; k++) {
			const prev = sorted[k - 1];
			const cur = sorted[k];
			if (prev && cur && cur.from < prev.to)
				issues.push(
					issue(`faults[${cur.i}].atMs`, "fault.overlappingCrash", {
						node: labelOf(target),
					}),
				);
		}
	}

	const horizonMs = effectiveHorizonMs(experiment);
	if (horizonMs > LIMITS.maxHorizonMs)
		issues.push(
			issue("run.horizonMs", "budget.horizon", {
				minutes: Math.round((horizonMs / 60_000) * 10) / 10,
				limitMinutes: LIMITS.maxHorizonMs / 60_000,
			}),
		);

	const offered = estimateOfferedRequests(experiment);
	if (offered > LIMITS.maxOfferedRequests)
		issues.push(
			issue("workload.offeredRps", "budget.requests", {
				requests: Math.round(offered),
				limit: LIMITS.maxOfferedRequests,
			}),
		);

	return issues;
}

/** Expected number of offered requests (exact for constant arrivals, the mean for poisson). */
export function estimateOfferedRequests(experiment: Experiment): number {
	return compilePhases(experiment.workload).reduce(
		(sum, p) => sum + ((p.endUs - p.startUs) / 1_000_000) * p.rps,
		0,
	);
}

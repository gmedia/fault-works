import { compilePhases, effectiveHorizonMs } from "./compile.ts";
import { migrate } from "./migrate.ts";
import {
	type Experiment,
	experimentSchema,
	LIMITS,
	type ServerNode,
} from "./schema.ts";

export interface ValidationIssue {
	/** Dotted path with array indexes, e.g. `model.nodes[2].config.capacity`. Empty for the root. */
	path: string;
	message: string;
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

/** Parses and validates JSON text from an untrusted source (file import, paste). */
export function parseExperimentJson(text: string): ParseResult {
	const bytes = new TextEncoder().encode(text).length;
	if (bytes > LIMITS.maxImportBytes)
		return {
			ok: false,
			issues: [
				{
					path: "",
					message: `The file is ${Math.ceil(bytes / 1024)} KB; experiments are limited to ${LIMITS.maxImportBytes / 1024} KB.`,
				},
			],
		};
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return {
			ok: false,
			issues: [
				{
					path: "",
					message: `This is not valid JSON (${error instanceof Error ? error.message : "parse error"}).`,
				},
			],
		};
	}
	return parseExperiment(value);
}

/** Migrates, validates the schema and then checks topology and budget rules. */
export function parseExperiment(value: unknown): ParseResult {
	const migrated = migrate(value);
	if (!migrated.ok)
		return { ok: false, issues: [{ path: "", message: migrated.message }] };

	const parsed = experimentSchema.safeParse(migrated.value);
	if (!parsed.success) {
		return {
			ok: false,
			issues: parsed.error.issues.map((issue) => ({
				path: formatPath(issue.path),
				message: issue.message,
			})),
		};
	}

	const issues = checkExperiment(parsed.data);
	if (issues.length > 0) return { ok: false, issues };
	return { ok: true, experiment: parsed.data, migratedFrom: migrated.from };
}

/**
 * Rules that a schema cannot express: the v0.1 topology, references between fields, and the run
 * budget. Also used by the editor to show hints next to the fields they concern.
 */
export function checkExperiment(experiment: Experiment): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const { nodes, links } = experiment.model;

	const seen = new Set<string>();
	nodes.forEach((node, i) => {
		if (seen.has(node.id))
			issues.push({
				path: `model.nodes[${i}].id`,
				message: `Two components use the id "${node.id}". Ids must be unique.`,
			});
		seen.add(node.id);
	});

	const clients = nodes.filter((n) => n.kind === "client");
	const balancers = nodes.filter((n) => n.kind === "load-balancer");
	const servers = nodes.filter((n): n is ServerNode => n.kind === "server");

	if (clients.length !== 1)
		issues.push({
			path: "model.nodes",
			message: `v0.1 needs exactly one client; this experiment has ${clients.length}.`,
		});
	if (balancers.length !== 1)
		issues.push({
			path: "model.nodes",
			message: `v0.1 needs exactly one load balancer; this experiment has ${balancers.length}.`,
		});
	if (servers.length < 1 || servers.length > LIMITS.maxServers)
		issues.push({
			path: "model.nodes",
			message: `Add between 1 and ${LIMITS.maxServers} servers; this experiment has ${servers.length}.`,
		});

	const client = clients[0];
	const lb = balancers[0];
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const linkKeys = new Set<string>();

	links.forEach((link, i) => {
		const key = `${link.source}->${link.target}`;
		const path = `model.links[${i}]`;
		const source = byId.get(link.source);
		const target = byId.get(link.target);
		if (!source || !target) {
			issues.push({
				path,
				message: `The link ${link.source} → ${link.target} points to a component that does not exist.`,
			});
			return;
		}
		if (linkKeys.has(key))
			issues.push({ path, message: `The link ${key} is listed twice.` });
		linkKeys.add(key);
		const supported =
			(source.kind === "client" && target.kind === "load-balancer") ||
			(source.kind === "load-balancer" && target.kind === "server");
		if (!supported)
			issues.push({
				path,
				message: `The link ${link.source} → ${link.target} is not supported. In v0.1 traffic flows client → load balancer → servers.`,
			});
	});

	if (client && lb && !linkKeys.has(`${client.id}->${lb.id}`))
		issues.push({
			path: "model.links",
			message: `Connect the client (${client.id}) to the load balancer (${lb.id}).`,
		});
	if (lb)
		for (const server of servers)
			if (!linkKeys.has(`${lb.id}->${server.id}`))
				issues.push({
					path: "model.links",
					message: `Server "${server.label ?? server.id}" is not connected to the load balancer, so it would never receive traffic.`,
				});

	const serverIds = new Set(servers.map((s) => s.id));
	const faultIds = new Set<string>();
	const windows = new Map<
		string,
		Array<{ from: number; to: number; i: number }>
	>();
	experiment.faults.forEach((fault, i) => {
		const path = `faults[${i}]`;
		if (faultIds.has(fault.id))
			issues.push({
				path: `${path}.id`,
				message: `Two faults use the id "${fault.id}".`,
			});
		faultIds.add(fault.id);
		if (!serverIds.has(fault.target))
			issues.push({
				path: `${path}.target`,
				message: `Fault "${fault.id}" targets "${fault.target}", which is not a server. Only servers can fail in v0.1.`,
			});
		if (fault.recoverAtMs !== null && fault.recoverAtMs <= fault.atMs)
			issues.push({
				path: `${path}.recoverAtMs`,
				message: `Recovery (${fault.recoverAtMs} ms) must come after the failure (${fault.atMs} ms).`,
			});
		const list = windows.get(fault.target) ?? [];
		list.push({
			from: fault.atMs,
			to: fault.recoverAtMs ?? Number.POSITIVE_INFINITY,
			i,
		});
		windows.set(fault.target, list);
	});
	for (const [target, list] of windows) {
		const sorted = [...list].sort((a, b) => a.from - b.from);
		for (let k = 1; k < sorted.length; k++) {
			const prev = sorted[k - 1];
			const cur = sorted[k];
			if (prev && cur && cur.from < prev.to)
				issues.push({
					path: `faults[${cur.i}].atMs`,
					message: `Two failures of "${target}" overlap. Let the first one recover before the next starts.`,
				});
		}
	}

	const horizonMs = effectiveHorizonMs(experiment);
	if (horizonMs > LIMITS.maxHorizonMs)
		issues.push({
			path: "run.horizonMs",
			message: `The run would cover ${formatMinutes(horizonMs)}; the limit is ${formatMinutes(LIMITS.maxHorizonMs)}. Shorten the traffic or set a smaller horizon.`,
		});

	const offered = estimateOfferedRequests(experiment);
	if (offered > LIMITS.maxOfferedRequests)
		issues.push({
			path: "workload.offeredRps",
			message: `This would offer about ${Math.round(offered).toLocaleString("en-US")} requests; the limit is ${LIMITS.maxOfferedRequests.toLocaleString("en-US")}. Lower the rate or shorten the duration.`,
		});

	return issues;
}

/** Expected number of offered requests (exact for constant arrivals, the mean for poisson). */
export function estimateOfferedRequests(experiment: Experiment): number {
	return compilePhases(experiment.workload).reduce(
		(sum, p) => sum + ((p.endUs - p.startUs) / 1_000_000) * p.rps,
		0,
	);
}

function formatMinutes(ms: number): string {
	const minutes = ms / 60_000;
	return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
}

import {
	type Experiment,
	type Fault,
	LIMITS,
	type ServerNode,
} from "./schema.ts";

/** Pure editing helpers. Each returns a new experiment and leaves the input untouched. */

export function uniqueId(base: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	const clean =
		base
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "experiment";
	if (!used.has(clean)) return clean;
	for (let n = 2; ; n++) {
		const candidate = `${clean}-${n}`;
		if (!used.has(candidate)) return candidate;
	}
}

const letter = (n: number) => String.fromCharCode(65 + n);

export function servers(experiment: Experiment): ServerNode[] {
	return experiment.model.nodes.filter(
		(n): n is ServerNode => n.kind === "server",
	);
}

export function canAddServer(experiment: Experiment): boolean {
	return (
		servers(experiment).length < LIMITS.maxServers &&
		experiment.model.nodes.length < LIMITS.maxNodes
	);
}

/** Adds a server that copies the last server's settings and is wired to the load balancer. */
export function addServer(experiment: Experiment): {
	experiment: Experiment;
	id: string;
} {
	const existing = servers(experiment);
	const ids = experiment.model.nodes.map((n) => n.id);
	let index = existing.length;
	while (ids.includes(`server-${letter(index).toLowerCase()}`) && index < 26)
		index++;
	const id = uniqueId(`server-${letter(index).toLowerCase()}`, ids);
	const template = existing[existing.length - 1];
	const node: ServerNode = {
		id,
		kind: "server",
		label: `Server ${letter(index)}`,
		config: template
			? { ...template.config }
			: {
					capacity: 10,
					queueCapacity: 50,
					serviceTimeMs: 100,
					serviceTimeDistribution: "fixed",
				},
	};
	const lb = experiment.model.nodes.find((n) => n.kind === "load-balancer");
	const lastPos = template ? experiment.layout?.[template.id] : undefined;
	return {
		id,
		experiment: {
			...experiment,
			model: {
				nodes: [...experiment.model.nodes, node],
				links: lb
					? [...experiment.model.links, { source: lb.id, target: id }]
					: experiment.model.links,
			},
			layout: {
				...experiment.layout,
				[id]: lastPos ? { x: lastPos.x, y: lastPos.y + 150 } : { x: 620, y: 0 },
			},
		},
	};
}

/** Removes a server, its links, its layout entry and every fault that targets it. */
export function removeServer(
	experiment: Experiment,
	id: string,
): { experiment: Experiment; removedFaults: number } {
	const faults = experiment.faults.filter((f) => f.target !== id);
	const layout = { ...experiment.layout };
	delete layout[id];
	return {
		removedFaults: experiment.faults.length - faults.length,
		experiment: {
			...experiment,
			model: {
				nodes: experiment.model.nodes.filter((n) => n.id !== id),
				links: experiment.model.links.filter(
					(l) => l.source !== id && l.target !== id,
				),
			},
			faults,
			layout,
		},
	};
}

export function addFault(experiment: Experiment): {
	experiment: Experiment;
	id: string;
} {
	const target = servers(experiment).at(-1);
	const id = uniqueId(
		`${target?.id ?? "server"}-crash`,
		experiment.faults.map((f) => f.id),
	);
	const { startMs, durationMs } = experiment.workload;
	const fault: Fault = {
		id,
		kind: "node-failure",
		target: target?.id ?? "",
		atMs: Math.round(startMs + durationMs / 3),
		recoverAtMs: Math.round(startMs + (durationMs * 2) / 3),
		behavior: "refuse",
	};
	return {
		id,
		experiment: { ...experiment, faults: [...experiment.faults, fault] },
	};
}

/** Copies an experiment under a fresh id so it can be changed and compared with the original. */
export function cloneExperiment(
	experiment: Experiment,
	takenIds: Iterable<string>,
): Experiment {
	const copy = structuredClone(experiment);
	copy.experimentId = uniqueId(`${experiment.experimentId}-variant`, takenIds);
	copy.title = `${experiment.title} (variant)`.slice(0, 120);
	return copy;
}

/** A random 32-bit seed, for "try another seed". Not used by the engine itself. */
export function randomSeed(): number {
	const buf = new Uint32Array(1);
	globalThis.crypto.getRandomValues(buf);
	return buf[0] as number;
}

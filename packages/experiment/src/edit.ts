import {
	type Experiment,
	type ExperimentNode,
	type Fault,
	type FaultKind,
	isWorker,
	LIMITS,
	LINK_FAULT_KINDS,
	type Link,
	type NodeKind,
	type WorkerNode,
} from "./schema.ts";

/** Pure editing helpers. Each returns a new experiment and leaves the input untouched. */

export function uniqueId(base: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	const clean =
		base
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "item";
	if (!used.has(clean)) return clean;
	for (let n = 2; ; n++) {
		const candidate = `${clean}-${n}`;
		if (!used.has(candidate)) return candidate;
	}
}

export function workers(experiment: Experiment): WorkerNode[] {
	return experiment.model.nodes.filter(isWorker);
}

/** Workers in engine order, which is also the order they are listed and colored. */
export function workerIndex(experiment: Experiment, id: string): number {
	return workers(experiment).findIndex((n) => n.id === id);
}

export function canAddNode(experiment: Experiment): boolean {
	return experiment.model.nodes.length < LIMITS.maxNodes;
}

export const DEFAULT_WORKER = {
	service: {
		capacity: 10,
		queueCapacity: 50,
		serviceTimeMs: 100,
		serviceTimeDistribution: "fixed" as const,
	},
	database: {
		capacity: 20,
		queueCapacity: 100,
		serviceTimeMs: 20,
		serviceTimeDistribution: "exponential" as const,
	},
	cache: {
		capacity: 200,
		queueCapacity: 0,
		serviceTimeMs: 2,
		serviceTimeDistribution: "fixed" as const,
		hitRatio: 0.8,
	},
	queue: {
		capacity: 4,
		queueCapacity: 1000,
		serviceTimeMs: 50,
		serviceTimeDistribution: "exponential" as const,
	},
};

export const DEFAULT_HEALTH_CHECK = {
	enabled: true,
	intervalMs: 5000,
	probeTimeoutMs: 1000,
	unhealthyThreshold: 2,
	healthyThreshold: 2,
};

export function makeNode(
	kind: NodeKind,
	id: string,
	label?: string,
): ExperimentNode {
	const withLabel = label ? { label } : {};
	switch (kind) {
		case "client":
			return { id, kind, ...withLabel };
		case "load-balancer":
			return {
				id,
				kind,
				...withLabel,
				config: {
					algorithm: "round-robin",
					retries: 0,
					healthCheck: { ...DEFAULT_HEALTH_CHECK },
				},
			};
		case "cache":
			return { id, kind, ...withLabel, config: { ...DEFAULT_WORKER.cache } };
		case "queue":
			return { id, kind, ...withLabel, config: { ...DEFAULT_WORKER.queue } };
		default:
			return { id, kind, ...withLabel, config: { ...DEFAULT_WORKER[kind] } };
	}
}

export const DEFAULT_LINK = {
	latencyMs: 0,
	timeoutMs: null,
	retries: 0,
	circuitBreaker: { enabled: false, failureThreshold: 5, openMs: 10_000 },
};

export function makeLink(
	source: string,
	target: string,
	taken: Iterable<string>,
): Link {
	return {
		id: uniqueId(`${source}-${target}`, taken),
		source,
		target,
		...structuredClone(DEFAULT_LINK),
	};
}

/**
 * Adds a node. When `from` is given it is linked from that node; a new node placed after a
 * load balancer copies its siblings' settings so backends stay comparable.
 */
export function addNode(
	experiment: Experiment,
	kind: NodeKind,
	options: {
		from?: string;
		label?: string;
		position?: { x: number; y: number };
	} = {},
): { experiment: Experiment; id: string } {
	const ids = experiment.model.nodes.map((n) => n.id);
	const sameKind = experiment.model.nodes.filter((n) => n.kind === kind);
	const id = uniqueId(`${kind}-${sameKind.length + 1}`, ids);
	let node = makeNode(kind, id, options.label);
	const siblings = options.from
		? experiment.model.links
				.filter((l) => l.source === options.from)
				.map((l) => experiment.model.nodes.find((n) => n.id === l.target))
		: [];
	const template = siblings.find((s) => s?.kind === kind);
	if (template && isWorker(template) && isWorker(node))
		node = {
			...node,
			config: structuredClone(template.config),
		} as ExperimentNode;

	const links = options.from
		? [
				...experiment.model.links,
				makeLink(
					options.from,
					id,
					experiment.model.links.map((l) => l.id),
				),
			]
		: experiment.model.links;
	const fromPos = options.from ? experiment.layout?.[options.from] : undefined;
	const templatePos = template ? experiment.layout?.[template.id] : undefined;
	const position =
		options.position ??
		(templatePos
			? { x: templatePos.x, y: templatePos.y + 150 }
			: fromPos
				? { x: fromPos.x + 300, y: fromPos.y }
				: { x: 300 * experiment.model.nodes.length, y: 0 });
	return {
		id,
		experiment: {
			...experiment,
			model: { nodes: [...experiment.model.nodes, node], links },
			layout: { ...experiment.layout, [id]: position },
		},
	};
}

/** Removes a node, its links, its layout entry and every fault that targets it or its links. */
export function removeNode(
	experiment: Experiment,
	id: string,
): { experiment: Experiment; removedFaults: number } {
	const goneLinks = new Set(
		experiment.model.links
			.filter((l) => l.source === id || l.target === id)
			.map((l) => l.id),
	);
	const faults = experiment.faults.filter(
		(f) => f.target !== id && !goneLinks.has(f.target),
	);
	const layout = { ...experiment.layout };
	delete layout[id];
	return {
		removedFaults: experiment.faults.length - faults.length,
		experiment: {
			...experiment,
			model: {
				nodes: experiment.model.nodes.filter((n) => n.id !== id),
				links: experiment.model.links.filter((l) => !goneLinks.has(l.id)),
			},
			faults,
			layout,
		},
	};
}

export function addLink(
	experiment: Experiment,
	source: string,
	target: string,
): { experiment: Experiment; id: string | null } {
	if (
		source === target ||
		experiment.model.links.some(
			(l) => l.source === source && l.target === target,
		)
	)
		return { experiment, id: null };
	const link = makeLink(
		source,
		target,
		experiment.model.links.map((l) => l.id),
	);
	return {
		id: link.id,
		experiment: {
			...experiment,
			model: { ...experiment.model, links: [...experiment.model.links, link] },
		},
	};
}

export function removeLink(experiment: Experiment, id: string): Experiment {
	return {
		...experiment,
		model: {
			...experiment.model,
			links: experiment.model.links.filter((l) => l.id !== id),
		},
		faults: experiment.faults.filter((f) => f.target !== id),
	};
}

export function updateLink(
	experiment: Experiment,
	id: string,
	patch: Partial<Link>,
): Experiment {
	return {
		...experiment,
		model: {
			...experiment.model,
			links: experiment.model.links.map((l) =>
				l.id === id ? { ...l, ...patch } : l,
			),
		},
	};
}

/** A fault of the given kind on a target, with a window in the middle third of the traffic. */
export function makeFault(
	experiment: Experiment,
	kind: FaultKind,
	target: string,
): Fault {
	const { startMs, durationMs } = experiment.workload;
	const atMs = Math.round(startMs + durationMs / 3);
	const untilMs = Math.round(startMs + (durationMs * 2) / 3);
	const id = uniqueId(
		`${target}-${kind}`,
		experiment.faults.map((f) => f.id),
	);
	switch (kind) {
		case "node-failure":
			return {
				id,
				kind,
				target,
				atMs,
				recoverAtMs: untilMs,
				behavior: "refuse",
			};
		case "slowdown":
			return { id, kind, target, atMs, untilMs, factor: 3, addMs: 0 };
		case "error-rate":
			return { id, kind, target, atMs, untilMs, rate: 0.2 };
		case "capacity": {
			const node = experiment.model.nodes.find((n) => n.id === target);
			const base = node && isWorker(node) ? node.config.capacity : 10;
			return {
				id,
				kind,
				target,
				atMs,
				untilMs,
				capacity: Math.max(0, Math.floor(base / 2)),
			};
		}
		case "link-latency":
			return { id, kind, target, atMs, untilMs, addMs: 200 };
		case "link-loss":
			return { id, kind, target, atMs, untilMs, rate: 0.1 };
		default:
			return { id, kind, target, atMs, untilMs };
	}
}

export function faultTargets(
	experiment: Experiment,
	kind: FaultKind,
): string[] {
	if (LINK_FAULT_KINDS.includes(kind))
		return experiment.model.links.map((l) => l.id);
	if (kind === "cache-flush")
		return experiment.model.nodes
			.filter((n) => n.kind === "cache")
			.map((n) => n.id);
	return workers(experiment).map((n) => n.id);
}

export function addFault(
	experiment: Experiment,
	kind: FaultKind = "node-failure",
	target?: string,
): { experiment: Experiment; id: string } | null {
	const candidates = faultTargets(experiment, kind);
	const chosen =
		target && candidates.includes(target) ? target : candidates.at(-1);
	if (!chosen) return null;
	const fault = makeFault(experiment, kind, chosen);
	return {
		id: fault.id,
		experiment: { ...experiment, faults: [...experiment.faults, fault] },
	};
}

/** Copies an experiment under a fresh id so it can be changed and compared with the original. */
export function cloneExperiment(
	experiment: Experiment,
	takenIds: Iterable<string>,
	variantLabel = "variant",
	descriptionPrompt?: string,
): Experiment {
	const copy = structuredClone(experiment);
	copy.experimentId = uniqueId(
		`${experiment.experimentId}-${variantLabel}`,
		takenIds,
	);
	copy.title = `${experiment.title} (${variantLabel})`.slice(0, 120);
	// The original's description and hypotheses describe the original. Carrying them over would
	// put stale claims into the variant's exports, so the variant starts with a prompt instead.
	copy.description = (descriptionPrompt ?? "").slice(0, 2000);
	copy.expectedObservations = [];
	return copy;
}

/** A random 32-bit seed, for "try another seed". Not used by the engine itself. */
export function randomSeed(): number {
	const buf = new Uint32Array(1);
	globalThis.crypto.getRandomValues(buf);
	return buf[0] as number;
}

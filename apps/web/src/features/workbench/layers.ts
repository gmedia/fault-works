import {
	type Experiment,
	type ExperimentNode,
	isWorker,
} from "@faultworks/experiment";

/**
 * Groups nodes by their distance from the client (longest path, so a node called from two depths
 * sits after both callers). Nodes not reachable from the client come last.
 */
export function layerNodes(experiment: Experiment): ExperimentNode[][] {
	const { nodes, links } = experiment.model;
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const depth = new Map<string, number>();
	const client = nodes.find((n) => n.kind === "client");
	const outgoing = new Map<string, string[]>();
	for (const l of links)
		outgoing.set(l.source, [...(outgoing.get(l.source) ?? []), l.target]);

	if (client) {
		const visit = (id: string, d: number, trail: Set<string>) => {
			if (trail.has(id) || d > nodes.length) return;
			if ((depth.get(id) ?? -1) >= d) return;
			depth.set(id, d);
			for (const next of outgoing.get(id) ?? [])
				visit(next, d + 1, new Set([...trail, id]));
		};
		visit(client.id, 0, new Set());
	}
	const maxDepth = Math.max(0, ...depth.values());
	const layers: ExperimentNode[][] = Array.from(
		{ length: maxDepth + 1 },
		() => [],
	);
	for (const n of nodes) {
		const d = depth.get(n.id);
		if (d !== undefined) (layers[d] as ExperimentNode[]).push(n);
	}
	const orphans = nodes.filter((n) => !depth.has(n.id));
	if (orphans.length) layers.push(orphans);
	return layers
		.filter((l) => l.length > 0)
		.map((l) => l.map((n) => byId.get(n.id) as ExperimentNode));
}

/** Nodes in the order the UI lists and colors them (layer by layer). */
export function orderedWorkers(experiment: Experiment): ExperimentNode[] {
	// Only components with slots of their own get a color; routers and the client do not.
	return layerNodes(experiment).flat().filter(isWorker);
}

/** A sensible place to hang a new component when nothing is selected: the last leaf of the graph. */
export function lastLeaf(experiment: Experiment): string | undefined {
	const sources = new Set(experiment.model.links.map((l) => l.source));
	const layers = layerNodes(experiment).flat();
	return (
		[...layers].reverse().find((n) => !sources.has(n.id) && n.kind !== "cache")
			?.id ?? layers.at(-1)?.id
	);
}

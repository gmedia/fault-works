import type { RunResult } from "#/workers/protocol.ts";

export type NodeStatus =
	| "up"
	| "down-routed"
	| "down-removed"
	| "recovering"
	| "degraded";

export interface NodeSnapshot {
	status: NodeStatus;
	busy: number;
	queue: number;
	/** Calls delivered to the node during the window, per second. */
	callsRps: number;
	failedRps: number;
	/** Non-crash faults active on the node at this time. */
	activeFaults: number[];
}

export interface LinkSnapshot {
	callsRps: number;
	breaker: "open" | "half-open" | "closed";
	/** Link faults active at this time. */
	activeFaults: number[];
}

export interface Snapshot {
	window: number;
	windowStartMs: number;
	offeredRps: number;
	succeededRps: number;
	failedRps: number;
	inFlight: number;
	nodes: NodeSnapshot[];
	links: LinkSnapshot[];
}

/**
 * State of the system at simulated time `tMs`. Up/down, health, breakers and faults come from
 * exact transition times; load figures (busy, queue, rates) come from the window containing `tMs`.
 */
export function snapshotAt(result: RunResult, tMs: number): Snapshot {
	const { series, transitions } = result.metrics;
	const count = series.startMs.length;
	const window = Math.max(
		0,
		Math.min(count - 1, Math.floor(tMs / series.windowMs)),
	);
	const perSecond = 1000 / series.windowMs;
	const nodeCount = result.topology.nodeIds.length;
	const linkCount = result.topology.linkIds.length;

	const up = new Array<boolean>(nodeCount).fill(true);
	const healthy = new Array<boolean>(nodeCount).fill(true);
	const watched = new Set<number>();
	result.experiment.model.links.forEach((l, i) => {
		const src = result.experiment.model.nodes.find((n) => n.id === l.source);
		if (src?.kind === "load-balancer" && src.config.healthCheck.enabled)
			watched.add(result.topology.nodeIds.indexOf(l.target));
		void i;
	});
	const breakers = new Array<LinkSnapshot["breaker"]>(linkCount).fill("closed");
	const nodeFaults: number[][] = Array.from({ length: nodeCount }, () => []);
	const linkFaults: number[][] = Array.from({ length: linkCount }, () => []);
	const faultTarget = (fault: number) => {
		const f = result.experiment.faults[fault];
		if (!f) return null;
		if (f.kind === "link-latency" || f.kind === "link-loss")
			return { edge: result.topology.linkIds.indexOf(f.target) };
		return { node: result.topology.nodeIds.indexOf(f.target) };
	};
	for (const tr of transitions) {
		if (tr.tMs > tMs) break;
		if (tr.kind === "down") up[tr.node] = false;
		else if (tr.kind === "up") up[tr.node] = true;
		else if (tr.kind === "unhealthy") healthy[tr.node] = false;
		else if (tr.kind === "healthy") healthy[tr.node] = true;
		else if (tr.kind === "breaker") breakers[tr.edge] = tr.state;
		else {
			const target = faultTarget(tr.fault);
			if (!target) continue;
			const list =
				"edge" in target
					? linkFaults[target.edge as number]
					: nodeFaults[target.node as number];
			if (!list) continue;
			if (tr.kind === "fault-start") list.push(tr.fault);
			else {
				const i = list.indexOf(tr.fault);
				if (i !== -1) list.splice(i, 1);
			}
		}
	}

	const nodes = result.topology.nodeIds.map((_, i): NodeSnapshot => {
		const isUp = up[i] as boolean;
		const inRotation = watched.has(i) ? (healthy[i] as boolean) : true;
		const status: NodeStatus = isUp
			? inRotation
				? (nodeFaults[i] as number[]).length
					? "degraded"
					: "up"
				: "recovering"
			: inRotation
				? "down-routed"
				: "down-removed";
		return {
			status,
			busy: series.busy[i]?.[window] ?? 0,
			queue: series.queueDepth[i]?.[window] ?? 0,
			callsRps: (series.calls[i]?.[window] ?? 0) * perSecond,
			failedRps: (series.nodeFailed[i]?.[window] ?? 0) * perSecond,
			activeFaults: nodeFaults[i] as number[],
		};
	});
	const links = result.topology.linkIds.map(
		(_, i): LinkSnapshot => ({
			callsRps: (series.linkCalls[i]?.[window] ?? 0) * perSecond,
			breaker: breakers[i] as LinkSnapshot["breaker"],
			activeFaults: linkFaults[i] as number[],
		}),
	);

	return {
		window,
		windowStartMs: series.startMs[window] ?? 0,
		offeredRps: (series.offered[window] ?? 0) * perSecond,
		succeededRps: (series.succeeded[window] ?? 0) * perSecond,
		failedRps: (series.failed[window] ?? 0) * perSecond,
		inFlight: series.inFlight[window] ?? 0,
		nodes,
		links,
	};
}

/** Times worth stopping at: every crash, detection, recovery, fault window and breaker change. */
export function stateChangeTimes(result: RunResult): number[] {
	return [...new Set(result.metrics.transitions.map((t) => t.tMs))].sort(
		(a, b) => a - b,
	);
}

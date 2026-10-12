import type {
	EdgeInput,
	EngineInput,
	FaultInput,
	NodeInput,
	RatePhase,
	WorkerInput,
} from "@faultworks/engine";
import {
	type Experiment,
	type ExperimentNode,
	LIMITS,
	type WorkerConfig,
	type Workload,
} from "./schema.ts";

const US_PER_MS = 1000;

export interface TopologyInfo {
	/** Node ids in engine index order (the order they appear in `model.nodes`). */
	nodeIds: string[];
	nodeLabels: string[];
	nodeKinds: ExperimentNode["kind"][];
	/** Link ids in engine edge order. */
	linkIds: string[];
	client: number;
}

export interface CompiledExperiment {
	engine: EngineInput;
	topology: TopologyInfo;
	horizonMs: number;
	sampleWindowMs: number;
}

/**
 * Turns the base rate plus bursts into non-overlapping constant-rate phases. Adjacent phases with
 * the same rate are merged so a burst boundary never adds an arrival by restarting the schedule.
 */
export function compilePhases(workload: Workload): RatePhase[] {
	const baseStart = workload.startMs * US_PER_MS;
	const baseEnd = (workload.startMs + workload.durationMs) * US_PER_MS;
	const bursts = workload.bursts.map((b) => ({
		start: b.atMs * US_PER_MS,
		end: (b.atMs + b.durationMs) * US_PER_MS,
		rps: b.extraRps,
	}));

	const points = new Set<number>([baseStart, baseEnd]);
	for (const b of bursts) {
		points.add(b.start);
		points.add(b.end);
	}
	const sorted = [...points].sort((a, b) => a - b);

	const phases: RatePhase[] = [];
	for (let i = 0; i + 1 < sorted.length; i++) {
		const start = sorted[i] as number;
		const end = sorted[i + 1] as number;
		let rps = start >= baseStart && start < baseEnd ? workload.offeredRps : 0;
		for (const b of bursts) if (start >= b.start && start < b.end) rps += b.rps;
		if (rps <= 0) continue;
		const last = phases[phases.length - 1];
		if (last && last.endUs === start && last.rps === rps) last.endUs = end;
		else phases.push({ startUs: start, endUs: end, rps });
	}
	return phases;
}

/** The explicit horizon, or the end of the last traffic phase plus one client timeout. */
export function effectiveHorizonMs(experiment: Experiment): number {
	if (experiment.run.horizonMs !== undefined) return experiment.run.horizonMs;
	const phases = compilePhases(experiment.workload);
	const lastEndUs = phases.reduce((max, p) => Math.max(max, p.endUs), 0);
	return Math.ceil(lastEndUs / US_PER_MS) + experiment.workload.timeoutMs;
}

export function defaultLabel(node: ExperimentNode): string {
	return node.label ?? node.id;
}

const toUs = (ms: number) => Math.max(1, Math.round(ms * US_PER_MS));

const worker = (c: WorkerConfig): WorkerInput => ({
	capacity: c.capacity,
	queueCapacity: c.queueCapacity,
	serviceTimeUs: toUs(c.serviceTimeMs),
	distribution: c.serviceTimeDistribution,
	contention: c.contention,
	coherency: c.coherency,
	queueTimeoutUs:
		c.queueTimeoutMs === null ? null : c.queueTimeoutMs * US_PER_MS,
	parallel: c.callMode === "parallel",
});

/** Compiles an experiment that already passed `parseExperiment`/`checkExperiment`. */
export function compileExperiment(experiment: Experiment): CompiledExperiment {
	const nodes = experiment.model.nodes;
	const nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
	const linkIndex = new Map(experiment.model.links.map((l, i) => [l.id, i]));
	const client = nodes.findIndex((n) => n.kind === "client");
	if (client === -1)
		throw new Error("compileExperiment needs a validated experiment");

	const engineNodes: NodeInput[] = nodes.map((n): NodeInput => {
		switch (n.kind) {
			case "client":
				return { kind: "client", id: n.id };
			case "load-balancer": {
				const hc = n.config.healthCheck;
				return {
					kind: "load-balancer",
					id: n.id,
					algorithm: n.config.algorithm,
					retries: n.config.retries,
					healthCheck: hc.enabled
						? {
								intervalUs: hc.intervalMs * US_PER_MS,
								probeTimeoutUs: hc.probeTimeoutMs * US_PER_MS,
								unhealthyThreshold: hc.unhealthyThreshold,
								healthyThreshold: hc.healthyThreshold,
							}
						: null,
				};
			}
			case "rate-limiter":
				return {
					kind: "rate-limiter",
					id: n.id,
					ratePerSec: n.config.ratePerSec,
					burst: n.config.burst,
				};
			case "db-cluster":
				return {
					kind: "db-cluster",
					id: n.id,
					writeRatio: n.config.writeRatio,
					failoverUs: n.config.failoverMs * US_PER_MS,
				};
			case "cache":
				return {
					kind: "cache",
					id: n.id,
					...worker(n.config),
					hitRatio: n.config.hitRatio,
				};
			default:
				return { kind: n.kind, id: n.id, ...worker(n.config) };
		}
	});

	const index = (id: string, what: string) => {
		const i = nodeIndex.get(id);
		if (i === undefined)
			throw new Error(`${what} refers to unknown node ${id}`);
		return i;
	};

	const edges: EdgeInput[] = experiment.model.links.map((l) => ({
		id: l.id,
		source: index(l.source, `link ${l.id}`),
		target: index(l.target, `link ${l.id}`),
		latencyUs: Math.round(l.latencyMs * US_PER_MS),
		timeoutUs: l.timeoutMs === null ? null : l.timeoutMs * US_PER_MS,
		retries: l.retries,
		retryBackoffUs: Math.round(l.retryBackoffMs * US_PER_MS),
		retryJitter: l.retryJitter,
		retryBudget: l.retryBudget,
		circuitBreaker: l.circuitBreaker.enabled
			? {
					failureThreshold: l.circuitBreaker.failureThreshold,
					openUs: l.circuitBreaker.openMs * US_PER_MS,
				}
			: null,
	}));

	const faults: FaultInput[] = experiment.faults.map((f): FaultInput => {
		const atUs = f.atMs * US_PER_MS;
		switch (f.kind) {
			case "node-failure":
				return {
					kind: "node-failure",
					id: f.id,
					node: index(f.target, `fault ${f.id}`),
					atUs,
					recoverAtUs:
						f.recoverAtMs === null ? null : f.recoverAtMs * US_PER_MS,
					behavior: f.behavior,
				};
			case "slowdown":
				return {
					kind: "slowdown",
					id: f.id,
					node: index(f.target, `fault ${f.id}`),
					atUs,
					untilUs: f.untilMs === null ? null : f.untilMs * US_PER_MS,
					factor: f.factor,
					addUs: Math.round(f.addMs * US_PER_MS),
					ramp: f.ramp,
				};
			case "error-rate":
				return {
					kind: "error-rate",
					id: f.id,
					node: index(f.target, `fault ${f.id}`),
					atUs,
					untilUs: f.untilMs === null ? null : f.untilMs * US_PER_MS,
					rate: f.rate,
				};
			case "capacity":
				return {
					kind: "capacity",
					id: f.id,
					node: index(f.target, `fault ${f.id}`),
					atUs,
					untilUs: f.untilMs === null ? null : f.untilMs * US_PER_MS,
					capacity: f.capacity,
				};
			case "link-latency": {
				const edge = linkIndex.get(f.target);
				if (edge === undefined)
					throw new Error(`fault ${f.id} refers to unknown link ${f.target}`);
				return {
					kind: "link-latency",
					id: f.id,
					edge,
					atUs,
					untilUs: f.untilMs === null ? null : f.untilMs * US_PER_MS,
					addUs: Math.round(f.addMs * US_PER_MS),
				};
			}
			case "link-loss": {
				const edge = linkIndex.get(f.target);
				if (edge === undefined)
					throw new Error(`fault ${f.id} refers to unknown link ${f.target}`);
				return {
					kind: "link-loss",
					id: f.id,
					edge,
					atUs,
					untilUs: f.untilMs === null ? null : f.untilMs * US_PER_MS,
					rate: f.rate,
				};
			}
			default:
				return {
					kind: "cache-flush",
					id: f.id,
					node: index(f.target, `fault ${f.id}`),
					atUs,
					untilUs: f.untilMs === null ? null : f.untilMs * US_PER_MS,
				};
		}
	});

	const horizonMs = effectiveHorizonMs(experiment);
	return {
		engine: {
			seed: experiment.seed,
			horizonUs: horizonMs * US_PER_MS,
			maxEvents: LIMITS.maxEvents,
			nodes: engineNodes,
			edges,
			client,
			arrival: experiment.workload.arrival,
			phases: compilePhases(experiment.workload),
			timeoutUs: experiment.workload.timeoutMs * US_PER_MS,
			propagateDeadline: experiment.workload.propagateDeadline,
			faults,
		},
		topology: {
			nodeIds: nodes.map((n) => n.id),
			nodeLabels: nodes.map(defaultLabel),
			nodeKinds: nodes.map((n) => n.kind),
			linkIds: experiment.model.links.map((l) => l.id),
			client,
		},
		horizonMs,
		sampleWindowMs: experiment.run.sampleWindowMs,
	};
}

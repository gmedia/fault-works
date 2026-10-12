import type { EngineInput, RatePhase } from "@faultworks/engine";
import {
	type Experiment,
	LIMITS,
	type LoadBalancerNode,
	type ServerNode,
	type Workload,
} from "./schema.ts";

const US_PER_MS = 1000;

export interface TopologyInfo {
	clientId: string;
	clientLabel: string;
	loadBalancerId: string;
	loadBalancerLabel: string;
	/** In round-robin order, which is the order servers appear in `model.nodes`. */
	servers: Array<{ id: string; label: string }>;
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

/** Compiles an experiment that already passed `parseExperiment`/`checkExperiment`. */
export function compileExperiment(experiment: Experiment): CompiledExperiment {
	const nodes = experiment.model.nodes;
	const client = nodes.find((n) => n.kind === "client");
	const lb = nodes.find(
		(n): n is LoadBalancerNode => n.kind === "load-balancer",
	);
	const servers = nodes.filter((n): n is ServerNode => n.kind === "server");
	if (!client || !lb || servers.length === 0)
		throw new Error("compileExperiment needs a validated experiment");

	const serverIndex = new Map(servers.map((s, i) => [s.id, i]));
	const hc = lb.config.healthCheck;
	const horizonMs = effectiveHorizonMs(experiment);

	const engine: EngineInput = {
		seed: experiment.seed,
		horizonUs: horizonMs * US_PER_MS,
		maxEvents: LIMITS.maxEvents,
		healthCheck: hc.enabled
			? {
					intervalUs: hc.intervalMs * US_PER_MS,
					probeTimeoutUs: hc.probeTimeoutMs * US_PER_MS,
					unhealthyThreshold: hc.unhealthyThreshold,
					healthyThreshold: hc.healthyThreshold,
				}
			: null,
		servers: servers.map((s) => ({
			id: s.id,
			capacity: s.config.capacity,
			queueCapacity: s.config.queueCapacity,
			serviceTimeUs: Math.max(
				1,
				Math.round(s.config.serviceTimeMs * US_PER_MS),
			),
			distribution: s.config.serviceTimeDistribution,
		})),
		arrival: experiment.workload.arrival,
		phases: compilePhases(experiment.workload),
		timeoutUs: experiment.workload.timeoutMs * US_PER_MS,
		faults: experiment.faults.map((f) => {
			const index = serverIndex.get(f.target);
			if (index === undefined)
				throw new Error(`Fault ${f.id} targets unknown server ${f.target}`);
			return {
				id: f.id,
				server: index,
				atUs: f.atMs * US_PER_MS,
				recoverAtUs: f.recoverAtMs === null ? null : f.recoverAtMs * US_PER_MS,
				behavior: f.behavior,
			};
		}),
	};

	return {
		engine,
		topology: {
			clientId: client.id,
			clientLabel: client.label ?? "Client",
			loadBalancerId: lb.id,
			loadBalancerLabel: lb.label ?? "Load balancer",
			servers: servers.map((s) => ({ id: s.id, label: s.label ?? s.id })),
		},
		horizonMs,
		sampleWindowMs: experiment.run.sampleWindowMs,
	};
}

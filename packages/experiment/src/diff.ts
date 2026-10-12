import { effectiveHorizonMs } from "./compile.ts";
import {
	ARRIVAL_LABELS,
	BEHAVIOR_LABELS,
	BURST_FIELDS,
	DISTRIBUTION_LABELS,
	FAULT_FIELDS,
	type FieldInfo,
	formatValue,
	HEALTH_CHECK_FIELDS,
	RUN_FIELDS,
	SERVER_FIELDS,
	WORKLOAD_FIELDS,
} from "./fields.ts";
import type { Experiment, ServerNode } from "./schema.ts";

export interface SemanticChange {
	key: string;
	/** What the setting belongs to: "Traffic", "Load balancer", "Server B", "Fault b-down"... */
	scope: string;
	field: string;
	before: string | null;
	after: string | null;
}

interface Entry {
	scope: string;
	field: string;
	display: string;
}

function put(
	map: Map<string, Entry>,
	key: string,
	scope: string,
	info: Pick<FieldInfo, "label" | "unit">,
	value: unknown,
	display?: string,
) {
	map.set(key, {
		scope,
		field: info.label,
		display: display ?? formatValue(value, info.unit),
	});
}

/**
 * Everything that can change simulated behavior, keyed by stable identity (node and fault ids,
 * burst position). Titles, notes, labels and layout are deliberately absent.
 */
function flatten(experiment: Experiment): Map<string, Entry> {
	const map = new Map<string, Entry>();
	const run = "Run";
	put(map, "seed", run, RUN_FIELDS.seed, experiment.seed);
	put(
		map,
		"run.horizonMs",
		run,
		RUN_FIELDS.horizonMs,
		null,
		experiment.run.horizonMs === undefined
			? `auto (${formatValue(effectiveHorizonMs(experiment), "ms")})`
			: formatValue(experiment.run.horizonMs, "ms"),
	);

	const traffic = "Traffic";
	const w = experiment.workload;
	put(
		map,
		"workload.arrival",
		traffic,
		WORKLOAD_FIELDS.arrival,
		null,
		ARRIVAL_LABELS[w.arrival],
	);
	put(
		map,
		"workload.offeredRps",
		traffic,
		WORKLOAD_FIELDS.offeredRps,
		w.offeredRps,
	);
	put(map, "workload.startMs", traffic, WORKLOAD_FIELDS.startMs, w.startMs);
	put(
		map,
		"workload.durationMs",
		traffic,
		WORKLOAD_FIELDS.durationMs,
		w.durationMs,
	);
	put(
		map,
		"workload.timeoutMs",
		traffic,
		WORKLOAD_FIELDS.timeoutMs,
		w.timeoutMs,
	);
	w.bursts.forEach((b, i) => {
		const scope = `Burst ${i + 1}`;
		put(map, `burst.${i}.atMs`, scope, BURST_FIELDS.atMs, b.atMs);
		put(
			map,
			`burst.${i}.durationMs`,
			scope,
			BURST_FIELDS.durationMs,
			b.durationMs,
		);
		put(map, `burst.${i}.extraRps`, scope, BURST_FIELDS.extraRps, b.extraRps);
	});

	const servers = experiment.model.nodes.filter(
		(n): n is ServerNode => n.kind === "server",
	);
	put(
		map,
		"servers.order",
		"Load balancer",
		{ label: "Round-robin order", unit: null },
		null,
		servers.map((s) => s.id).join(", "),
	);
	for (const node of experiment.model.nodes) {
		if (node.kind === "load-balancer") {
			const scope = node.label ?? "Load balancer";
			const hc = node.config.healthCheck;
			put(
				map,
				"lb.healthCheck.enabled",
				scope,
				HEALTH_CHECK_FIELDS.enabled,
				hc.enabled,
			);
			// Probe settings only matter while checks are on; the caller drops them when both sides
			// have checks off.
			put(
				map,
				"lb.healthCheck.intervalMs",
				scope,
				HEALTH_CHECK_FIELDS.intervalMs,
				hc.intervalMs,
			);
			put(
				map,
				"lb.healthCheck.probeTimeoutMs",
				scope,
				HEALTH_CHECK_FIELDS.probeTimeoutMs,
				hc.probeTimeoutMs,
			);
			put(
				map,
				"lb.healthCheck.unhealthyThreshold",
				scope,
				HEALTH_CHECK_FIELDS.unhealthyThreshold,
				hc.unhealthyThreshold,
			);
			put(
				map,
				"lb.healthCheck.healthyThreshold",
				scope,
				HEALTH_CHECK_FIELDS.healthyThreshold,
				hc.healthyThreshold,
			);
		}
		if (node.kind === "server") {
			const scope = node.label ?? node.id;
			const c = node.config;
			const base = `server.${node.id}`;
			put(
				map,
				`${base}.present`,
				scope,
				{ label: "Server", unit: null },
				null,
				"present",
			);
			put(map, `${base}.capacity`, scope, SERVER_FIELDS.capacity, c.capacity);
			put(
				map,
				`${base}.queueCapacity`,
				scope,
				SERVER_FIELDS.queueCapacity,
				c.queueCapacity,
			);
			put(
				map,
				`${base}.serviceTimeMs`,
				scope,
				SERVER_FIELDS.serviceTimeMs,
				c.serviceTimeMs,
			);
			put(
				map,
				`${base}.serviceTimeDistribution`,
				scope,
				SERVER_FIELDS.serviceTimeDistribution,
				null,
				DISTRIBUTION_LABELS[c.serviceTimeDistribution],
			);
		}
	}

	for (const f of experiment.faults) {
		const scope = `Fault ${f.id}`;
		const base = `fault.${f.id}`;
		put(
			map,
			`${base}.present`,
			scope,
			{ label: "Fault", unit: null },
			null,
			"present",
		);
		put(map, `${base}.target`, scope, FAULT_FIELDS.target, f.target);
		put(map, `${base}.atMs`, scope, FAULT_FIELDS.atMs, f.atMs);
		put(
			map,
			`${base}.recoverAtMs`,
			scope,
			FAULT_FIELDS.recoverAtMs,
			f.recoverAtMs,
			f.recoverAtMs === null ? "never" : undefined,
		);
		put(
			map,
			`${base}.behavior`,
			scope,
			FAULT_FIELDS.behavior,
			null,
			BEHAVIOR_LABELS[f.behavior],
		);
	}
	return map;
}

/** Lists every behavior-relevant difference between two experiments, A → B. */
export function semanticDiff(a: Experiment, b: Experiment): SemanticChange[] {
	const left = flatten(a);
	const right = flatten(b);
	const hcOff =
		left.get("lb.healthCheck.enabled")?.display === "off" &&
		right.get("lb.healthCheck.enabled")?.display === "off";

	const keys = [
		...left.keys(),
		...[...right.keys()].filter((k) => !left.has(k)),
	];
	const changes: SemanticChange[] = [];
	for (const key of keys) {
		if (
			hcOff &&
			key.startsWith("lb.healthCheck.") &&
			key !== "lb.healthCheck.enabled"
		)
			continue;
		// A server or fault that exists on one side only is reported once, by its presence entry.
		const entity = /^(server|fault)\.([^.]+)\./.exec(key);
		if (entity && !key.endsWith(".present")) {
			const presence = `${entity[1]}.${entity[2]}.present`;
			if (!left.has(presence) || !right.has(presence)) continue;
		}
		const l = left.get(key);
		const r = right.get(key);
		if (l?.display === r?.display) continue;
		const meta = (r ?? l) as Entry;
		changes.push({
			key,
			scope: meta.scope,
			field: meta.field,
			before: l?.display ?? null,
			after: r?.display ?? null,
		});
	}
	return changes;
}

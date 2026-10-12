import { effectiveHorizonMs } from "./compile.ts";
import { FIELDS, type FieldKey, formatValue } from "./fields.ts";
import type { Experiment } from "./schema.ts";

export interface SemanticChange {
	key: string;
	/** What the setting belongs to; `scopeLabel` is the user's own label (node id, fault id...). */
	scope: "run" | "traffic" | "burst" | "node" | "link" | "fault";
	scopeLabel: string;
	/** Translation key of the field, or null for presence changes. */
	field: FieldKey | "presence" | "order";
	/** Raw values and a locale-neutral rendering; `null` means not present on that side. */
	before: unknown;
	after: unknown;
	beforeText: string | null;
	afterText: string | null;
}

interface Entry {
	scope: SemanticChange["scope"];
	scopeLabel: string;
	field: SemanticChange["field"];
	value: unknown;
	text: string;
}

function put(
	map: Map<string, Entry>,
	key: string,
	scope: Entry["scope"],
	scopeLabel: string,
	field: Entry["field"],
	value: unknown,
	text?: string,
) {
	const unit =
		field === "presence" || field === "order" ? null : FIELDS[field].unit;
	map.set(key, {
		scope,
		scopeLabel,
		field,
		value,
		text: text ?? formatValue(value, unit),
	});
}

/**
 * Everything that can change simulated behavior, keyed by stable identity (node, link and fault
 * ids, burst position). Titles, notes, labels and layout are deliberately absent.
 */
function flatten(experiment: Experiment): Map<string, Entry> {
	const map = new Map<string, Entry>();
	put(map, "seed", "run", "", "run.seed", experiment.seed);
	put(
		map,
		"run.horizonMs",
		"run",
		"",
		"run.horizonMs",
		experiment.run.horizonMs ?? null,
		experiment.run.horizonMs === undefined
			? `auto (${formatValue(effectiveHorizonMs(experiment), "ms")})`
			: undefined,
	);

	const w = experiment.workload;
	put(map, "workload.arrival", "traffic", "", "workload.arrival", w.arrival);
	put(
		map,
		"workload.offeredRps",
		"traffic",
		"",
		"workload.offeredRps",
		w.offeredRps,
	);
	put(map, "workload.startMs", "traffic", "", "workload.startMs", w.startMs);
	put(
		map,
		"workload.durationMs",
		"traffic",
		"",
		"workload.durationMs",
		w.durationMs,
	);
	put(
		map,
		"workload.timeoutMs",
		"traffic",
		"",
		"workload.timeoutMs",
		w.timeoutMs,
	);
	w.bursts.forEach((b, i) => {
		const label = String(i + 1);
		put(
			map,
			`burst.${i}.presence`,
			"burst",
			label,
			"presence",
			true,
			"present",
		);
		put(map, `burst.${i}.atMs`, "burst", label, "burst.atMs", b.atMs);
		put(
			map,
			`burst.${i}.durationMs`,
			"burst",
			label,
			"burst.durationMs",
			b.durationMs,
		);
		put(
			map,
			`burst.${i}.extraRps`,
			"burst",
			label,
			"burst.extraRps",
			b.extraRps,
		);
	});

	for (const node of experiment.model.nodes) {
		const label = node.label ?? node.id;
		const base = `node.${node.id}`;
		put(
			map,
			`${base}.presence`,
			"node",
			label,
			"presence",
			node.kind,
			node.kind,
		);
		if (node.kind === "load-balancer") {
			put(
				map,
				`${base}.algorithm`,
				"node",
				label,
				"balancer.algorithm",
				node.config.algorithm,
			);
			put(
				map,
				`${base}.retries`,
				"node",
				label,
				"balancer.retries",
				node.config.retries,
			);
			const hc = node.config.healthCheck;
			put(
				map,
				`${base}.hc.enabled`,
				"node",
				label,
				"healthCheck.enabled",
				hc.enabled,
			);
			put(
				map,
				`${base}.hc.intervalMs`,
				"node",
				label,
				"healthCheck.intervalMs",
				hc.intervalMs,
			);
			put(
				map,
				`${base}.hc.probeTimeoutMs`,
				"node",
				label,
				"healthCheck.probeTimeoutMs",
				hc.probeTimeoutMs,
			);
			put(
				map,
				`${base}.hc.unhealthyThreshold`,
				"node",
				label,
				"healthCheck.unhealthyThreshold",
				hc.unhealthyThreshold,
			);
			put(
				map,
				`${base}.hc.healthyThreshold`,
				"node",
				label,
				"healthCheck.healthyThreshold",
				hc.healthyThreshold,
			);
			// Downstream order is round-robin order.
			put(
				map,
				`${base}.order`,
				"node",
				label,
				"order",
				experiment.model.links
					.filter((l) => l.source === node.id)
					.map((l) => l.target),
				experiment.model.links
					.filter((l) => l.source === node.id)
					.map((l) => l.target)
					.join(", "),
			);
		} else if (node.kind !== "client") {
			const c = node.config;
			put(
				map,
				`${base}.capacity`,
				"node",
				label,
				node.kind === "queue" ? "queue.consumers" : "worker.capacity",
				c.capacity,
			);
			put(
				map,
				`${base}.queueCapacity`,
				"node",
				label,
				node.kind === "queue" ? "queue.backlog" : "worker.queueCapacity",
				c.queueCapacity,
			);
			put(
				map,
				`${base}.serviceTimeMs`,
				"node",
				label,
				"worker.serviceTimeMs",
				c.serviceTimeMs,
			);
			put(
				map,
				`${base}.distribution`,
				"node",
				label,
				"worker.serviceTimeDistribution",
				c.serviceTimeDistribution,
			);
			if (node.kind === "cache")
				put(
					map,
					`${base}.hitRatio`,
					"node",
					label,
					"cache.hitRatio",
					node.config.hitRatio,
				);
		}
	}

	for (const link of experiment.model.links) {
		const label = `${link.source} → ${link.target}`;
		const base = `link.${link.id}`;
		put(map, `${base}.presence`, "link", label, "presence", true, "present");
		put(
			map,
			`${base}.latencyMs`,
			"link",
			label,
			"link.latencyMs",
			link.latencyMs,
		);
		put(
			map,
			`${base}.timeoutMs`,
			"link",
			label,
			"link.timeoutMs",
			link.timeoutMs,
			link.timeoutMs === null ? "none" : undefined,
		);
		put(map, `${base}.retries`, "link", label, "link.retries", link.retries);
		put(
			map,
			`${base}.breaker.enabled`,
			"link",
			label,
			"breaker.enabled",
			link.circuitBreaker.enabled,
		);
		put(
			map,
			`${base}.breaker.failureThreshold`,
			"link",
			label,
			"breaker.failureThreshold",
			link.circuitBreaker.failureThreshold,
		);
		put(
			map,
			`${base}.breaker.openMs`,
			"link",
			label,
			"breaker.openMs",
			link.circuitBreaker.openMs,
		);
	}

	for (const f of experiment.faults) {
		const base = `fault.${f.id}`;
		put(map, `${base}.presence`, "fault", f.id, "presence", f.kind, f.kind);
		put(map, `${base}.kind`, "fault", f.id, "fault.kind", f.kind);
		put(map, `${base}.target`, "fault", f.id, "fault.target", f.target);
		put(map, `${base}.atMs`, "fault", f.id, "fault.atMs", f.atMs);
		if (f.kind === "node-failure") {
			put(
				map,
				`${base}.recoverAtMs`,
				"fault",
				f.id,
				"fault.recoverAtMs",
				f.recoverAtMs,
				f.recoverAtMs === null ? "never" : undefined,
			);
			put(map, `${base}.behavior`, "fault", f.id, "fault.behavior", f.behavior);
		} else {
			put(
				map,
				`${base}.untilMs`,
				"fault",
				f.id,
				"fault.untilMs",
				f.untilMs,
				f.untilMs === null ? "never" : undefined,
			);
			if (f.kind === "slowdown") {
				put(map, `${base}.factor`, "fault", f.id, "fault.factor", f.factor);
				put(map, `${base}.addMs`, "fault", f.id, "fault.addMs", f.addMs);
			} else if (f.kind === "error-rate" || f.kind === "link-loss")
				put(map, `${base}.rate`, "fault", f.id, "fault.rate", f.rate);
			else if (f.kind === "capacity")
				put(
					map,
					`${base}.capacity`,
					"fault",
					f.id,
					"fault.capacity",
					f.capacity,
				);
			else if (f.kind === "link-latency")
				put(map, `${base}.addMs`, "fault", f.id, "fault.addMs", f.addMs);
		}
	}
	return map;
}

/** Lists every behavior-relevant difference between two experiments, A → B. */
export function semanticDiff(a: Experiment, b: Experiment): SemanticChange[] {
	const left = flatten(a);
	const right = flatten(b);
	const keys = [
		...left.keys(),
		...[...right.keys()].filter((k) => !left.has(k)),
	];
	const changes: SemanticChange[] = [];
	const skipped = new Set<string>();

	for (const key of keys) {
		const l = left.get(key);
		const r = right.get(key);
		// Settings that only matter while a switch is on are ignored when it is off on both sides.
		const gate = key
			.replace(/\.hc\.(?!enabled).*$/, ".hc.enabled")
			.replace(/\.breaker\.(?!enabled).*$/, ".breaker.enabled");
		if (
			gate !== key &&
			left.get(gate)?.value === false &&
			right.get(gate)?.value === false
		)
			continue;
		// A node, link, burst or fault present on one side only is reported once, by its presence entry.
		const entity = /^((?:node|link|fault|burst)\.[^.]+)\./.exec(key);
		if (entity && !key.endsWith(".presence")) {
			const presence = `${entity[1]}.presence`;
			if (!left.has(presence) || !right.has(presence) || skipped.has(presence))
				continue;
		}
		if (l?.text === r?.text) continue;
		const meta = (r ?? l) as Entry;
		changes.push({
			key,
			scope: meta.scope,
			scopeLabel: meta.scopeLabel,
			field: meta.field,
			before: l?.value ?? null,
			after: r?.value ?? null,
			beforeText: l?.text ?? null,
			afterText: r?.text ?? null,
		});
	}
	return changes;
}

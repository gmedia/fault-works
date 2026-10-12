import { i18next } from "#/i18n/index.ts";
import { formatMs } from "#/lib/format.ts";
import type { RunResult } from "#/workers/protocol.ts";
import type { ChartBand, ChartMarker } from "./time-chart.tsx";

/**
 * Fault periods as chart bands. The amber hatch ("gap") is the time a component is down while a
 * balancer still routes to it; other faults get a soft band; open breakers a dotted one.
 */
export function faultBands(result: RunResult): {
	bands: ChartBand[];
	markers: ChartMarker[];
} {
	const t = i18next.t.bind(i18next);
	const bands: ChartBand[] = [];
	const markers: ChartMarker[] = [];
	const horizon = result.horizonMs;
	for (const f of result.metrics.summary.faults) {
		const end = f.endedAtMs ?? horizon;
		if (f.kind === "node-failure") {
			const noticed =
				f.detectedAtMs !== null ? Math.min(f.detectedAtMs, end) : end;
			bands.push({
				kind: "gap",
				fromMs: f.startedAtMs,
				toMs: noticed,
				label: t("bands.gap", {
					node: f.nodeLabel,
					from: formatMs(f.startedAtMs),
					to: formatMs(noticed),
				}),
			});
			markers.push({
				atMs: f.startedAtMs,
				label: t("bands.crashed", {
					node: f.nodeLabel,
					at: formatMs(f.startedAtMs),
				}),
			});
			if (noticed < end) {
				bands.push({
					kind: "down",
					fromMs: noticed,
					toMs: end,
					label: t("bands.removed", { node: f.nodeLabel }),
				});
				markers.push({
					atMs: noticed,
					label: t("bands.detected", {
						node: f.nodeLabel,
						at: formatMs(noticed),
					}),
				});
			}
			if (f.endedAtMs !== null) {
				markers.push({
					atMs: f.endedAtMs,
					label: t("bands.recovered", {
						node: f.nodeLabel,
						at: formatMs(f.endedAtMs),
					}),
				});
				const back = f.restoredAtMs ?? horizon;
				if (f.possibleDetectionMs && back > f.endedAtMs)
					bands.push({
						kind: "off",
						fromMs: f.endedAtMs,
						toMs: back,
						label: t("bands.waitingHealthy", { node: f.nodeLabel }),
					});
			}
		} else {
			bands.push({
				kind: "fault",
				fromMs: f.startedAtMs,
				toMs: end,
				label: t("bands.fault", {
					kind: t(`faultKinds.${f.kind}.label`),
					target: f.nodeLabel,
					from: formatMs(f.startedAtMs),
					to: formatMs(end),
				}),
			});
			markers.push({
				atMs: f.startedAtMs,
				label: t("bands.faultStart", {
					kind: t(`faultKinds.${f.kind}.label`),
					target: f.nodeLabel,
					at: formatMs(f.startedAtMs),
				}),
			});
		}
	}
	// Open circuit breakers.
	const open = new Map<number, number>();
	for (const tr of result.metrics.transitions) {
		if (tr.kind !== "breaker") continue;
		const link = result.experiment.model.links[tr.edge];
		const label = link ? `${link.source} → ${link.target}` : String(tr.edge);
		if (tr.state === "open" && !open.has(tr.edge)) open.set(tr.edge, tr.tMs);
		else if (tr.state === "closed" && open.has(tr.edge)) {
			bands.push({
				kind: "breaker",
				fromMs: open.get(tr.edge) as number,
				toMs: tr.tMs,
				label: t("bands.breakerOpen", { link: label }),
			});
			open.delete(tr.edge);
		}
	}
	for (const [edge, from] of open) {
		const link = result.experiment.model.links[edge];
		bands.push({
			kind: "breaker",
			fromMs: from,
			toMs: horizon,
			label: t("bands.breakerOpen", {
				link: link ? `${link.source} → ${link.target}` : String(edge),
			}),
		});
	}
	return { bands, markers: markers.sort((a, b) => a.atMs - b.atMs) };
}

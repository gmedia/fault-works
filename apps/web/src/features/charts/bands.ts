import { formatMs } from "#/lib/format.ts";
import type { RunResult } from "#/workers/protocol.ts";
import type { ChartBand, ChartMarker } from "./time-chart.tsx";

/**
 * Fault periods as chart bands. The amber hatch ("gap") is the time a server is down while the
 * load balancer still routes to it, the period every lesson in v0.1 is about.
 */
export function faultBands(result: RunResult): {
	bands: ChartBand[];
	markers: ChartMarker[];
} {
	const bands: ChartBand[] = [];
	const markers: ChartMarker[] = [];
	const horizon = result.horizonMs;
	for (const f of result.metrics.summary.faults) {
		const end = f.recoveredAtMs ?? horizon;
		const noticed =
			result.healthChecks && f.detectedAtMs !== null
				? Math.min(f.detectedAtMs, end)
				: end;
		bands.push({
			kind: "gap",
			fromMs: f.failedAtMs,
			toMs: noticed,
			label: `${f.serverLabel} down, still routed (${formatMs(f.failedAtMs)} – ${formatMs(noticed)})`,
		});
		markers.push({
			atMs: f.failedAtMs,
			label: `${f.serverLabel} crashed at ${formatMs(f.failedAtMs)}`,
		});
		if (noticed < end) {
			bands.push({
				kind: "down",
				fromMs: noticed,
				toMs: end,
				label: `${f.serverLabel} down, removed from rotation`,
			});
			markers.push({
				atMs: noticed,
				label: `${f.serverLabel} marked unhealthy at ${formatMs(noticed)}`,
			});
		}
		if (f.recoveredAtMs !== null) {
			markers.push({
				atMs: f.recoveredAtMs,
				label: `${f.serverLabel} recovered at ${formatMs(f.recoveredAtMs)}`,
			});
			const back = f.restoredAtMs ?? horizon;
			if (result.healthChecks && back > f.recoveredAtMs)
				bands.push({
					kind: "off",
					fromMs: f.recoveredAtMs,
					toMs: back,
					label: `${f.serverLabel} back, waiting for healthy probes`,
				});
		}
	}
	return { bands, markers };
}

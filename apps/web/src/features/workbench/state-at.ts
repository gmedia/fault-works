import type { RunResult } from "#/workers/protocol.ts";

export type ServerStatus = "up" | "down-routed" | "down-removed" | "recovering";

export interface ServerSnapshot {
	status: ServerStatus;
	busy: number;
	queue: number;
	/** Requests routed to this server during the window, per second. */
	routedRps: number;
}

export interface Snapshot {
	window: number;
	windowStartMs: number;
	offeredRps: number;
	succeededRps: number;
	failedRps: number;
	inFlight: number;
	servers: ServerSnapshot[];
	inRotation: number;
}

/**
 * State of the system at simulated time `tMs`. Up/down and health come from exact transition
 * times; load figures (busy, queue, rates) come from the window containing `tMs`.
 */
export function snapshotAt(result: RunResult, tMs: number): Snapshot {
	const { series, transitions } = result.metrics;
	const count = series.startMs.length;
	const window = Math.max(
		0,
		Math.min(count - 1, Math.floor(tMs / series.windowMs)),
	);
	const perSecond = 1000 / series.windowMs;
	const serverCount = result.topology.servers.length;

	const up = new Array<boolean>(serverCount).fill(true);
	const healthy = new Array<boolean>(serverCount).fill(true);
	for (const tr of transitions) {
		if (tr.tMs > tMs) break;
		if (tr.kind === "down") up[tr.server] = false;
		else if (tr.kind === "up") up[tr.server] = true;
		else if (tr.kind === "unhealthy") healthy[tr.server] = false;
		else healthy[tr.server] = true;
	}

	const servers = result.topology.servers.map((_, i): ServerSnapshot => {
		const isUp = up[i] as boolean;
		const inRotation = result.healthChecks ? (healthy[i] as boolean) : true;
		const status: ServerStatus = isUp
			? inRotation
				? "up"
				: "recovering"
			: inRotation
				? "down-routed"
				: "down-removed";
		return {
			status,
			busy: series.busy[i]?.[window] ?? 0,
			queue: series.queueDepth[i]?.[window] ?? 0,
			routedRps: (series.routed[i]?.[window] ?? 0) * perSecond,
		};
	});

	return {
		window,
		windowStartMs: series.startMs[window] ?? 0,
		offeredRps: (series.offered[window] ?? 0) * perSecond,
		succeededRps: (series.succeeded[window] ?? 0) * perSecond,
		failedRps: (series.failed[window] ?? 0) * perSecond,
		inFlight: series.inFlight[window] ?? 0,
		servers,
		inRotation: servers.filter(
			(s) => s.status === "up" || s.status === "down-routed",
		).length,
	};
}

export const STATUS_INFO: Record<
	ServerStatus,
	{ label: string; description: string }
> = {
	up: { label: "Up", description: "Running and receiving traffic." },
	"down-routed": {
		label: "Down, still routed",
		description:
			"Crashed, but the load balancer has not noticed and still sends it requests.",
	},
	"down-removed": {
		label: "Down, removed",
		description: "Crashed, and the load balancer has taken it out of rotation.",
	},
	recovering: {
		label: "Back, not routed yet",
		description:
			"Running again, waiting for enough successful probes to get traffic.",
	},
};

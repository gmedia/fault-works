import { addServer, canAddServer, servers } from "@faultworks/experiment";
import { ArrowDown, Plus, Radio, Waypoints } from "lucide-react";
import { useMemo } from "react";
import { Button } from "#/components/ui/button.tsx";
import { formatCount, formatMs } from "#/lib/format.ts";
import { serverColor } from "#/lib/series.ts";
import { cn } from "#/lib/utils.ts";
import { useWorkbench } from "./context.tsx";
import { loadBalancer } from "./mutations.ts";
import { usePlayback } from "./playback-store.ts";
import { snapshotAt } from "./state-at.ts";
import { StatusBadge } from "./status-badge.tsx";

function Bar({
	value,
	max,
	tone,
	label,
}: {
	value: number;
	max: number;
	tone: string;
	label: string;
}) {
	return (
		<span className="grid grid-cols-[3rem_1fr_auto] items-center gap-2 text-xs">
			<span className="text-muted-foreground">{label}</span>
			<span
				className="h-1.5 overflow-hidden rounded-full bg-muted"
				aria-hidden="true"
			>
				<span
					className="block h-full rounded-full"
					style={{
						width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`,
						background: tone,
					}}
				/>
			</span>
			<span className="tabular">
				{formatCount(value)}/{formatCount(max)}
			</span>
		</span>
	);
}

/**
 * Phone layout of the topology: the same information as the canvas as a vertical list of
 * full-width, tappable cards, readable without pinch-zoom.
 */
export function StackedTopology() {
	const {
		experiment,
		result,
		stale,
		selectedNode,
		selectNode,
		setInspectorTab,
		update,
	} = useWorkbench();
	const timeMs = usePlayback((s) => s.timeMs);
	const snap = useMemo(
		() => (result && !stale ? snapshotAt(result, timeMs) : null),
		[result, stale, timeMs],
	);
	const lb = loadBalancer(experiment);
	const client = experiment.model.nodes.find((n) => n.kind === "client");
	const list = servers(experiment);
	const open = (id: string) => {
		selectNode(id);
		setInspectorTab("component");
	};
	const card = (id: string) =>
		cn(
			"w-full rounded-lg border bg-card p-3 text-left transition-colors hover:border-input",
			selectedNode === id && "border-ring ring-2 ring-ring/30",
		);

	return (
		<div className="grid gap-2 p-3">
			{client && (
				<button
					type="button"
					className={card(client.id)}
					onClick={() => open(client.id)}
					aria-pressed={selectedNode === client.id}
				>
					<span className="flex items-center gap-2 font-medium text-sm">
						<Radio
							className="size-4 text-muted-foreground"
							aria-hidden="true"
						/>
						{client.label ?? "Client"}
					</span>
					<span className="mt-1 block text-muted-foreground text-xs">
						{snap
							? `Sending ${formatCount(snap.offeredRps)} req/s`
							: `${experiment.workload.offeredRps} req/s for ${formatMs(experiment.workload.durationMs)}`}
						, timeout {formatMs(experiment.workload.timeoutMs)}
					</span>
				</button>
			)}
			<ArrowDown
				className="mx-auto size-4 text-muted-foreground"
				aria-hidden="true"
			/>
			{lb && (
				<button
					type="button"
					className={card(lb.id)}
					onClick={() => open(lb.id)}
					aria-pressed={selectedNode === lb.id}
				>
					<span className="flex items-center gap-2 font-medium text-sm">
						<Waypoints
							className="size-4 text-muted-foreground"
							aria-hidden="true"
						/>
						{lb.label ?? "Load balancer"}
					</span>
					<span className="mt-1 block text-muted-foreground text-xs">
						Round robin,{" "}
						{lb.config.healthCheck.enabled
							? `probes every ${formatMs(lb.config.healthCheck.intervalMs)}`
							: "no health checks"}
						{snap && `. Routing to ${snap.inRotation} of ${list.length}`}
					</span>
				</button>
			)}
			<ArrowDown
				className="mx-auto size-4 text-muted-foreground"
				aria-hidden="true"
			/>
			<ul className="grid gap-2" aria-label="Servers">
				{list.map((s, i) => {
					const state = snap?.servers[i];
					const fault = experiment.faults.find((f) => f.target === s.id);
					return (
						<li key={s.id}>
							<button
								type="button"
								className={card(s.id)}
								onClick={() => open(s.id)}
								aria-pressed={selectedNode === s.id}
							>
								<span className="flex flex-wrap items-center justify-between gap-2">
									<span className="flex items-center gap-2 font-medium text-sm">
										<span
											className="size-2.5 rounded-full"
											style={{ background: serverColor(i) }}
											aria-hidden="true"
										/>
										{s.label ?? s.id}
									</span>
									{state && <StatusBadge status={state.status} />}
								</span>
								<span className="mt-1 block text-muted-foreground text-xs">
									{s.config.capacity} slots · {formatMs(s.config.serviceTimeMs)}{" "}
									· queue {s.config.queueCapacity}
									{state && ` · ${formatCount(state.routedRps)} req/s in`}
								</span>
								{state ? (
									<span className="mt-2 grid gap-1">
										<Bar
											label="Busy"
											value={state.busy}
											max={s.config.capacity}
											tone={serverColor(i)}
										/>
										<Bar
											label="Queue"
											value={state.queue}
											max={Math.max(1, s.config.queueCapacity)}
											tone="var(--muted-foreground)"
										/>
									</span>
								) : (
									fault && (
										<span className="mt-1 block text-gap text-xs">
											Fails at {formatMs(fault.atMs)}
											{fault.recoverAtMs !== null
												? `, back at ${formatMs(fault.recoverAtMs)}`
												: ", stays down"}
										</span>
									)
								)}
							</button>
						</li>
					);
				})}
			</ul>
			<Button
				variant="outline"
				className="mt-1"
				disabled={!canAddServer(experiment)}
				onClick={() => {
					const { experiment: next, id } = addServer(experiment);
					update(() => next);
					open(id);
				}}
			>
				<Plus aria-hidden="true" />
				Add server
			</Button>
		</div>
	);
}

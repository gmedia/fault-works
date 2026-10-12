import { isWorker } from "@faultworks/experiment";
import { ArrowDown, Zap } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatCount, formatMs } from "#/lib/format.ts";
import { nodeIcon, seriesColor } from "#/lib/nodes.ts";
import { cn } from "#/lib/utils.ts";
import { AddComponentMenu } from "./add-component-menu.tsx";
import { useWorkbench } from "./context.tsx";
import { lastLeaf, layerNodes, orderedWorkers } from "./layers.ts";
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
		<span className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2 text-xs">
			<span className="text-muted-foreground">{label}</span>
			<span
				className="h-1.5 overflow-hidden rounded-full bg-muted"
				aria-hidden="true"
			>
				<span
					className="block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
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
 * Phone layout of the graph: layers from the client downwards, each component a full-width
 * tappable card, with the links between layers listed as chips. Readable without pinch-zoom,
 * and every edit the canvas offers is available here through buttons.
 */
export function StackedTopology({ readOnly = false }: { readOnly?: boolean }) {
	const { t } = useTranslation();
	const { experiment, result, stale, selection, select, setInspectorTab } =
		useWorkbench();
	const timeMs = usePlayback((s) => s.timeMs);
	const snap = useMemo(
		() => (result && !stale ? snapshotAt(result, timeMs) : null),
		[result, stale, timeMs],
	);
	const layers = layerNodes(experiment);
	const workersList = orderedWorkers(experiment);
	const ids = result?.topology.nodeIds;
	const open = (id: string) => {
		select({ type: "node", id });
		setInspectorTab("component");
	};
	const card = (id: string) =>
		cn(
			"w-full rounded-lg border bg-card p-3 text-left transition-colors hover:border-input",
			selection?.type === "node" &&
				selection.id === id &&
				"border-ring ring-2 ring-ring/30",
		);
	const linksFrom = (id: string) =>
		experiment.model.links.filter((l) => l.source === id);
	const labelOf = (id: string) =>
		experiment.model.nodes.find((n) => n.id === id)?.label ?? id;

	return (
		<div className="grid gap-2 p-3">
			{layers.map((layer, depth) => (
				<div key={depth.toString()} className="grid gap-2">
					{depth > 0 && (
						<ArrowDown
							className="mx-auto size-4 text-muted-foreground"
							aria-hidden="true"
						/>
					)}
					<ul
						className="grid gap-2"
						aria-label={t("stacked.layer", { n: depth + 1 })}
					>
						{layer.map((node) => {
							const i = ids ? ids.indexOf(node.id) : -1;
							const s = snap && i !== -1 ? snap.nodes[i] : undefined;
							const Icon = nodeIcon(node);
							const wi = workersList.findIndex((w) => w.id === node.id);
							const faults = experiment.faults.filter(
								(f) => f.target === node.id,
							);
							const out = linksFrom(node.id);
							return (
								<li key={node.id}>
									<button
										type="button"
										className={card(node.id)}
										onClick={() => open(node.id)}
										aria-pressed={
											selection?.type === "node" && selection.id === node.id
										}
									>
										<span className="flex flex-wrap items-center justify-between gap-2">
											<span className="flex items-center gap-2 font-medium text-sm">
												{wi >= 0 && (
													<span
														className="size-2.5 rounded-full"
														style={{ background: seriesColor(wi) }}
														aria-hidden="true"
													/>
												)}
												<Icon
													className="size-4 text-muted-foreground"
													aria-hidden="true"
												/>
												{node.label ?? node.id}
											</span>
											{s && <StatusBadge status={s.status} />}
										</span>
										<span className="mt-1 block text-muted-foreground text-xs">
											{node.kind === "client" &&
												t("canvas.clientPlan", {
													rps: experiment.workload.offeredRps,
													duration: formatMs(experiment.workload.durationMs),
												})}
											{node.kind === "load-balancer" &&
												`${t(`options.balancer.algorithm.${node.config.algorithm}`)}, ${node.config.healthCheck.enabled ? t("canvas.probes", { interval: formatMs(node.config.healthCheck.intervalMs) }) : t("canvas.noHealthChecks")}`}
											{node.kind === "rate-limiter" &&
												t("canvas.limiterSpec", {
													rate: formatCount(node.config.ratePerSec),
													burst: formatCount(node.config.burst),
												})}
											{node.kind === "db-cluster" &&
												t("canvas.clusterSpec", {
													writes: Math.round(node.config.writeRatio * 100),
													failover: formatMs(node.config.failoverMs),
												})}
											{node.kind === "pooler" &&
												t("canvas.poolerSpec", {
													pool: node.config.capacity,
													waiting: formatCount(node.config.queueCapacity),
												})}
											{isWorker(node) &&
												node.kind !== "pooler" &&
												(node.kind === "queue"
													? t("canvas.queueSpec", {
															consumers: node.config.capacity,
															time: formatMs(node.config.serviceTimeMs),
															backlog: node.config.queueCapacity,
														})
													: t("canvas.workerSpec", {
															slots: node.config.capacity,
															time: formatMs(node.config.serviceTimeMs),
															queue: node.config.queueCapacity,
														}))}
											{s &&
												isWorker(node) &&
												` · ${formatCount(s.callsRps)} req/s`}
											{s &&
												node.kind === "rate-limiter" &&
												s.failedRps > 0 &&
												` · ${t("canvas.rejecting", { rps: formatCount(s.failedRps) })}`}
											{s &&
												node.kind === "db-cluster" &&
												snap?.primaries.get(node.id) &&
												` · ${t("canvas.primary", { node: labelOf(snap.primaries.get(node.id) as string) })}`}
										</span>
										{s && isWorker(node) && (
											<span className="mt-2 grid gap-1">
												<Bar
													label={t("canvas.busy")}
													value={s.busy}
													max={(node.config as { capacity: number }).capacity}
													tone={seriesColor(wi)}
												/>
												<Bar
													label={
														node.kind === "queue"
															? t("canvas.backlog")
															: t("canvas.queue")
													}
													value={s.queue}
													max={Math.max(
														1,
														(node.config as { queueCapacity: number })
															.queueCapacity,
													)}
													tone="var(--muted-foreground)"
												/>
											</span>
										)}
										{!s && faults.length > 0 && (
											<span className="mt-1 flex items-center gap-1 text-gap text-xs">
												<Zap className="size-3" aria-hidden="true" />
												{faults
													.map(
														(f) =>
															`${t(`faultKinds.${f.kind}.short`)} ${formatMs(f.atMs)}`,
													)
													.join(", ")}
											</span>
										)}
									</button>
									{out.length > 0 && (
										<ul
											className="mt-1 flex flex-wrap gap-1 pl-3"
											aria-label={t("stacked.linksFrom", {
												node: node.label ?? node.id,
											})}
										>
											{out.map((l) => (
												<li key={l.id}>
													<button
														type="button"
														className={cn(
															"rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-input",
															selection?.type === "link" &&
																selection.id === l.id &&
																"border-ring text-foreground",
														)}
														onClick={() => {
															select({ type: "link", id: l.id });
															setInspectorTab("component");
														}}
													>
														→ {labelOf(l.target)}
														{l.circuitBreaker.enabled &&
															` · ${t("canvas.edgeBreaker")}`}
														{l.retries > 0 &&
															` · ${t("canvas.edgeRetries", { n: l.retries })}`}
													</button>
												</li>
											))}
										</ul>
									)}
								</li>
							);
						})}
					</ul>
				</div>
			))}
			{!readOnly && (
				<AddComponentMenu
					from={
						selection?.type === "node" ? selection.id : lastLeaf(experiment)
					}
					size="default"
					className="mt-1"
					onAdded={open}
				/>
			)}
		</div>
	);
}

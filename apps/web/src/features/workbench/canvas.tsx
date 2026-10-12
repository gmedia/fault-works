import {
	addLink,
	addNode,
	canAddNode,
	type Experiment,
	LIMITS,
	type NodeKind,
} from "@faultworks/experiment";
import {
	addEdge,
	applyNodeChanges,
	Background,
	BaseEdge,
	type Connection,
	Controls,
	type Edge,
	EdgeLabelRenderer,
	type EdgeProps,
	getBezierPath,
	Handle,
	type Node,
	type NodeChange,
	type NodeProps,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import { Plus, Zap } from "lucide-react";
import {
	type CSSProperties,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { formatCount, formatMs } from "#/lib/format.ts";
import { ADDABLE_KINDS, NODE_ICONS, seriesColor } from "#/lib/nodes.ts";
import { useMediaQuery } from "#/lib/use-media-query.ts";
import { cn } from "#/lib/utils.ts";
import { useWorkbench } from "./context.tsx";
import { layerNodes, orderedWorkers } from "./layers.ts";
import { usePlayback } from "./playback-store.ts";
import {
	type LinkSnapshot,
	type NodeSnapshot,
	type Snapshot,
	snapshotAt,
} from "./state-at.ts";
import { StatusBadge } from "./status-badge.tsx";

type NodeData = { workerIndex: number };
type FlowNode = Node<NodeData>;
type FlowEdge = Edge<{ linkId: string }>;

function defaultPosition(
	experiment: Experiment,
	id: string,
): { x: number; y: number } {
	const layers = layerNodes(experiment);
	for (let d = 0; d < layers.length; d++) {
		const layer = layers[d] as Experiment["model"]["nodes"];
		const i = layer.findIndex((n) => n.id === id);
		if (i !== -1) return { x: d * 300, y: (i - (layer.length - 1) / 2) * 150 };
	}
	return { x: 0, y: 0 };
}

/** Live snapshot for the current replay time, or null when there is no current result. */
function useSnapshot(): Snapshot | null {
	const { result, stale } = useWorkbench();
	const timeMs = usePlayback((s) => s.timeMs);
	return useMemo(
		() => (result && !stale ? snapshotAt(result, timeMs) : null),
		[result, stale, timeMs],
	);
}

function nodeSnapshot(
	snap: Snapshot | null,
	id: string,
	ids: string[] | undefined,
): NodeSnapshot | undefined {
	if (!snap || !ids) return undefined;
	const i = ids.indexOf(id);
	return i === -1 ? undefined : snap.nodes[i];
}

/** One short shake when a node goes down; nothing otherwise. */
function useCrashShake(status: NodeSnapshot["status"] | undefined) {
	const prev = useRef(status);
	const [shake, setShake] = useState(false);
	useEffect(() => {
		const wasUp =
			prev.current === undefined ||
			prev.current === "up" ||
			prev.current === "degraded" ||
			prev.current === "recovering";
		if (wasUp && (status === "down-routed" || status === "down-removed")) {
			setShake(true);
			const t = setTimeout(() => setShake(false), 600);
			return () => clearTimeout(t);
		}
		prev.current = status;
	}, [status]);
	useEffect(() => {
		prev.current = status;
	}, [status]);
	return shake;
}

function NodeFrame({
	selected,
	children,
	className,
	shake,
	pulse,
}: {
	selected: boolean;
	children: React.ReactNode;
	className?: string;
	shake?: boolean;
	pulse?: boolean;
}) {
	return (
		<div
			className={cn(
				"rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-xs transition-[border-color,box-shadow]",
				selected ? "border-ring ring-2 ring-ring/30" : "hover:border-input",
				shake && "crash-shake",
				pulse && "pulse-ring",
				className,
			)}
		>
			{children}
		</div>
	);
}

const handleClass =
	"!size-3 !rounded-full !border-2 !border-card !bg-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 [.react-flow__node.selected_&]:opacity-100";

const ClientNode = memo(function ClientNode({
	id,
	selected,
}: NodeProps<FlowNode>) {
	const { t } = useTranslation();
	const { experiment, result } = useWorkbench();
	const snap = useSnapshot();
	const node = experiment.model.nodes.find((n) => n.id === id);
	const w = experiment.workload;
	const Icon = NODE_ICONS.client;
	void result;
	return (
		<NodeFrame selected={selected} className="group w-44">
			<div className="flex items-center gap-2 font-medium text-sm">
				<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
				{node?.label ?? t("kinds.client")}
			</div>
			<p className="mt-1 text-muted-foreground text-xs tabular">
				{snap
					? t("canvas.sending", { rps: formatCount(snap.offeredRps) })
					: t("canvas.clientPlan", {
							rps: w.offeredRps,
							duration: formatMs(w.durationMs),
						})}
			</p>
			<p className="text-muted-foreground text-xs">
				{t("canvas.timeout", { timeout: formatMs(w.timeoutMs) })}
			</p>
			<Handle type="source" position={Position.Right} className={handleClass} />
		</NodeFrame>
	);
});

const BalancerNode = memo(function BalancerNode({
	id,
	selected,
}: NodeProps<FlowNode>) {
	const { t } = useTranslation();
	const { experiment, result } = useWorkbench();
	const snap = useSnapshot();
	const node = experiment.model.nodes.find((n) => n.id === id);
	if (node?.kind !== "load-balancer") return null;
	const hc = node.config.healthCheck;
	const backends = experiment.model.links
		.filter((l) => l.source === id)
		.map((l) => l.target);
	const ids = result?.topology.nodeIds;
	const inRotation =
		snap && ids
			? backends.filter((b) =>
					["up", "down-routed", "degraded"].includes(
						nodeSnapshot(snap, b, ids)?.status ?? "up",
					),
				).length
			: backends.length;
	const Icon = NODE_ICONS["load-balancer"];
	return (
		<NodeFrame selected={selected} className="group w-48">
			<Handle type="target" position={Position.Left} className={handleClass} />
			<div className="flex items-center gap-2 font-medium text-sm">
				<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
				{node.label ?? t("kinds.load-balancer")}
			</div>
			<p className="mt-1 text-muted-foreground text-xs">
				{t(`options.balancer.algorithm.${node.config.algorithm}`)} ·{" "}
				{hc.enabled ? (
					t("canvas.probes", { interval: formatMs(hc.intervalMs) })
				) : (
					<span className="text-gap">{t("canvas.noHealthChecks")}</span>
				)}
			</p>
			{snap && (
				<p className="mt-1 text-xs tabular">
					{t("canvas.routingTo", { n: inRotation, total: backends.length })}
				</p>
			)}
			<Handle type="source" position={Position.Right} className={handleClass} />
		</NodeFrame>
	);
});

function Meter({
	value,
	max,
	label,
	tone,
}: {
	value: number;
	max: number;
	label: string;
	tone: string;
}) {
	const ratio = max > 0 ? Math.min(1, value / max) : 0;
	return (
		<div className="grid grid-cols-[3.25rem_1fr_auto] items-center gap-2 text-[11px]">
			<span className="text-muted-foreground">{label}</span>
			<span
				className="h-1.5 overflow-hidden rounded-full bg-muted"
				aria-hidden="true"
			>
				<span
					className="block h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none"
					style={{ width: `${ratio * 100}%`, background: tone }}
				/>
			</span>
			<span className="tabular">
				{formatCount(value)}/{formatCount(max)}
			</span>
		</div>
	);
}

const WorkerNode = memo(function WorkerNode({
	id,
	data,
	selected,
}: NodeProps<FlowNode>) {
	const { t } = useTranslation();
	const { experiment, result } = useWorkbench();
	const snap = useSnapshot();
	const node = experiment.model.nodes.find((n) => n.id === id);
	const s = nodeSnapshot(snap, id, result?.topology.nodeIds);
	const shake = useCrashShake(s?.status);
	if (!node || node.kind === "client" || node.kind === "load-balancer")
		return null;
	const c = node.config;
	const faults = experiment.faults.filter((f) => f.target === id);
	const Icon = NODE_ICONS[node.kind];
	const color = seriesColor(data.workerIndex);
	const saturated =
		s !== undefined && c.queueCapacity > 0 && s.queue >= c.queueCapacity;
	const activeFaultKinds =
		s?.activeFaults.map((i) => experiment.faults[i]?.kind).filter(Boolean) ??
		[];
	return (
		<NodeFrame
			selected={selected}
			className="group w-52"
			shake={shake}
			pulse={saturated}
		>
			<Handle type="target" position={Position.Left} className={handleClass} />
			<div className="flex min-w-0 items-center gap-2 font-medium text-sm">
				<span
					className="size-2.5 shrink-0 rounded-full"
					style={{ background: color }}
					aria-hidden="true"
				/>
				<Icon
					className="size-4 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<span className="truncate">{node.label ?? id}</span>
			</div>
			{s && (
				<div className="mt-1.5 flex flex-wrap items-center gap-1">
					<StatusBadge status={s.status} />
					{activeFaultKinds.map((k) => (
						<span
							key={k}
							className="inline-flex items-center gap-1 rounded-full bg-gap-soft px-2 py-0.5 text-[11px] text-gap"
						>
							<Zap className="size-3" aria-hidden="true" />
							{t(`faultKinds.${k}.short`)}
						</span>
					))}
				</div>
			)}
			<p className="mt-1 text-muted-foreground text-xs tabular">
				{node.kind === "queue"
					? t("canvas.queueSpec", {
							consumers: c.capacity,
							time: formatMs(c.serviceTimeMs),
							backlog: c.queueCapacity,
						})
					: t("canvas.workerSpec", {
							slots: c.capacity,
							time: formatMs(c.serviceTimeMs),
							queue: c.queueCapacity,
						})}
				{node.kind === "cache" &&
					` · ${t("canvas.hit", { pct: Math.round(node.config.hitRatio * 100) })}`}
			</p>
			{s ? (
				<div className="mt-2 grid gap-1">
					<Meter
						value={s.busy}
						max={c.capacity}
						label={t("canvas.busy")}
						tone={color}
					/>
					<Meter
						value={s.queue}
						max={Math.max(1, c.queueCapacity)}
						label={
							node.kind === "queue" ? t("canvas.backlog") : t("canvas.queue")
						}
						tone={saturated ? "var(--down)" : "var(--muted-foreground)"}
					/>
				</div>
			) : (
				faults.length > 0 && (
					<p className="mt-1.5 flex items-center gap-1.5 text-gap text-xs">
						<Zap className="size-3" aria-hidden="true" />
						{faults
							.map(
								(f) => `${t(`faultKinds.${f.kind}.short`)} ${formatMs(f.atMs)}`,
							)
							.join(", ")}
					</p>
				)
			)}
			{node.kind !== "cache" ||
			experiment.model.links.filter((l) => l.source === id).length === 0 ? (
				<Handle
					type="source"
					position={Position.Right}
					className={handleClass}
				/>
			) : null}
		</NodeFrame>
	);
});

/** Dots travelling along a link during replay. Rate decides how many and how fast. */
function FlowDots({
	path,
	rps,
	color,
	maxRps,
}: {
	path: string;
	rps: number;
	color: string;
	maxRps: number;
}) {
	const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
	if (reduced || rps <= 0) return null;
	const share = Math.min(1, rps / Math.max(1, maxRps));
	const count = Math.max(1, Math.round(share * 6));
	const duration = 2.2 - share * 1.2;
	return (
		<EdgeLabelRenderer>
			{Array.from({ length: count }, (_, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: dots are interchangeable
					key={i}
					className="flow-dot pointer-events-none absolute top-0 left-0 size-2 rounded-full"
					aria-hidden="true"
					style={
						{
							"--flow-path": `"${path}"`,
							"--flow-duration": `${duration}s`,
							"--flow-delay": `${(-i * duration) / count}s`,
							background: color,
							boxShadow: "0 0 0 1.5px var(--card)",
						} as CSSProperties
					}
				/>
			))}
		</EdgeLabelRenderer>
	);
}

const TrafficEdge = memo(function TrafficEdge(props: EdgeProps<FlowEdge>) {
	const { t } = useTranslation();
	const { experiment, result, selection } = useWorkbench();
	const snap = useSnapshot();
	const [path, labelX, labelY] = getBezierPath(props);
	const linkId = props.data?.linkId ?? "";
	const linkIndex = result?.topology.linkIds.indexOf(linkId) ?? -1;
	const ls: LinkSnapshot | undefined =
		snap && linkIndex !== -1 ? snap.links[linkIndex] : undefined;
	const link = experiment.model.links.find((l) => l.id === linkId);
	const target = link
		? experiment.model.nodes.find((n) => n.id === link.target)
		: undefined;
	const targetSnap =
		snap && result && target
			? nodeSnapshot(snap, target.id, result.topology.nodeIds)
			: undefined;
	const workersList = orderedWorkers(experiment);
	const targetIndex = target
		? workersList.findIndex((w) => w.id === target.id)
		: -1;
	const selected = selection?.type === "link" && selection.id === linkId;
	const lost = targetSnap?.status === "down-routed";
	const tone = selected
		? "var(--ring)"
		: ls?.breaker === "open"
			? "var(--series-7)"
			: lost
				? "var(--gap-band)"
				: "var(--chart-axis)";
	const width = selected
		? 2.5
		: ls
			? 1.5 +
				Math.min(4, (ls.callsRps / Math.max(1, snap?.offeredRps ?? 1)) * 4)
			: 1.5;
	const policy = link
		? [
				link.timeoutMs !== null
					? t("canvas.edgeTimeout", { ms: link.timeoutMs })
					: null,
				link.retries > 0 ? t("canvas.edgeRetries", { n: link.retries }) : null,
				link.circuitBreaker.enabled ? t("canvas.edgeBreaker") : null,
				link.latencyMs > 0
					? t("canvas.edgeLatency", { ms: link.latencyMs })
					: null,
			]
				.filter(Boolean)
				.join(" · ")
		: "";
	const activeFaults =
		ls?.activeFaults.map((i) => experiment.faults[i]?.kind).filter(Boolean) ??
		[];
	const dotColor = lost
		? "var(--down)"
		: targetSnap && targetSnap.failedRps > 0
			? "var(--gap-band)"
			: targetIndex >= 0
				? seriesColor(targetIndex)
				: "var(--muted-foreground)";
	return (
		<>
			<BaseEdge
				path={path}
				style={{
					stroke: tone,
					strokeWidth: width,
					strokeDasharray: ls?.breaker === "open" ? "6 4" : undefined,
				}}
				interactionWidth={24}
			/>
			{ls && (
				<FlowDots
					path={path}
					rps={ls.callsRps}
					color={dotColor}
					maxRps={snap?.offeredRps ?? 1}
				/>
			)}
			{(ls || policy || activeFaults.length > 0) && (
				<EdgeLabelRenderer>
					<div
						className="nodrag nopan pointer-events-none absolute rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground tabular"
						style={{
							transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
						}}
					>
						{ls ? (
							<>
								{ls.breaker === "open"
									? t("canvas.breakerOpen")
									: lost
										? t("canvas.lost", { rps: formatCount(ls.callsRps) })
										: `${formatCount(ls.callsRps)} req/s`}
								{activeFaults.length > 0 &&
									` · ${activeFaults.map((k) => t(`faultKinds.${k}.short`)).join(", ")}`}
							</>
						) : (
							policy
						)}
					</div>
				</EdgeLabelRenderer>
			)}
		</>
	);
});

const nodeTypes = {
	client: ClientNode,
	"load-balancer": BalancerNode,
	service: WorkerNode,
	database: WorkerNode,
	cache: WorkerNode,
	queue: WorkerNode,
};
const edgeTypes = { traffic: TrafficEdge };

function buildNodes(
	experiment: Experiment,
	selection: { type: string; id: string } | null,
): FlowNode[] {
	const list = orderedWorkers(experiment);
	return experiment.model.nodes.map((n) => ({
		id: n.id,
		type: n.kind,
		position: experiment.layout?.[n.id] ?? defaultPosition(experiment, n.id),
		data: { workerIndex: list.findIndex((w) => w.id === n.id) },
		selected: selection?.type === "node" && selection.id === n.id,
		ariaLabel: `${n.label ?? n.id} (${n.kind})`,
		deletable: false,
	}));
}

function buildEdges(
	experiment: Experiment,
	selection: { type: string; id: string } | null,
): FlowEdge[] {
	return experiment.model.links.map((l) => ({
		id: l.id,
		source: l.source,
		target: l.target,
		type: "traffic",
		data: { linkId: l.id },
		selected: selection?.type === "link" && selection.id === l.id,
		deletable: false,
		focusable: true,
	}));
}

function CanvasInner() {
	const { t } = useTranslation();
	const { experiment, update, selection, select, setInspectorTab } =
		useWorkbench();
	const [nodes, setNodes] = useState<FlowNode[]>(() =>
		buildNodes(experiment, selection),
	);
	const edges = useMemo(
		() => buildEdges(experiment, selection),
		[experiment, selection],
	);
	const { fitView } = useReactFlow();
	const nodeCount = experiment.model.nodes.length;

	useEffect(() => {
		setNodes(buildNodes(experiment, selection));
	}, [experiment, selection]);

	// Refit when components are added or removed so new ones are never off-screen.
	useEffect(() => {
		if (nodeCount > 0) void fitView({ padding: 0.2, duration: 200 });
	}, [nodeCount, fitView]);

	const commitPositions = useCallback(
		(moved: FlowNode[]) => {
			if (moved.length === 0) return;
			update(
				(e) => ({
					...e,
					layout: {
						...e.layout,
						...Object.fromEntries(
							moved.map((n) => [
								n.id,
								{ x: Math.round(n.position.x), y: Math.round(n.position.y) },
							]),
						),
					},
				}),
				"layout",
			);
		},
		[update],
	);

	const onNodesChange = useCallback(
		(changes: NodeChange<FlowNode>[]) => {
			setNodes((current) => {
				const next = applyNodeChanges(changes, current);
				const keyboardMoved = changes.filter(
					(c) =>
						c.type === "position" && c.dragging === undefined && c.position,
				);
				if (keyboardMoved.length)
					queueMicrotask(() =>
						commitPositions(
							next.filter((n) =>
								keyboardMoved.some(
									(c) => c.type === "position" && c.id === n.id,
								),
							),
						),
					);
				return next;
			});
			for (const c of changes)
				if (c.type === "select" && c.selected) {
					select({ type: "node", id: c.id });
					setInspectorTab("component");
				}
		},
		[commitPositions, select, setInspectorTab],
	);

	const onConnect = useCallback(
		(connection: Connection) => {
			if (!connection.source || !connection.target) return;
			const { experiment: next, id } = addLink(
				experiment,
				connection.source,
				connection.target,
			);
			if (!id) return;
			update(() => next);
			select({ type: "link", id });
			setInspectorTab("component");
			void addEdge;
		},
		[experiment, update, select, setInspectorTab],
	);

	const canAdd = canAddNode(experiment);

	return (
		<div className="relative h-full w-full">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				onNodesChange={onNodesChange}
				onNodeDragStop={(_, __, dragged) => commitPositions(dragged)}
				onPaneClick={() => select(null)}
				onEdgeClick={(_, edge) => {
					select({ type: "link", id: edge.id });
					setInspectorTab("component");
				}}
				onConnect={onConnect}
				nodesConnectable
				deleteKeyCode={null}
				selectionKeyCode={null}
				multiSelectionKeyCode={null}
				fitView
				fitViewOptions={{ padding: 0.2 }}
				minZoom={0.3}
				maxZoom={1.75}
				connectionLineStyle={{ stroke: "var(--ring)", strokeWidth: 2 }}
				ariaLabelConfig={{
					"node.a11yDescription.default": t("canvas.a11yNode"),
				}}
			>
				<Background gap={24} size={1} color="var(--chart-grid)" />
				<Controls
					showInteractive={false}
					position="bottom-right"
					aria-label={t("canvas.zoom")}
				/>
			</ReactFlow>
			<div className="absolute top-3 left-3 flex gap-2">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="outline"
							size="sm"
							className="bg-card"
							disabled={!canAdd}
							title={
								canAdd
									? undefined
									: t("inspector.maxNodes", { max: LIMITS.maxNodes })
							}
						>
							<Plus aria-hidden="true" />
							{t("canvas.addComponent")}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						{ADDABLE_KINDS.map((kind: NodeKind) => {
							const Icon = NODE_ICONS[kind];
							return (
								<DropdownMenuItem
									key={kind}
									onSelect={() => {
										const from =
											selection?.type === "node" ? selection.id : undefined;
										const { experiment: next, id } = addNode(experiment, kind, {
											from,
											label: t(`defaults.${kind}`),
										});
										update(() => next);
										select({ type: "node", id });
										setInspectorTab("component");
									}}
								>
									<Icon aria-hidden="true" />
									{t(`kinds.${kind}`)}
									<span className="ml-auto text-muted-foreground text-xs">
										{t(`kindHints.${kind}`)}
									</span>
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<p className="pointer-events-none absolute right-3 bottom-3 left-3 hidden text-center text-muted-foreground text-xs sm:block">
				{t("canvas.hint")}
			</p>
		</div>
	);
}

export function TopologyCanvas() {
	return (
		<ReactFlowProvider>
			<CanvasInner />
		</ReactFlowProvider>
	);
}

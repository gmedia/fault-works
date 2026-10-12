import {
	addServer,
	canAddServer,
	type Experiment,
	LIMITS,
	servers,
} from "@faultworks/experiment";
import {
	applyNodeChanges,
	Background,
	BaseEdge,
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
import { Plus, Radio, Server, Waypoints } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { formatCount, formatMs } from "#/lib/format.ts";
import { serverColor } from "#/lib/series.ts";
import { cn } from "#/lib/utils.ts";
import { useWorkbench } from "./context.tsx";
import { loadBalancer } from "./mutations.ts";
import { usePlayback } from "./playback-store.ts";
import { type Snapshot, snapshotAt } from "./state-at.ts";
import { StatusBadge } from "./status-badge.tsx";

type NodeData = { serverIndex: number };
type FlowNode = Node<NodeData>;

function defaultPosition(
	experiment: Experiment,
	id: string,
): { x: number; y: number } {
	const node = experiment.model.nodes.find((n) => n.id === id);
	if (node?.kind === "client") return { x: 0, y: 0 };
	if (node?.kind === "load-balancer") return { x: 300, y: 0 };
	const list = servers(experiment);
	const i = list.findIndex((s) => s.id === id);
	return { x: 620, y: (i - (list.length - 1) / 2) * 150 };
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

function NodeFrame({
	selected,
	children,
	className,
}: {
	selected: boolean;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"rounded-lg border bg-card px-3 py-2.5 text-card-foreground shadow-xs transition-[border-color,box-shadow]",
				selected ? "border-ring ring-2 ring-ring/30" : "hover:border-input",
				className,
			)}
		>
			{children}
		</div>
	);
}

const hiddenHandle = "!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

const ClientNode = memo(function ClientNode({ selected }: NodeProps<FlowNode>) {
	const { experiment } = useWorkbench();
	const snap = useSnapshot();
	const client = experiment.model.nodes.find((n) => n.kind === "client");
	const w = experiment.workload;
	return (
		<NodeFrame selected={selected} className="w-44">
			<div className="flex items-center gap-2 font-medium text-sm">
				<Radio className="size-4 text-muted-foreground" aria-hidden="true" />
				{client?.label ?? "Client"}
			</div>
			<p className="mt-1 text-muted-foreground text-xs tabular">
				{snap ? (
					<>Sending {formatCount(snap.offeredRps)} req/s</>
				) : (
					<>
						{w.offeredRps} req/s for {formatMs(w.durationMs)}
					</>
				)}
			</p>
			<p className="text-muted-foreground text-xs">
				timeout {formatMs(w.timeoutMs)}
			</p>
			<Handle
				type="source"
				position={Position.Right}
				className={hiddenHandle}
				isConnectable={false}
			/>
		</NodeFrame>
	);
});

const LoadBalancerNode = memo(function LoadBalancerNode({
	selected,
}: NodeProps<FlowNode>) {
	const { experiment } = useWorkbench();
	const snap = useSnapshot();
	const lb = loadBalancer(experiment);
	const hc = lb?.config.healthCheck;
	const total = servers(experiment).length;
	return (
		<NodeFrame selected={selected} className="w-48">
			<Handle
				type="target"
				position={Position.Left}
				className={hiddenHandle}
				isConnectable={false}
			/>
			<div className="flex items-center gap-2 font-medium text-sm">
				<Waypoints
					className="size-4 text-muted-foreground"
					aria-hidden="true"
				/>
				{lb?.label ?? "Load balancer"}
			</div>
			<p className="mt-1 text-muted-foreground text-xs">
				Round robin ·{" "}
				{hc?.enabled ? (
					`probes every ${formatMs(hc.intervalMs)}`
				) : (
					<span className="text-gap">no health checks</span>
				)}
			</p>
			{snap && (
				<p className="mt-1 text-xs tabular">
					Routing to {snap.inRotation} of {total}
				</p>
			)}
			<Handle
				type="source"
				position={Position.Right}
				className={hiddenHandle}
				isConnectable={false}
			/>
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
					className="block h-full rounded-full"
					style={{ width: `${ratio * 100}%`, background: tone }}
				/>
			</span>
			<span className="tabular">
				{formatCount(value)}/{formatCount(max)}
			</span>
		</div>
	);
}

const ServerNode = memo(function ServerNode({
	id,
	data,
	selected,
}: NodeProps<FlowNode>) {
	const { experiment } = useWorkbench();
	const snap = useSnapshot();
	const node = experiment.model.nodes.find((n) => n.id === id);
	if (node?.kind !== "server") return null;
	const c = node.config;
	const s = snap?.servers[data.serverIndex];
	const fault = experiment.faults.find((f) => f.target === id);
	return (
		<NodeFrame selected={selected} className="w-52">
			<Handle
				type="target"
				position={Position.Left}
				className={hiddenHandle}
				isConnectable={false}
			/>
			<div className="flex min-w-0 items-center gap-2 font-medium text-sm">
				<span
					className="size-2.5 shrink-0 rounded-full"
					style={{ background: serverColor(data.serverIndex) }}
					aria-hidden="true"
				/>
				<span className="truncate">{node.label ?? id}</span>
			</div>
			{s && <StatusBadge status={s.status} className="mt-1.5" />}
			<p className="mt-1 text-muted-foreground text-xs tabular">
				{c.capacity} slots · {formatMs(c.serviceTimeMs)} · queue{" "}
				{c.queueCapacity}
			</p>
			{s ? (
				<div className="mt-2 grid gap-1">
					<Meter
						value={s.busy}
						max={c.capacity}
						label="Busy"
						tone={serverColor(data.serverIndex)}
					/>
					<Meter
						value={s.queue}
						max={Math.max(1, c.queueCapacity)}
						label="Queue"
						tone={
							s.queue >= c.queueCapacity && c.queueCapacity > 0
								? "var(--down)"
								: "var(--muted-foreground)"
						}
					/>
				</div>
			) : (
				fault && (
					<p className="mt-1.5 flex items-center gap-1.5 text-gap text-xs">
						<Server className="size-3" aria-hidden="true" />
						Fails at {formatMs(fault.atMs)}
						{fault.recoverAtMs !== null
							? `, back at ${formatMs(fault.recoverAtMs)}`
							: ", stays down"}
					</p>
				)
			)}
		</NodeFrame>
	);
});

type FlowEdge = Edge<{ serverIndex: number | null }>;

const TrafficEdge = memo(function TrafficEdge(props: EdgeProps<FlowEdge>) {
	const snap = useSnapshot();
	const [path, labelX, labelY] = getBezierPath(props);
	const serverIndex = props.data?.serverIndex ?? null;
	let rps: number | null = null;
	let tone = "var(--chart-axis)";
	let width = 1.5;
	let note: string | null = null;
	if (snap) {
		if (serverIndex === null) rps = snap.offeredRps;
		else {
			const s = snap.servers[serverIndex];
			rps = s?.routedRps ?? 0;
			if (s?.status === "down-routed") {
				tone = "var(--gap-band)";
				note = "lost";
			} else if (s?.status === "down-removed" || s?.status === "recovering")
				note = "not routed";
		}
		width = 1.5 + Math.min(4, (rps / Math.max(1, snap.offeredRps)) * 4);
	}
	return (
		<>
			<BaseEdge path={path} style={{ stroke: tone, strokeWidth: width }} />
			{rps !== null && (
				<EdgeLabelRenderer>
					<div
						className="nodrag nopan pointer-events-none absolute rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground tabular"
						style={{
							transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
						}}
					>
						{note === "not routed"
							? note
							: `${formatCount(rps)} req/s${note ? ` · ${note}` : ""}`}
					</div>
				</EdgeLabelRenderer>
			)}
		</>
	);
});

const nodeTypes = {
	client: ClientNode,
	"load-balancer": LoadBalancerNode,
	server: ServerNode,
};
const edgeTypes = { traffic: TrafficEdge };

function buildNodes(
	experiment: Experiment,
	selected: string | null,
): FlowNode[] {
	const list = servers(experiment);
	return experiment.model.nodes.map((n) => ({
		id: n.id,
		type: n.kind,
		position: experiment.layout?.[n.id] ?? defaultPosition(experiment, n.id),
		data: { serverIndex: list.findIndex((s) => s.id === n.id) },
		selected: n.id === selected,
		ariaLabel: `${n.label ?? n.id} (${n.kind === "load-balancer" ? "load balancer" : n.kind})`,
		deletable: false,
	}));
}

function buildEdges(experiment: Experiment): FlowEdge[] {
	const list = servers(experiment);
	return experiment.model.links.map((l) => ({
		id: `${l.source}->${l.target}`,
		source: l.source,
		target: l.target,
		type: "traffic",
		data: {
			serverIndex:
				list.findIndex((s) => s.id === l.target) === -1
					? null
					: list.findIndex((s) => s.id === l.target),
		},
		selectable: false,
		focusable: false,
		deletable: false,
	}));
}

function CanvasInner() {
	const { experiment, update, selectedNode, selectNode, setInspectorTab } =
		useWorkbench();
	const [nodes, setNodes] = useState<FlowNode[]>(() =>
		buildNodes(experiment, selectedNode),
	);
	const edges = useMemo(() => buildEdges(experiment), [experiment]);
	const { fitView } = useReactFlow();
	const nodeCount = experiment.model.nodes.length;

	useEffect(() => {
		setNodes(buildNodes(experiment, selectedNode));
	}, [experiment, selectedNode]);

	// Refit when servers are added or removed so new nodes are never off-screen.
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
				// Keyboard moves arrive without a drag; commit them immediately.
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
					selectNode(c.id);
					setInspectorTab("component");
				}
		},
		[commitPositions, selectNode, setInspectorTab],
	);

	const canAdd = canAddServer(experiment);

	return (
		<div className="relative h-full w-full">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				onNodesChange={onNodesChange}
				onNodeDragStop={(_, __, dragged) => commitPositions(dragged)}
				onPaneClick={() => selectNode(null)}
				nodesConnectable={false}
				deleteKeyCode={null}
				selectionKeyCode={null}
				multiSelectionKeyCode={null}
				fitView
				fitViewOptions={{ padding: 0.2 }}
				minZoom={0.3}
				maxZoom={1.75}
				proOptions={{ hideAttribution: false }}
				ariaLabelConfig={{
					"node.a11yDescription.default":
						"Press Enter or Space to select this component and open its settings. Use the arrow keys to move it.",
				}}
			>
				<Background gap={24} size={1} color="var(--chart-grid)" />
				<Controls
					showInteractive={false}
					position="bottom-right"
					aria-label="Canvas zoom controls"
				/>
			</ReactFlow>
			<div className="absolute top-3 left-3 flex gap-2">
				<Button
					variant="outline"
					size="sm"
					className="bg-card"
					disabled={!canAdd}
					title={
						canAdd ? undefined : `Up to ${LIMITS.maxServers} servers in v0.1`
					}
					onClick={() => {
						const { experiment: next, id } = addServer(experiment);
						update(() => next);
						selectNode(id);
						setInspectorTab("component");
					}}
				>
					<Plus aria-hidden="true" />
					Add server
				</Button>
			</div>
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

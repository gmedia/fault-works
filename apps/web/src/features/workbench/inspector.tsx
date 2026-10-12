import {
	addFault,
	addLink,
	type DbClusterNode,
	effectiveHorizonMs,
	estimateOfferedRequests,
	FAULT_FIELDS,
	type FaultKind,
	type FieldKey,
	faultTargets,
	isWorker,
	LIMITS,
	LINK_FAULT_KINDS,
	linkProblem,
	type RateLimiterNode,
	randomSeed,
	removeLink,
	removeNode,
	updateLink,
	workers,
} from "@faultworks/experiment";
import { useNavigate } from "@tanstack/react-router";
import {
	ArrowRight,
	ArrowUpToLine,
	Dices,
	Link2,
	Plus,
	Trash2,
	Unplug,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/ui/tabs.tsx";
import { formatCount, formatMs } from "#/lib/format.ts";
import { nodeIcon, nodeTypeKey, seriesColor } from "#/lib/nodes.ts";
import { useLibrary } from "#/state/library.ts";
import { AddComponentMenu } from "./add-component-menu.tsx";
import { type InspectorTab, useWorkbench } from "./context.tsx";
import {
	FieldGroup,
	LinesField,
	NumberField,
	SelectField,
	SwitchField,
	TextField,
	useMessage,
} from "./fields.tsx";
import { orderedWorkers } from "./layers.ts";
import {
	linkIndex,
	nodeIndex,
	setLabel,
	updateBalancer,
	updateFault,
	updateHealthCheck,
	updateNode,
	updateWorkerConfig,
} from "./mutations.ts";

const TABS: InspectorTab[] = ["component", "traffic", "faults", "run", "notes"];

export function Inspector() {
	const { t } = useTranslation();
	const { inspectorTab, setInspectorTab, experiment, validation } =
		useWorkbench();
	const errorsIn = (prefixes: string[]) =>
		validation.issues.filter((i) => prefixes.some((p) => i.path.startsWith(p)))
			.length;
	const tabErrors: Record<InspectorTab, number> = {
		component: errorsIn(["model"]),
		traffic: errorsIn(["workload"]),
		faults: errorsIn(["faults"]),
		run: errorsIn(["seed", "run"]),
		notes: errorsIn([
			"title",
			"question",
			"description",
			"assumptions",
			"expectedObservations",
		]),
	};
	const counts: Partial<Record<InspectorTab, number>> = {
		faults: experiment.faults.length,
	};

	return (
		<Tabs
			value={inspectorTab}
			onValueChange={(v) => setInspectorTab(v as InspectorTab)}
			className="flex h-full min-h-0 flex-col gap-0"
		>
			<div className="border-b px-3 pt-2">
				<TabsList
					className="w-full justify-start overflow-x-auto bg-transparent p-0"
					aria-label={t("inspector.settings")}
				>
					{TABS.map((tab) => (
						<TabsTrigger
							key={tab}
							value={tab}
							className="relative flex-none rounded-none border-0 border-transparent border-b-2 px-2.5 pb-2 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
						>
							{t(`inspector.tabs.${tab}`)}
							{counts[tab] !== undefined && (
								<span className="ml-1 text-muted-foreground tabular">
									{counts[tab]}
								</span>
							)}
							{tabErrors[tab] > 0 && (
								<span className="ml-1 rounded-full bg-down px-1.5 text-[10px] text-white tabular">
									<span className="sr-only">{t("inspector.problems")}: </span>
									{tabErrors[tab]}
								</span>
							)}
						</TabsTrigger>
					))}
				</TabsList>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				<TabsContent value="component" className="mt-0">
					<ComponentPanel />
				</TabsContent>
				<TabsContent value="traffic" className="mt-0">
					<TrafficPanel />
				</TabsContent>
				<TabsContent value="faults" className="mt-0">
					<FaultsPanel />
				</TabsContent>
				<TabsContent value="run" className="mt-0">
					<RunPanel />
				</TabsContent>
				<TabsContent value="notes" className="mt-0">
					<NotesPanel />
				</TabsContent>
			</div>
		</Tabs>
	);
}

/** Errors for a field path, translated. */
function useFieldErrors() {
	const { validation } = useWorkbench();
	const message = useMessage();
	return (path: string) => validation.byPath.get(path)?.map(message);
}

function ComponentPanel() {
	const { t } = useTranslation();
	const { experiment, selection, select, update } = useWorkbench();
	const node =
		selection?.type === "node"
			? experiment.model.nodes.find((n) => n.id === selection.id)
			: undefined;
	const link =
		selection?.type === "link"
			? experiment.model.links.find((l) => l.id === selection.id)
			: undefined;

	if (link) return <LinkSettings linkId={link.id} />;
	if (!node) {
		const list = orderedWorkers(experiment);
		return (
			<div className="grid gap-4">
				<p className="text-muted-foreground text-sm">
					{t("inspector.pickComponent")}
				</p>
				<ul className="grid gap-1.5">
					{experiment.model.nodes.map((n) => {
						const Icon = nodeIcon(n);
						const wi = list.findIndex((w) => w.id === n.id);
						return (
							<li key={n.id}>
								<Button
									variant="outline"
									className="w-full justify-start"
									onClick={() => select({ type: "node", id: n.id })}
								>
									{wi >= 0 ? (
										<span
											className="size-2.5 rounded-full"
											style={{ background: seriesColor(wi) }}
											aria-hidden="true"
										/>
									) : (
										<Icon aria-hidden="true" />
									)}
									{n.label ?? n.id}
									<span className="ml-auto text-muted-foreground text-xs">
										{t(nodeTypeKey(n))}
									</span>
								</Button>
							</li>
						);
					})}
				</ul>
				<AddComponentMenu from={undefined} className="w-fit" />
				<p className="text-muted-foreground text-xs">
					{t("inspector.linksHint")}
				</p>
			</div>
		);
	}

	const Icon = nodeIcon(node);
	const outgoing = experiment.model.links.filter((l) => l.source === node.id);
	const incoming = experiment.model.links.filter((l) => l.target === node.id);
	const onlyNode = node.kind !== "client" && experiment.model.nodes.length <= 2;

	return (
		<div className="grid gap-6">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<Icon className="size-5 text-muted-foreground" aria-hidden="true" />
					<div>
						<p className="text-muted-foreground text-xs">
							{t(nodeTypeKey(node))}
						</p>
						<h2 className="font-semibold">{node.label ?? node.id}</h2>
					</div>
				</div>
				<Button variant="ghost" size="sm" onClick={() => select(null)}>
					{t("inspector.allComponents")}
				</Button>
			</div>
			<TextField
				label={t("inspector.name")}
				value={node.label ?? ""}
				maxLength={40}
				placeholder={node.id}
				help={t("inspector.nameHelp", { id: node.id })}
				onChange={(v) =>
					update((e) => setLabel(e, node.id, v), `label:${node.id}`)
				}
			/>
			{node.preset && (
				<p className="rounded-md bg-muted p-3 text-xs leading-relaxed">
					{t(`catalog.${node.preset}.description`)}{" "}
					{t("inspector.presetNote", { kind: t(`kinds.${node.kind}`) })}
				</p>
			)}
			{node.kind === "client" && <ClientSettings />}
			{node.kind === "load-balancer" && <LoadBalancerSettings id={node.id} />}
			{node.kind === "rate-limiter" && <LimiterSettings id={node.id} />}
			{node.kind === "db-cluster" && <ClusterSettings id={node.id} />}
			{isWorker(node) && <WorkerSettings id={node.id} />}

			<section className="grid gap-2">
				<h3 className="font-semibold text-sm">{t("inspector.connections")}</h3>
				{incoming.length === 0 && node.kind !== "client" && (
					<p className="text-down text-xs">{t("inspector.noIncoming")}</p>
				)}
				{outgoing.length === 0 && node.kind !== "client" ? null : null}
				<ul className="grid gap-1.5">
					{outgoing.map((l) => (
						<li key={l.id} className="flex items-center gap-2 text-sm">
							<ArrowRight
								className="size-3.5 text-muted-foreground"
								aria-hidden="true"
							/>
							<button
								type="button"
								className="min-w-0 flex-1 truncate text-left hover:underline"
								onClick={() => select({ type: "link", id: l.id })}
							>
								{experiment.model.nodes.find((n) => n.id === l.target)?.label ??
									l.target}
							</button>
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={t("inspector.removeLinkTo", { target: l.target })}
								onClick={() => update((e) => removeLink(e, l.id))}
							>
								<Unplug />
							</Button>
						</li>
					))}
				</ul>
				<AddComponentMenu
					from={node.id}
					label={t("inspector.addDownstream")}
					className="w-fit"
				/>
				<ConnectExisting from={node.id} />
			</section>

			{node.kind !== "client" && (
				<div className="border-t pt-4">
					<Button
						variant="outline"
						className="text-down"
						disabled={onlyNode}
						onClick={() => {
							const { experiment: next, removedFaults } = removeNode(
								experiment,
								node.id,
							);
							update(() => next);
							select(null);
							toast(t("inspector.removed", { name: node.label ?? node.id }), {
								description: t(
									removedFaults
										? "inspector.removedWithFaults"
										: "inspector.undoHint",
									{ count: removedFaults },
								),
							});
						}}
					>
						<Trash2 aria-hidden="true" />
						{t("inspector.removeComponent")}
					</Button>
				</div>
			)}
		</div>
	);
}

function ConnectExisting({ from }: { from: string }) {
	const { t } = useTranslation();
	const { experiment, update, select } = useWorkbench();
	const id = useId();
	// Only offer links that would be valid: no cycles, no second exit where one is allowed.
	const candidates = experiment.model.nodes.filter(
		(n) => linkProblem(experiment, from, n.id) === null,
	);
	if (candidates.length === 0) return null;
	return (
		<div className="flex items-end gap-2">
			<div className="grid flex-1 gap-1">
				<Label htmlFor={id} className="text-xs">
					{t("inspector.connectTo")}
				</Label>
				<select
					id={id}
					className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
					defaultValue=""
					onChange={(e) => {
						const target = e.target.value;
						if (!target) return;
						e.target.value = "";
						update((exp) => addLink(exp, from, target).experiment);
						select({ type: "node", id: from });
					}}
				>
					<option value="">{t("inspector.choose")}</option>
					{candidates.map((n) => (
						<option key={n.id} value={n.id}>
							{n.label ?? n.id} ({t(nodeTypeKey(n))})
						</option>
					))}
				</select>
			</div>
			<Link2
				className="mb-2.5 size-4 text-muted-foreground"
				aria-hidden="true"
			/>
		</div>
	);
}

function ClientSettings() {
	const { t } = useTranslation();
	const { setInspectorTab, experiment } = useWorkbench();
	return (
		<div className="grid gap-3 text-sm">
			<p className="text-muted-foreground">
				{t("inspector.clientSummary", {
					rps: experiment.workload.offeredRps,
					duration: formatMs(experiment.workload.durationMs),
					timeout: formatMs(experiment.workload.timeoutMs),
				})}
			</p>
			<Button variant="outline" onClick={() => setInspectorTab("traffic")}>
				{t("inspector.editTraffic")}
			</Button>
		</div>
	);
}

function LoadBalancerSettings({ id }: { id: string }) {
	const { t } = useTranslation();
	const { experiment, update } = useWorkbench();
	const err = useFieldErrors();
	const node = experiment.model.nodes.find((n) => n.id === id);
	if (node?.kind !== "load-balancer") return null;
	const i = nodeIndex(experiment, id);
	const hc = node.config.healthCheck;
	const minDetect = (hc.unhealthyThreshold - 1) * hc.intervalMs;
	const maxDetect = hc.unhealthyThreshold * hc.intervalMs;
	return (
		<div className="grid gap-6">
			<FieldGroup title={t("inspector.routing")}>
				<SelectField
					field="balancer.algorithm"
					value={node.config.algorithm}
					onChange={(algorithm) =>
						update((e) => updateBalancer(e, id, { algorithm }))
					}
				/>
				<NumberField
					field="balancer.retries"
					value={node.config.retries}
					integer
					min={0}
					errors={err(`model.nodes[${i}].config.retries`)}
					onChange={(v) =>
						v !== null &&
						update(
							(e) => updateBalancer(e, id, { retries: v }),
							`lb.retries:${id}`,
						)
					}
				/>
			</FieldGroup>
			<FieldGroup title={t("inspector.detection")}>
				<SwitchField
					field="healthCheck.enabled"
					checked={hc.enabled}
					onChange={(enabled) =>
						update((e) => updateHealthCheck(e, id, { enabled }))
					}
				/>
				{hc.enabled ? (
					<>
						<NumberField
							field="healthCheck.intervalMs"
							value={hc.intervalMs}
							integer
							min={100}
							step={500}
							showSeconds
							errors={err(`model.nodes[${i}].config.healthCheck.intervalMs`)}
							onChange={(v) =>
								v !== null &&
								update(
									(e) => updateHealthCheck(e, id, { intervalMs: v }),
									`hc.interval:${id}`,
								)
							}
						/>
						<NumberField
							field="healthCheck.unhealthyThreshold"
							value={hc.unhealthyThreshold}
							integer
							min={1}
							errors={err(
								`model.nodes[${i}].config.healthCheck.unhealthyThreshold`,
							)}
							onChange={(v) =>
								v !== null &&
								update(
									(e) => updateHealthCheck(e, id, { unhealthyThreshold: v }),
									`hc.unhealthy:${id}`,
								)
							}
						/>
						<NumberField
							field="healthCheck.healthyThreshold"
							value={hc.healthyThreshold}
							integer
							min={1}
							errors={err(
								`model.nodes[${i}].config.healthCheck.healthyThreshold`,
							)}
							onChange={(v) =>
								v !== null &&
								update(
									(e) => updateHealthCheck(e, id, { healthyThreshold: v }),
									`hc.healthy:${id}`,
								)
							}
						/>
						<NumberField
							field="healthCheck.probeTimeoutMs"
							value={hc.probeTimeoutMs}
							integer
							min={10}
							step={100}
							errors={err(
								`model.nodes[${i}].config.healthCheck.probeTimeoutMs`,
							)}
							onChange={(v) =>
								v !== null &&
								update(
									(e) => updateHealthCheck(e, id, { probeTimeoutMs: v }),
									`hc.timeout:${id}`,
								)
							}
						/>
						<p className="rounded-md bg-gap-soft p-3 text-xs leading-relaxed">
							{t("inspector.detectionHint", {
								min: formatMs(minDetect),
								max: formatMs(maxDetect),
								probeTimeout: formatMs(hc.probeTimeoutMs),
							})}
						</p>
					</>
				) : (
					<p className="rounded-md bg-gap-soft p-3 text-xs leading-relaxed">
						{t("inspector.noDetectionHint")}
					</p>
				)}
			</FieldGroup>
		</div>
	);
}

/** Throughput at `n` busy slots under the Universal Scalability Law, in requests per second. */
function uslThroughput(
	n: number,
	c: { serviceTimeMs: number; contention: number; coherency: number },
) {
	return (
		(n * 1000) /
		(c.serviceTimeMs * (1 + c.contention * (n - 1) + c.coherency * n * (n - 1)))
	);
}

function WorkerSettings({ id }: { id: string }) {
	const { t } = useTranslation();
	const { experiment, update } = useWorkbench();
	const err = useFieldErrors();
	const node = experiment.model.nodes.find((n) => n.id === id);
	if (!node || !isWorker(node)) return null;
	const i = nodeIndex(experiment, id);
	const c = node.config;
	const path = (f: string) => `model.nodes[${i}].config.${f}`;
	const set = (patch: Partial<typeof c>, key: string) =>
		update((e) => updateWorkerConfig(e, id, patch), `${key}:${id}`);
	const isQueue = node.kind === "queue";
	const isPooler = node.kind === "pooler";
	const isDb = node.kind === "database";
	const downstream = experiment.model.links.filter(
		(l) => l.source === id,
	).length;
	const contended = c.contention > 0 || c.coherency > 0;
	const peakN =
		c.coherency > 0
			? Math.max(1, Math.round(Math.sqrt((1 - c.contention) / c.coherency)))
			: null;
	// Without contention every slot adds the same throughput; with it, a full node does less.
	const plainRps = (c.capacity * 1000) / c.serviceTimeMs;
	const maxRps = uslThroughput(c.capacity, c);
	const peakRps =
		peakN !== null && peakN < c.capacity ? uslThroughput(peakN, c) : null;
	return (
		<div className="grid gap-6">
			<FieldGroup title={t("inspector.capacity")}>
				<NumberField
					field="worker.capacity"
					labelKey={
						isQueue
							? "queue.consumers"
							: isPooler
								? "pooler.poolSize"
								: isDb
									? "database.maxConnections"
									: undefined
					}
					value={c.capacity}
					integer
					min={1}
					errors={err(path("capacity"))}
					onChange={(v) => v !== null && set({ capacity: v }, "cap")}
				/>
				<NumberField
					field="worker.serviceTimeMs"
					value={c.serviceTimeMs}
					min={0.1}
					step={isPooler ? 0.1 : 10}
					errors={err(path("serviceTimeMs"))}
					onChange={(v) => v !== null && set({ serviceTimeMs: v }, "svc")}
				/>
				<SelectField
					field="worker.serviceTimeDistribution"
					value={c.serviceTimeDistribution}
					onChange={(v) => set({ serviceTimeDistribution: v }, "dist")}
				/>
				<NumberField
					field="worker.queueCapacity"
					labelKey={
						isQueue
							? "queue.backlog"
							: isPooler
								? "pooler.maxWaiting"
								: undefined
					}
					value={c.queueCapacity}
					integer
					min={0}
					step={10}
					errors={err(path("queueCapacity"))}
					onChange={(v) => v !== null && set({ queueCapacity: v }, "queue")}
				/>
				{!isQueue && (
					<NumberField
						field="worker.queueTimeoutMs"
						labelKey={isPooler ? "pooler.waitTimeoutMs" : undefined}
						value={c.queueTimeoutMs}
						nullable
						nullLabel={t("common.none")}
						integer
						min={1}
						step={100}
						showSeconds
						errors={err(path("queueTimeoutMs"))}
						onChange={(v) => set({ queueTimeoutMs: v }, "qto")}
					/>
				)}
				{node.kind === "cache" && (
					<NumberField
						field="cache.hitRatio"
						value={node.config.hitRatio}
						percent
						min={0}
						step={5}
						errors={err(path("hitRatio"))}
						onChange={(v) =>
							v !== null &&
							set({ hitRatio: Math.max(0, Math.min(1, v)) } as never, "hit")
						}
					/>
				)}
				{isPooler && (
					<p className="rounded-md bg-muted p-3 text-xs leading-relaxed">
						{t("inspector.poolerHint", {
							pool: c.capacity,
							target:
								experiment.model.nodes.find(
									(n) =>
										n.id ===
										experiment.model.links.find((l) => l.source === id)?.target,
								)?.label ?? t("kinds.database"),
							waiting: formatCount(c.queueCapacity),
							wait:
								c.queueTimeoutMs === null
									? t("common.never")
									: formatMs(c.queueTimeoutMs),
						})}
					</p>
				)}
				{!isPooler && Number.isFinite(plainRps) && plainRps > 0 && (
					<p className="rounded-md bg-muted p-3 text-xs leading-relaxed">
						{t(
							isQueue
								? "inspector.queueCapacityHint"
								: "inspector.capacityHint",
							{
								rps: formatCount(plainRps),
								slots: c.capacity,
								time: formatMs(c.serviceTimeMs),
								avg:
									c.serviceTimeDistribution === "exponential"
										? t("inspector.onAverage")
										: "",
							},
						)}
						{contended &&
							` ${t("inspector.capacityContended", { rps: formatCount(maxRps) })}`}
					</p>
				)}
				{isDb && c.queueCapacity === 0 && (
					<p className="text-muted-foreground text-xs leading-relaxed">
						{t("inspector.databaseNoQueue")}
					</p>
				)}
			</FieldGroup>

			{!isQueue && !isPooler && (
				<FieldGroup
					title={t("inspector.contention")}
					description={t("inspector.contentionHelp")}
				>
					<div className="flex flex-wrap gap-1.5">
						<Button
							variant="outline"
							size="sm"
							onClick={() => set({ contention: 0, coherency: 0 }, "usl")}
						>
							{t("inspector.contentionNone")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() =>
								set({ contention: 0.02, coherency: 0.0005 }, "usl")
							}
						>
							{t("inspector.contentionDatabase")}
						</Button>
					</div>
					<NumberField
						field="worker.contention"
						value={c.contention}
						min={0}
						step={0.01}
						errors={err(path("contention"))}
						onChange={(v) => v !== null && set({ contention: v }, "alpha")}
					/>
					<NumberField
						field="worker.coherency"
						value={c.coherency}
						min={0}
						step={0.0001}
						errors={err(path("coherency"))}
						onChange={(v) => v !== null && set({ coherency: v }, "beta")}
					/>
					{peakN !== null && (
						<p
							className={
								peakRps !== null
									? "rounded-md bg-gap-soft p-3 text-xs leading-relaxed"
									: "rounded-md bg-muted p-3 text-xs leading-relaxed"
							}
						>
							{t("inspector.contentionPeak", {
								n: peakN,
								rps: formatCount(uslThroughput(peakN, c)),
							})}
							{peakRps !== null &&
								` ${t("inspector.contentionOver", {
									slots: c.capacity,
									rps: formatCount(maxRps),
								})}`}
						</p>
					)}
				</FieldGroup>
			)}

			{downstream > 1 && node.kind !== "cache" && (
				<FieldGroup title={t("inspector.calls")}>
					<SelectField
						field="worker.callMode"
						value={c.callMode}
						onChange={(callMode) => set({ callMode }, "mode")}
					/>
				</FieldGroup>
			)}
		</div>
	);
}

function LimiterSettings({ id }: { id: string }) {
	const { t } = useTranslation();
	const { experiment, update } = useWorkbench();
	const err = useFieldErrors();
	const node = experiment.model.nodes.find((n) => n.id === id);
	if (node?.kind !== "rate-limiter") return null;
	const i = nodeIndex(experiment, id);
	const set = (patch: Partial<RateLimiterNode["config"]>, key: string) =>
		update(
			(e) =>
				updateNode<RateLimiterNode>(e, id, (n) => ({
					...n,
					config: { ...n.config, ...patch },
				})),
			`${key}:${id}`,
		);
	return (
		<FieldGroup title={t("inspector.limit")}>
			<NumberField
				field="limiter.ratePerSec"
				value={node.config.ratePerSec}
				min={1}
				step={10}
				errors={err(`model.nodes[${i}].config.ratePerSec`)}
				onChange={(v) => v !== null && set({ ratePerSec: v }, "rate")}
			/>
			<NumberField
				field="limiter.burst"
				value={node.config.burst}
				integer
				min={1}
				step={10}
				errors={err(`model.nodes[${i}].config.burst`)}
				onChange={(v) => v !== null && set({ burst: v }, "burst")}
			/>
			<p className="rounded-md bg-muted p-3 text-xs leading-relaxed">
				{t("inspector.limiterHint", {
					rate: formatCount(node.config.ratePerSec),
					burst: formatCount(node.config.burst),
				})}
			</p>
		</FieldGroup>
	);
}

function ClusterSettings({ id }: { id: string }) {
	const { t } = useTranslation();
	const { experiment, update } = useWorkbench();
	const err = useFieldErrors();
	const node = experiment.model.nodes.find((n) => n.id === id);
	if (node?.kind !== "db-cluster") return null;
	const i = nodeIndex(experiment, id);
	const members = experiment.model.links.filter((l) => l.source === id);
	const labelOf = (nid: string) =>
		experiment.model.nodes.find((n) => n.id === nid)?.label ?? nid;
	const set = (patch: Partial<DbClusterNode["config"]>, key: string) =>
		update(
			(e) =>
				updateNode<DbClusterNode>(e, id, (n) => ({
					...n,
					config: { ...n.config, ...patch },
				})),
			`${key}:${id}`,
		);
	/** The primary is the cluster's first link; moving a link first makes its node the primary. */
	const makePrimary = (linkId: string) =>
		update((e) => {
			const link = e.model.links.find((l) => l.id === linkId);
			if (!link) return e;
			const rest = e.model.links.filter((l) => l.id !== linkId);
			const at = rest.findIndex((l) => l.source === id);
			rest.splice(at === -1 ? rest.length : at, 0, link);
			return { ...e, model: { ...e.model, links: rest } };
		});
	return (
		<FieldGroup title={t("inspector.cluster")}>
			<NumberField
				field="cluster.writeRatio"
				value={node.config.writeRatio}
				percent
				min={0}
				step={5}
				errors={err(`model.nodes[${i}].config.writeRatio`)}
				onChange={(v) =>
					v !== null &&
					set({ writeRatio: Math.max(0, Math.min(1, v)) }, "writes")
				}
			/>
			<NumberField
				field="cluster.failoverMs"
				value={node.config.failoverMs}
				integer
				min={0}
				step={1000}
				showSeconds
				errors={err(`model.nodes[${i}].config.failoverMs`)}
				onChange={(v) => v !== null && set({ failoverMs: v }, "failover")}
			/>
			<ul className="grid gap-1.5 text-sm">
				{members.map((l, k) => (
					<li key={l.id} className="flex items-center gap-2">
						<span className="min-w-0 flex-1 truncate">{labelOf(l.target)}</span>
						<span className="text-muted-foreground text-xs">
							{k === 0 ? t("inspector.primary") : t("inspector.replica")}
						</span>
						{k > 0 && (
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label={t("inspector.makePrimary", {
									node: labelOf(l.target),
								})}
								title={t("inspector.makePrimary", { node: labelOf(l.target) })}
								onClick={() => makePrimary(l.id)}
							>
								<ArrowUpToLine />
							</Button>
						)}
					</li>
				))}
			</ul>
			<p className="rounded-md bg-muted p-3 text-xs leading-relaxed">
				{t("inspector.clusterHint", {
					writes: Math.round(node.config.writeRatio * 100),
					failover: formatMs(node.config.failoverMs),
				})}
			</p>
		</FieldGroup>
	);
}

function LinkSettings({ linkId }: { linkId: string }) {
	const { t } = useTranslation();
	const { experiment, update, select } = useWorkbench();
	const err = useFieldErrors();
	const link = experiment.model.links.find((l) => l.id === linkId);
	if (!link) return null;
	const i = linkIndex(experiment, linkId);
	const label = (id: string) =>
		experiment.model.nodes.find((n) => n.id === id)?.label ?? id;
	const breaker = link.circuitBreaker;
	return (
		<div className="grid gap-6">
			<div className="flex items-center justify-between gap-2">
				<div>
					<p className="text-muted-foreground text-xs">{t("inspector.link")}</p>
					<h2 className="font-semibold">
						{label(link.source)}{" "}
						<ArrowRight className="inline size-4" aria-hidden="true" />{" "}
						{label(link.target)}
					</h2>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => select({ type: "node", id: link.source })}
				>
					{label(link.source)}
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">{t("inspector.linkHint")}</p>
			<FieldGroup title={t("inspector.network")}>
				<NumberField
					field="link.latencyMs"
					value={link.latencyMs}
					min={0}
					step={5}
					errors={err(`model.links[${i}].latencyMs`)}
					onChange={(v) =>
						v !== null &&
						update(
							(e) => updateLink(e, linkId, { latencyMs: v }),
							`lat:${linkId}`,
						)
					}
				/>
			</FieldGroup>
			<FieldGroup title={t("inspector.resilience")}>
				<NumberField
					field="link.timeoutMs"
					value={link.timeoutMs}
					nullable
					nullLabel={t("common.none")}
					integer
					min={1}
					step={100}
					showSeconds
					errors={err(`model.links[${i}].timeoutMs`)}
					onChange={(v) =>
						update(
							(e) => updateLink(e, linkId, { timeoutMs: v }),
							`to:${linkId}`,
						)
					}
				/>
				<NumberField
					field="link.retries"
					value={link.retries}
					integer
					min={0}
					errors={err(`model.links[${i}].retries`)}
					onChange={(v) =>
						v !== null &&
						update(
							(e) => updateLink(e, linkId, { retries: v }),
							`retries:${linkId}`,
						)
					}
				/>
				{link.retries > 0 && (
					<>
						<NumberField
							field="link.retryBackoffMs"
							value={link.retryBackoffMs}
							min={0}
							step={50}
							errors={err(`model.links[${i}].retryBackoffMs`)}
							onChange={(v) =>
								v !== null &&
								update(
									(e) => updateLink(e, linkId, { retryBackoffMs: v }),
									`backoff:${linkId}`,
								)
							}
						/>
						{link.retryBackoffMs > 0 && (
							<SwitchField
								field="link.retryJitter"
								checked={link.retryJitter}
								onChange={(retryJitter) =>
									update((e) => updateLink(e, linkId, { retryJitter }))
								}
							/>
						)}
						<NumberField
							field="link.retryBudget"
							value={link.retryBudget}
							nullable
							nullLabel={t("common.none")}
							percent
							min={0}
							step={5}
							errors={err(`model.links[${i}].retryBudget`)}
							onChange={(v) =>
								update(
									(e) =>
										updateLink(e, linkId, {
											retryBudget:
												v === null ? null : Math.max(0, Math.min(1, v)),
										}),
									`budget:${linkId}`,
								)
							}
						/>
					</>
				)}
				<SwitchField
					field="breaker.enabled"
					checked={breaker.enabled}
					onChange={(enabled) =>
						update((e) =>
							updateLink(e, linkId, {
								circuitBreaker: { ...breaker, enabled },
							}),
						)
					}
				/>
				{breaker.enabled && (
					<>
						<NumberField
							field="breaker.failureThreshold"
							value={breaker.failureThreshold}
							integer
							min={1}
							errors={err(`model.links[${i}].circuitBreaker.failureThreshold`)}
							onChange={(v) =>
								v !== null &&
								update(
									(e) =>
										updateLink(e, linkId, {
											circuitBreaker: { ...breaker, failureThreshold: v },
										}),
									`cb.t:${linkId}`,
								)
							}
						/>
						<NumberField
							field="breaker.openMs"
							value={breaker.openMs}
							integer
							min={10}
							step={1000}
							showSeconds
							errors={err(`model.links[${i}].circuitBreaker.openMs`)}
							onChange={(v) =>
								v !== null &&
								update(
									(e) =>
										updateLink(e, linkId, {
											circuitBreaker: { ...breaker, openMs: v },
										}),
									`cb.o:${linkId}`,
								)
							}
						/>
					</>
				)}
				{link.retries > 0 && link.timeoutMs === null && (
					<p className="rounded-md bg-gap-soft p-3 text-xs leading-relaxed">
						{t("inspector.retriesNoTimeout")}
					</p>
				)}
			</FieldGroup>
			<div className="border-t pt-4">
				<Button
					variant="outline"
					className="text-down"
					onClick={() => {
						update((e) => removeLink(e, linkId));
						select({ type: "node", id: link.source });
						toast(t("inspector.linkRemoved"), {
							description: t("inspector.undoHint"),
						});
					}}
				>
					<Unplug aria-hidden="true" />
					{t("inspector.removeLink")}
				</Button>
			</div>
		</div>
	);
}

function TrafficPanel() {
	const { t } = useTranslation();
	const { experiment, update } = useWorkbench();
	const err = useFieldErrors();
	const w = experiment.workload;
	const setWorkload = (patch: Partial<typeof w>, key?: string) =>
		update((e) => ({ ...e, workload: { ...e.workload, ...patch } }), key);
	const offered = estimateOfferedRequests(experiment);
	const entry = experiment.model.links.find(
		(l) =>
			l.source === experiment.model.nodes.find((n) => n.kind === "client")?.id,
	);
	const first = entry
		? experiment.model.nodes.find((n) => n.id === entry.target)
		: undefined;
	const firstCapacity =
		first && isWorker(first)
			? (first.config.capacity * 1000) / first.config.serviceTimeMs
			: first?.kind === "load-balancer"
				? experiment.model.links
						.filter((l) => l.source === first.id)
						.map((l) => experiment.model.nodes.find((n) => n.id === l.target))
						.reduce(
							(sum, n) =>
								sum +
								(n && isWorker(n)
									? (n.config.capacity * 1000) / n.config.serviceTimeMs
									: 0),
							0,
						)
				: 0;
	return (
		<div className="grid gap-6">
			<FieldGroup title={t("inspector.steadyTraffic")}>
				<SelectField
					field="workload.arrival"
					value={w.arrival}
					onChange={(arrival) => setWorkload({ arrival })}
				/>
				<NumberField
					field="workload.offeredRps"
					value={w.offeredRps}
					min={1}
					step={10}
					errors={err("workload.offeredRps")}
					onChange={(v) => v !== null && setWorkload({ offeredRps: v }, "rps")}
				/>
				<NumberField
					field="workload.durationMs"
					value={w.durationMs}
					integer
					min={1}
					step={1000}
					showSeconds
					errors={err("workload.durationMs")}
					onChange={(v) =>
						v !== null && setWorkload({ durationMs: v }, "duration")
					}
				/>
				<NumberField
					field="workload.startMs"
					value={w.startMs}
					integer
					min={0}
					step={1000}
					showSeconds
					errors={err("workload.startMs")}
					onChange={(v) => v !== null && setWorkload({ startMs: v }, "start")}
				/>
				<NumberField
					field="workload.timeoutMs"
					value={w.timeoutMs}
					integer
					min={1}
					step={100}
					showSeconds
					errors={err("workload.timeoutMs")}
					onChange={(v) =>
						v !== null && setWorkload({ timeoutMs: v }, "timeout")
					}
				/>
				<SwitchField
					field="workload.propagateDeadline"
					checked={w.propagateDeadline}
					onChange={(propagateDeadline) => setWorkload({ propagateDeadline })}
				/>
				<p className="rounded-md bg-muted p-3 text-xs leading-relaxed">
					{t("inspector.trafficHint", {
						requests: formatCount(offered),
						avg: w.arrival === "poisson" ? t("inspector.onAverage") : "",
					})}
					{firstCapacity > 0 &&
						` ${t("inspector.entryCapacityHint", { name: first?.label ?? first?.id, rps: formatCount(firstCapacity), load: Math.round((w.offeredRps / firstCapacity) * 100) })}`}
				</p>
			</FieldGroup>

			<FieldGroup
				title={t("inspector.bursts")}
				description={t("inspector.burstsHelp")}
			>
				{w.bursts.length === 0 && (
					<p className="text-muted-foreground text-sm">
						{t("inspector.noBursts")}
					</p>
				)}
				{w.bursts.map((b, i) => (
					<div
						key={`burst-${i.toString()}`}
						className="grid gap-3 rounded-md border p-3"
					>
						<div className="flex items-center justify-between">
							<h4 className="font-medium text-sm">
								{t("inspector.burst", { n: i + 1 })}
							</h4>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("inspector.removeBurst", { n: i + 1 })}
								onClick={() =>
									setWorkload({ bursts: w.bursts.filter((_, j) => j !== i) })
								}
							>
								<Trash2 />
							</Button>
						</div>
						{(["atMs", "durationMs", "extraRps"] as const).map((field) => (
							<NumberField
								key={field}
								field={`burst.${field}` as FieldKey}
								value={b[field]}
								integer={field !== "extraRps"}
								min={field === "atMs" ? 0 : 1}
								step={field === "extraRps" ? 10 : 1000}
								showSeconds={field !== "extraRps"}
								errors={err(`workload.bursts[${i}].${field}`)}
								onChange={(v) =>
									v !== null &&
									setWorkload(
										{
											bursts: w.bursts.map((x, j) =>
												j === i ? { ...x, [field]: v } : x,
											),
										},
										`burst:${i}:${field}`,
									)
								}
							/>
						))}
					</div>
				))}
				<Button
					variant="outline"
					size="sm"
					className="w-fit"
					disabled={w.bursts.length >= LIMITS.maxBursts}
					onClick={() =>
						setWorkload({
							bursts: [
								...w.bursts,
								{
									atMs: Math.round(w.startMs + w.durationMs / 2),
									durationMs: Math.min(10_000, Math.round(w.durationMs / 6)),
									extraRps: Math.round(w.offeredRps / 2) || 10,
								},
							],
						})
					}
				>
					<Plus aria-hidden="true" />
					{t("inspector.addBurst")}
				</Button>
			</FieldGroup>
		</div>
	);
}

const FAULT_KINDS: FaultKind[] = [
	"node-failure",
	"slowdown",
	"error-rate",
	"capacity",
	"link-latency",
	"link-loss",
	"cache-flush",
];

function FaultsPanel() {
	const { t } = useTranslation();
	const { experiment, update } = useWorkbench();
	const err = useFieldErrors();
	const [newKind, setNewKind] = useState<FaultKind>("node-failure");
	const kindId = useId();
	const label = (id: string): string => {
		const node = experiment.model.nodes.find((n) => n.id === id);
		if (node) return node.label ?? node.id;
		const link = experiment.model.links.find((l) => l.id === id);
		if (link) return `${label(link.source)} → ${label(link.target)}`;
		return id;
	};
	const targetsFor = (kind: FaultKind) =>
		faultTargets(experiment, kind).map((id) => ({
			value: id,
			label: label(id),
		}));
	const canAddKind = targetsFor(newKind).length > 0;

	return (
		<div className="grid gap-4">
			<p className="text-muted-foreground text-sm">
				{t("inspector.faultsIntro")}
			</p>
			{experiment.faults.length === 0 && (
				<p className="rounded-md border border-dashed p-4 text-center text-muted-foreground text-sm">
					{t("inspector.noFaults")}
				</p>
			)}
			{experiment.faults.map((f, i) => {
				const isLink = LINK_FAULT_KINDS.includes(f.kind);
				const fields = FAULT_FIELDS[f.kind] ?? [];
				return (
					<div
						key={`${f.id}-${i.toString()}`}
						className="grid gap-3 rounded-md border p-3"
					>
						<div className="flex items-center justify-between gap-2">
							<h3 className="font-medium text-sm">
								{t(`faultKinds.${f.kind}.label`)}{" "}
								<span className="font-mono font-normal text-muted-foreground text-xs">
									{f.id}
								</span>
							</h3>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("inspector.removeFault", { id: f.id })}
								onClick={() =>
									update((e) => ({
										...e,
										faults: e.faults.filter((_, j) => j !== i),
									}))
								}
							>
								<Trash2 />
							</Button>
						</div>
						<p className="-mt-2 text-muted-foreground text-xs">
							{t(`faultKinds.${f.kind}.help`)}
						</p>
						<SelectField
							field="fault.target"
							value={f.target}
							options={targetsFor(f.kind)}
							errors={err(`faults[${i}].target`)}
							labelOverride={t(
								isLink
									? "fields.fault.targetLink.label"
									: "fields.fault.target.label",
							)}
							onChange={(target) =>
								update((e) => updateFault(e, i, { target }))
							}
						/>
						<NumberField
							field="fault.atMs"
							value={f.atMs}
							integer
							min={0}
							step={1000}
							showSeconds
							errors={err(`faults[${i}].atMs`)}
							onChange={(v) =>
								v !== null &&
								update((e) => updateFault(e, i, { atMs: v }), `fault:${i}:at`)
							}
						/>
						{fields.map((field) => {
							const prop = field.replace("fault.", "") as keyof typeof f;
							if (field === "fault.ramp")
								return (
									<SwitchField
										key={field}
										field="fault.ramp"
										checked={(f as { ramp: boolean }).ramp}
										onChange={(ramp) =>
											update((e) => updateFault(e, i, { ramp } as never))
										}
									/>
								);
							if (field === "fault.behavior")
								return (
									<SelectField
										key={field}
										field="fault.behavior"
										value={(f as { behavior: "refuse" | "hang" }).behavior}
										onChange={(behavior) =>
											update((e) => updateFault(e, i, { behavior } as never))
										}
									/>
								);
							const isPercent = field === "fault.rate";
							const nullable =
								field === "fault.recoverAtMs" || field === "fault.untilMs";
							return (
								<NumberField
									key={field}
									field={field}
									value={(f as Record<string, unknown>)[prop] as number | null}
									nullable={nullable}
									nullLabel={t("common.never")}
									percent={isPercent}
									integer={field.endsWith("Ms") || field === "fault.capacity"}
									min={field === "fault.factor" ? 1 : 0}
									step={field.endsWith("Ms") ? 1000 : isPercent ? 5 : 1}
									showSeconds={field.endsWith("Ms") && field !== "fault.addMs"}
									errors={err(`faults[${i}].${prop}`)}
									onChange={(v) =>
										(nullable || v !== null) &&
										update(
											(e) => updateFault(e, i, { [prop]: v } as never),
											`fault:${i}:${prop}`,
										)
									}
								/>
							);
						})}
					</div>
				);
			})}
			<div className="grid gap-2 rounded-md border border-dashed p-3">
				<Label htmlFor={kindId} className="text-xs">
					{t("inspector.newFaultKind")}
				</Label>
				<select
					id={kindId}
					className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
					value={newKind}
					onChange={(e) => setNewKind(e.target.value as FaultKind)}
				>
					{FAULT_KINDS.map((kind) => (
						<option key={kind} value={kind}>
							{t(`faultKinds.${kind}.label`)}
						</option>
					))}
				</select>
				<p className="text-muted-foreground text-xs">
					{t(`faultKinds.${newKind}.help`)}
				</p>
				<Button
					variant="outline"
					className="w-fit"
					disabled={experiment.faults.length >= LIMITS.maxFaults || !canAddKind}
					onClick={() => {
						const added = addFault(experiment, newKind);
						if (added) update(() => added.experiment);
					}}
				>
					<Plus aria-hidden="true" />
					{t("inspector.addFault")}
				</Button>
				{!canAddKind && (
					<p className="text-muted-foreground text-xs">
						{t("inspector.noTargetForKind")}
					</p>
				)}
			</div>
		</div>
	);
}

function RunPanel() {
	const { t } = useTranslation();
	const { experiment, update } = useWorkbench();
	const err = useFieldErrors();
	const auto = effectiveHorizonMs({
		...experiment,
		run: { ...experiment.run, horizonMs: undefined },
	});
	return (
		<div className="grid gap-6">
			<FieldGroup title={t("inspector.reproducibility")}>
				<NumberField
					field="run.seed"
					value={experiment.seed}
					integer
					min={0}
					errors={err("seed")}
					onChange={(v) =>
						v !== null && update((e) => ({ ...e, seed: v }), "seed")
					}
				/>
				<Button
					variant="outline"
					size="sm"
					className="w-fit"
					onClick={() => update((e) => ({ ...e, seed: randomSeed() }))}
				>
					<Dices aria-hidden="true" />
					{t("inspector.anotherSeed")}
				</Button>
				<p className="text-muted-foreground text-xs">
					{t("inspector.seedHint")}
				</p>
			</FieldGroup>
			<FieldGroup title={t("inspector.time")}>
				<NumberField
					field="run.horizonMs"
					value={experiment.run.horizonMs ?? null}
					nullable
					nullLabel={`${t("common.auto")} (${formatMs(auto)})`}
					integer
					min={1}
					step={1000}
					showSeconds
					errors={err("run.horizonMs")}
					onChange={(v) =>
						update(
							(e) => ({
								...e,
								run: { ...e.run, horizonMs: v === null ? undefined : v },
							}),
							"horizon",
						)
					}
				/>
				<NumberField
					field="run.sampleWindowMs"
					value={experiment.run.sampleWindowMs}
					integer
					min={100}
					step={250}
					errors={err("run.sampleWindowMs")}
					onChange={(v) =>
						v !== null &&
						update(
							(e) => ({ ...e, run: { ...e.run, sampleWindowMs: v } }),
							"window",
						)
					}
				/>
			</FieldGroup>
		</div>
	);
}

function NotesPanel() {
	const { t } = useTranslation();
	const { experiment, update } = useWorkbench();
	const err = useFieldErrors();
	return (
		<div className="grid gap-5">
			<TextField
				label={t("notes.title")}
				value={experiment.title}
				maxLength={120}
				errors={err("title")}
				onChange={(title) => update((e) => ({ ...e, title }), "title")}
			/>
			<TextField
				label={t("notes.question")}
				multiline
				value={experiment.question}
				maxLength={300}
				help={t("notes.questionHelp")}
				onChange={(question) => update((e) => ({ ...e, question }), "question")}
			/>
			<TextField
				label={t("notes.description")}
				multiline
				value={experiment.description}
				maxLength={2000}
				onChange={(description) =>
					update((e) => ({ ...e, description }), "description")
				}
			/>
			<LinesField
				label={t("notes.expected")}
				help={t("notes.expectedHelp")}
				value={experiment.expectedObservations}
				onChange={(expectedObservations) =>
					update((e) => ({ ...e, expectedObservations }), "expected")
				}
			/>
			<LinesField
				label={t("notes.assumptions")}
				help={t("notes.assumptionsHelp")}
				value={experiment.assumptions}
				onChange={(assumptions) =>
					update((e) => ({ ...e, assumptions }), "assumptions")
				}
			/>
			<IdField />
			<p className="font-mono text-muted-foreground text-xs">
				schema {experiment.schemaVersion}
			</p>
		</div>
	);
}

/** The experiment id doubles as its file name, so it can be changed until it is shared. */
function IdField() {
	const { t } = useTranslation();
	const { id } = useWorkbench();
	const [draft, setDraft] = useState(id);
	const [error, setError] = useState<string | null>(null);
	const rename = useLibrary((s) => s.renameExperiment);
	const navigate = useNavigate();
	const inputId = useId();
	useEffect(() => setDraft(id), [id]);

	const commit = () => {
		const next = draft.trim().toLowerCase();
		if (next === id) {
			setError(null);
			return;
		}
		if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(next)) {
			setError(t("messages.validation.id"));
			return;
		}
		const done = rename(id, next);
		if (!done) {
			setError(t("notes.idTaken", { id: next }));
			return;
		}
		setError(null);
		toast.success(t("notes.renamed", { id: next }), {
			description: t("notes.renamedHint", { id: next }),
		});
		void navigate({
			to: "/experiments/$experimentId",
			params: { experimentId: next },
			search: (prev) => prev,
			replace: true,
		});
	};

	return (
		<div className="grid gap-1.5">
			<Label htmlFor={inputId} className="font-medium text-sm">
				{t("notes.id")}
			</Label>
			<Input
				id={inputId}
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit();
				}}
				className="font-mono"
				aria-invalid={error !== null}
				aria-describedby={`${inputId}-help`}
				spellCheck={false}
			/>
			<p
				id={`${inputId}-help`}
				className={
					error ? "text-down text-xs" : "text-muted-foreground text-xs"
				}
			>
				{error ?? t("notes.idHelp", { id: draft || id })}
			</p>
		</div>
	);
}

export { useFieldErrors, workers };

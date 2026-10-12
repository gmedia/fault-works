import {
	ARRIVAL_LABELS,
	addFault,
	BEHAVIOR_LABELS,
	BURST_FIELDS,
	DISTRIBUTION_LABELS,
	type Experiment,
	effectiveHorizonMs,
	estimateOfferedRequests,
	FAULT_FIELDS,
	HEALTH_CHECK_FIELDS,
	LIMITS,
	RUN_FIELDS,
	randomSeed,
	removeServer,
	SERVER_FIELDS,
	type ServerNode,
	servers,
	WORKLOAD_FIELDS,
} from "@faultworks/experiment";
import { Dices, Plus, Server, Trash2, Waypoints } from "lucide-react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/ui/tabs.tsx";
import { formatCount, formatMs } from "#/lib/format.ts";
import { serverColor } from "#/lib/series.ts";
import { type InspectorTab, useWorkbench } from "./context.tsx";
import {
	FieldGroup,
	LinesField,
	NumberField,
	SelectField,
	SwitchField,
	TextField,
} from "./fields.tsx";
import {
	loadBalancer,
	nodeIndex,
	setLabel,
	updateFault,
	updateHealthCheck,
	updateServerConfig,
} from "./mutations.ts";

const TABS: Array<{ value: InspectorTab; label: string }> = [
	{ value: "component", label: "Component" },
	{ value: "traffic", label: "Traffic" },
	{ value: "faults", label: "Faults" },
	{ value: "run", label: "Run" },
	{ value: "notes", label: "Notes" },
];

export function Inspector() {
	const { inspectorTab, setInspectorTab, experiment, validation } =
		useWorkbench();
	const counts: Partial<Record<InspectorTab, number>> = {
		faults: experiment.faults.length,
	};
	const errorsIn = (prefix: string[]) =>
		validation.issues.filter((i) => prefix.some((p) => i.path.startsWith(p)))
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

	return (
		<Tabs
			value={inspectorTab}
			onValueChange={(v) => setInspectorTab(v as InspectorTab)}
			className="flex h-full min-h-0 flex-col gap-0"
		>
			<div className="border-b px-3 pt-3">
				<TabsList
					className="w-full justify-start overflow-x-auto bg-transparent p-0"
					aria-label="Settings"
				>
					{TABS.map((tab) => (
						<TabsTrigger
							key={tab.value}
							value={tab.value}
							className="relative flex-none rounded-none border-0 border-transparent border-b-2 px-2.5 pb-2 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
						>
							{tab.label}
							{counts[tab.value] !== undefined && (
								<span className="ml-1 text-muted-foreground tabular">
									{counts[tab.value]}
								</span>
							)}
							{tabErrors[tab.value] > 0 && (
								<span className="ml-1 rounded-full bg-down px-1.5 text-[10px] text-white tabular">
									<span className="sr-only">, problems: </span>
									{tabErrors[tab.value]}
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

function ComponentPanel() {
	const { experiment, selectedNode, selectNode } = useWorkbench();
	const node = experiment.model.nodes.find((n) => n.id === selectedNode);

	if (!node)
		return (
			<div className="grid gap-4">
				<p className="text-muted-foreground text-sm">
					Select a component on the canvas, or pick one here, to see and change
					its settings.
				</p>
				<ul className="grid gap-1.5">
					{experiment.model.nodes.map((n) => (
						<li key={n.id}>
							<Button
								variant="outline"
								className="w-full justify-start"
								onClick={() => selectNode(n.id)}
							>
								{n.kind === "server" ? (
									<span
										className="size-2.5 rounded-full"
										style={{
											background: serverColor(
												servers(experiment).findIndex((s) => s.id === n.id),
											),
										}}
										aria-hidden="true"
									/>
								) : (
									<Waypoints aria-hidden="true" />
								)}
								{n.label ?? n.id}
								<span className="ml-auto text-muted-foreground text-xs">
									{kindLabel(n.kind)}
								</span>
							</Button>
						</li>
					))}
				</ul>
				<ConnectionNote />
			</div>
		);

	return (
		<div className="grid gap-6">
			<div className="flex items-center justify-between gap-2">
				<div>
					<p className="text-muted-foreground text-xs">
						{kindLabel(node.kind)}
					</p>
					<h2 className="font-semibold">{node.label ?? node.id}</h2>
				</div>
				<Button variant="ghost" size="sm" onClick={() => selectNode(null)}>
					All components
				</Button>
			</div>
			<LabelField id={node.id} label={node.label ?? ""} />
			{node.kind === "client" && <ClientSettings />}
			{node.kind === "load-balancer" && <LoadBalancerSettings />}
			{node.kind === "server" && <ServerSettings server={node} />}
		</div>
	);
}

function kindLabel(kind: string) {
	return kind === "load-balancer"
		? "Load balancer"
		: kind === "client"
			? "Client"
			: "Server";
}

function ConnectionNote() {
	return (
		<p className="rounded-md border bg-muted/50 p-3 text-muted-foreground text-xs">
			Connections are fixed in v0.1: the client sends to the load balancer, and
			the load balancer sends to every server in round-robin order.
		</p>
	);
}

function LabelField({ id, label }: { id: string; label: string }) {
	const { update } = useWorkbench();
	return (
		<TextField
			label="Name"
			value={label}
			maxLength={40}
			placeholder={id}
			onChange={(v) => update((e) => setLabel(e, id, v), `label:${id}`)}
			help={`Display name only. The id ${id} is what faults and exports refer to.`}
		/>
	);
}

function ClientSettings() {
	const { setInspectorTab, experiment } = useWorkbench();
	return (
		<div className="grid gap-3 text-sm">
			<p className="text-muted-foreground">
				The client sends {experiment.workload.offeredRps} req/s for{" "}
				{formatMs(experiment.workload.durationMs)} and gives up on a request
				after {formatMs(experiment.workload.timeoutMs)}.
			</p>
			<Button variant="outline" onClick={() => setInspectorTab("traffic")}>
				Edit traffic
			</Button>
		</div>
	);
}

function LoadBalancerSettings() {
	const { experiment, update, validation } = useWorkbench();
	const lb = loadBalancer(experiment);
	if (!lb) return null;
	const i = nodeIndex(experiment, lb.id);
	const hc = lb.config.healthCheck;
	const err = (f: string) =>
		validation.byPath.get(`model.nodes[${i}].config.healthCheck.${f}`);
	const minDetect = (hc.unhealthyThreshold - 1) * hc.intervalMs;
	const maxDetect = hc.unhealthyThreshold * hc.intervalMs;

	return (
		<div className="grid gap-6">
			<div className="grid gap-1 text-sm">
				<span className="font-medium">Algorithm</span>
				<span className="text-muted-foreground">
					Round robin: each request goes to the next backend in rotation. It is
					the only algorithm modeled in v0.1.
				</span>
			</div>
			<FieldGroup title="Failure detection">
				<SwitchField
					info={HEALTH_CHECK_FIELDS.enabled}
					checked={hc.enabled}
					onChange={(enabled) =>
						update((e) => updateHealthCheck(e, { enabled }))
					}
				/>
				{hc.enabled ? (
					<>
						<NumberField
							info={HEALTH_CHECK_FIELDS.intervalMs}
							value={hc.intervalMs}
							integer
							min={100}
							step={500}
							showSeconds
							errors={err("intervalMs")}
							onChange={(v) =>
								v !== null &&
								update(
									(e) => updateHealthCheck(e, { intervalMs: v }),
									"hc.interval",
								)
							}
						/>
						<NumberField
							info={HEALTH_CHECK_FIELDS.unhealthyThreshold}
							value={hc.unhealthyThreshold}
							integer
							min={1}
							errors={err("unhealthyThreshold")}
							onChange={(v) =>
								v !== null &&
								update(
									(e) => updateHealthCheck(e, { unhealthyThreshold: v }),
									"hc.unhealthy",
								)
							}
						/>
						<NumberField
							info={HEALTH_CHECK_FIELDS.healthyThreshold}
							value={hc.healthyThreshold}
							integer
							min={1}
							errors={err("healthyThreshold")}
							onChange={(v) =>
								v !== null &&
								update(
									(e) => updateHealthCheck(e, { healthyThreshold: v }),
									"hc.healthy",
								)
							}
						/>
						<NumberField
							info={HEALTH_CHECK_FIELDS.probeTimeoutMs}
							value={hc.probeTimeoutMs}
							integer
							min={10}
							step={100}
							errors={err("probeTimeoutMs")}
							onChange={(v) =>
								v !== null &&
								update(
									(e) => updateHealthCheck(e, { probeTimeoutMs: v }),
									"hc.timeout",
								)
							}
						/>
						<p className="rounded-md bg-gap-soft p-3 text-xs leading-relaxed">
							<span className="font-medium">Expected detection delay.</span> A
							server that refuses connections is noticed {formatMs(minDetect)}{" "}
							to {formatMs(maxDetect)} after it crashes, depending on where in
							the probe cycle the crash lands. A hanging server takes up to{" "}
							{formatMs(hc.probeTimeoutMs)} longer, because each probe waits for
							its timeout.
						</p>
					</>
				) : (
					<p className="rounded-md bg-gap-soft p-3 text-xs leading-relaxed">
						Without health checks the load balancer cannot notice a dead
						backend. Every request it sends there fails until the server comes
						back.
					</p>
				)}
			</FieldGroup>
			<ConnectionNote />
		</div>
	);
}

function ServerSettings({ server }: { server: ServerNode }) {
	const { experiment, update, validation, selectNode, setInspectorTab } =
		useWorkbench();
	const i = nodeIndex(experiment, server.id);
	const err = (f: string) =>
		validation.byPath.get(`model.nodes[${i}].config.${f}`);
	const c = server.config;
	const maxRps = (c.capacity * 1000) / c.serviceTimeMs;
	const faults = experiment.faults.filter((f) => f.target === server.id);
	const onlyServer = servers(experiment).length <= 1;

	const remove = () => {
		const { experiment: next, removedFaults } = removeServer(
			experiment,
			server.id,
		);
		update(() => next);
		selectNode(null);
		toast(`Removed ${server.label ?? server.id}`, {
			description: removedFaults
				? `Also removed ${removedFaults} fault${removedFaults === 1 ? "" : "s"} that targeted it. Undo with Ctrl+Z.`
				: "Undo with Ctrl+Z.",
		});
	};

	return (
		<div className="grid gap-6">
			<FieldGroup title="Capacity">
				<NumberField
					info={SERVER_FIELDS.capacity}
					value={c.capacity}
					integer
					min={1}
					errors={err("capacity")}
					onChange={(v) =>
						v !== null &&
						update(
							(e) => updateServerConfig(e, server.id, { capacity: v }),
							`cap:${server.id}`,
						)
					}
				/>
				<NumberField
					info={SERVER_FIELDS.serviceTimeMs}
					value={c.serviceTimeMs}
					min={1}
					step={10}
					errors={err("serviceTimeMs")}
					onChange={(v) =>
						v !== null &&
						update(
							(e) => updateServerConfig(e, server.id, { serviceTimeMs: v }),
							`svc:${server.id}`,
						)
					}
				/>
				<SelectField
					info={SERVER_FIELDS.serviceTimeDistribution}
					value={c.serviceTimeDistribution}
					options={DISTRIBUTION_LABELS}
					onChange={(v) =>
						update((e) =>
							updateServerConfig(e, server.id, { serviceTimeDistribution: v }),
						)
					}
				/>
				<NumberField
					info={SERVER_FIELDS.queueCapacity}
					value={c.queueCapacity}
					integer
					min={0}
					step={10}
					errors={err("queueCapacity")}
					onChange={(v) =>
						v !== null &&
						update(
							(e) => updateServerConfig(e, server.id, { queueCapacity: v }),
							`queue:${server.id}`,
						)
					}
				/>
				{Number.isFinite(maxRps) && maxRps > 0 && (
					<p className="rounded-md bg-muted p-3 text-xs leading-relaxed">
						At most about{" "}
						<span className="font-medium tabular">
							{formatCount(maxRps)} req/s
						</span>{" "}
						({c.capacity} slots ÷ {formatMs(c.serviceTimeMs)}
						{c.serviceTimeDistribution === "exponential" ? " on average" : ""}).
						More than that and the queue grows.
					</p>
				)}
			</FieldGroup>

			<div className="grid gap-2">
				<h3 className="font-semibold text-sm">Faults on this server</h3>
				{faults.length === 0 ? (
					<p className="text-muted-foreground text-sm">None scheduled.</p>
				) : (
					<ul className="grid gap-1 text-sm">
						{faults.map((f) => (
							<li key={f.id} className="text-muted-foreground">
								Fails at {formatMs(f.atMs)}
								{f.recoverAtMs === null
									? ", never recovers"
									: `, recovers at ${formatMs(f.recoverAtMs)}`}{" "}
								({BEHAVIOR_LABELS[f.behavior].toLowerCase()})
							</li>
						))}
					</ul>
				)}
				<Button
					variant="outline"
					size="sm"
					className="w-fit"
					onClick={() => setInspectorTab("faults")}
				>
					Edit faults
				</Button>
			</div>

			<div className="border-t pt-4">
				<Button
					variant="outline"
					className="text-down"
					onClick={remove}
					disabled={onlyServer}
				>
					<Trash2 aria-hidden="true" />
					Remove server
				</Button>
				{onlyServer && (
					<p className="mt-2 text-muted-foreground text-xs">
						An experiment needs at least one server.
					</p>
				)}
			</div>
		</div>
	);
}

function TrafficPanel() {
	const { experiment, update, validation } = useWorkbench();
	const w = experiment.workload;
	const err = (f: string) => validation.byPath.get(`workload.${f}`);
	const setWorkload = (patch: Partial<Experiment["workload"]>, key?: string) =>
		update((e) => ({ ...e, workload: { ...e.workload, ...patch } }), key);
	const offered = estimateOfferedRequests(experiment);
	const totalCapacity = servers(experiment).reduce(
		(sum, s) => sum + (s.config.capacity * 1000) / s.config.serviceTimeMs,
		0,
	);
	const load = totalCapacity > 0 ? w.offeredRps / totalCapacity : 0;

	return (
		<div className="grid gap-6">
			<FieldGroup title="Steady traffic">
				<SelectField
					info={WORKLOAD_FIELDS.arrival}
					value={w.arrival}
					options={ARRIVAL_LABELS}
					onChange={(arrival) => setWorkload({ arrival })}
				/>
				<NumberField
					info={WORKLOAD_FIELDS.offeredRps}
					value={w.offeredRps}
					min={1}
					step={10}
					errors={err("offeredRps")}
					onChange={(v) => v !== null && setWorkload({ offeredRps: v }, "rps")}
				/>
				<NumberField
					info={WORKLOAD_FIELDS.durationMs}
					value={w.durationMs}
					integer
					min={1}
					step={1000}
					showSeconds
					errors={err("durationMs")}
					onChange={(v) =>
						v !== null && setWorkload({ durationMs: v }, "duration")
					}
				/>
				<NumberField
					info={WORKLOAD_FIELDS.startMs}
					value={w.startMs}
					integer
					min={0}
					step={1000}
					showSeconds
					errors={err("startMs")}
					onChange={(v) => v !== null && setWorkload({ startMs: v }, "start")}
				/>
				<NumberField
					info={WORKLOAD_FIELDS.timeoutMs}
					value={w.timeoutMs}
					integer
					min={1}
					step={100}
					showSeconds
					errors={err("timeoutMs")}
					onChange={(v) =>
						v !== null && setWorkload({ timeoutMs: v }, "timeout")
					}
				/>
				<p className="rounded-md bg-muted p-3 text-xs leading-relaxed">
					About{" "}
					<span className="font-medium tabular">{formatCount(offered)}</span>{" "}
					requests in total
					{w.arrival === "poisson" ? " on average" : ""}. All servers together
					finish about{" "}
					<span className="tabular">{formatCount(totalCapacity)} req/s</span>,
					so steady traffic uses{" "}
					<span className="font-medium tabular">{Math.round(load * 100)}%</span>{" "}
					of capacity while every server is up.
				</p>
			</FieldGroup>

			<FieldGroup
				title="Bursts"
				description="Extra traffic on top of the steady rate for a while."
			>
				{w.bursts.length === 0 && (
					<p className="text-muted-foreground text-sm">No bursts.</p>
				)}
				{w.bursts.map((b, i) => (
					<div
						key={`burst-${i.toString()}`}
						className="grid gap-3 rounded-md border p-3"
					>
						<div className="flex items-center justify-between">
							<h4 className="font-medium text-sm">Burst {i + 1}</h4>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Remove burst ${i + 1}`}
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
								info={BURST_FIELDS[field]}
								value={b[field]}
								integer={field !== "extraRps"}
								min={field === "atMs" ? 0 : 1}
								step={field === "extraRps" ? 10 : 1000}
								showSeconds={field !== "extraRps"}
								errors={err(`bursts[${i}].${field}`)}
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
					Add burst
				</Button>
			</FieldGroup>
		</div>
	);
}

function FaultsPanel() {
	const { experiment, update, validation } = useWorkbench();
	const serverList = servers(experiment);
	const serverOptions = Object.fromEntries(
		serverList.map((s) => [s.id, s.label ?? s.id]),
	) as Record<string, string>;
	const err = (i: number, f: string) =>
		validation.byPath.get(`faults[${i}].${f}`);

	return (
		<div className="grid gap-4">
			<p className="text-muted-foreground text-sm">
				A fault crashes one server at a simulated time. In-flight work on it is
				lost; recovery brings it back with an empty queue.
			</p>
			{experiment.faults.length === 0 && (
				<p className="rounded-md border border-dashed p-4 text-center text-muted-foreground text-sm">
					No faults. Without one, this experiment is a healthy reference run.
				</p>
			)}
			{experiment.faults.map((f, i) => (
				<div
					key={`${f.id}-${i.toString()}`}
					className="grid gap-3 rounded-md border p-3"
				>
					<div className="flex items-center justify-between gap-2">
						<h3 className="flex items-center gap-2 font-medium font-mono text-sm">
							<Server
								className="size-4 text-muted-foreground"
								aria-hidden="true"
							/>
							{f.id}
						</h3>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`Remove fault ${f.id}`}
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
					<SelectField
						info={FAULT_FIELDS.target}
						value={f.target}
						options={serverOptions}
						errors={err(i, "target")}
						onChange={(target) => update((e) => updateFault(e, i, { target }))}
					/>
					<NumberField
						info={FAULT_FIELDS.atMs}
						value={f.atMs}
						integer
						min={0}
						step={1000}
						showSeconds
						errors={err(i, "atMs")}
						onChange={(v) =>
							v !== null &&
							update((e) => updateFault(e, i, { atMs: v }), `fault:${i}:at`)
						}
					/>
					<NumberField
						info={FAULT_FIELDS.recoverAtMs}
						value={f.recoverAtMs}
						nullable
						nullLabel="never"
						integer
						min={1}
						step={1000}
						showSeconds
						errors={err(i, "recoverAtMs")}
						onChange={(v) =>
							update(
								(e) => updateFault(e, i, { recoverAtMs: v }),
								`fault:${i}:recover`,
							)
						}
					/>
					<SelectField
						info={FAULT_FIELDS.behavior}
						value={f.behavior}
						options={BEHAVIOR_LABELS}
						onChange={(behavior) =>
							update((e) => updateFault(e, i, { behavior }))
						}
					/>
				</div>
			))}
			<Button
				variant="outline"
				className="w-fit"
				disabled={
					experiment.faults.length >= LIMITS.maxFaults ||
					serverList.length === 0
				}
				onClick={() => update((e) => addFault(e).experiment)}
			>
				<Plus aria-hidden="true" />
				Add fault
			</Button>
		</div>
	);
}

function RunPanel() {
	const { experiment, update, validation } = useWorkbench();
	return (
		<div className="grid gap-6">
			<FieldGroup title="Reproducibility">
				<NumberField
					info={RUN_FIELDS.seed}
					value={experiment.seed}
					integer
					min={0}
					errors={validation.byPath.get("seed")}
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
					Try another seed
				</Button>
				<p className="text-muted-foreground text-xs">
					The seed only matters with Poisson arrivals or exponential service
					times. With constant traffic and fixed service times every seed gives
					the same result.
				</p>
			</FieldGroup>
			<FieldGroup title="Time">
				<NumberField
					info={{
						...RUN_FIELDS.horizonMs,
						help: `${RUN_FIELDS.horizonMs.help} Leave empty for auto (${formatMs(effectiveHorizonMs({ ...experiment, run: { ...experiment.run, horizonMs: undefined } }))}).`,
					}}
					value={experiment.run.horizonMs ?? null}
					nullable
					nullLabel="auto"
					integer
					min={1}
					step={1000}
					showSeconds
					errors={validation.byPath.get("run.horizonMs")}
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
					info={RUN_FIELDS.sampleWindowMs}
					value={experiment.run.sampleWindowMs}
					integer
					min={100}
					step={250}
					errors={validation.byPath.get("run.sampleWindowMs")}
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
	const { experiment, update, validation } = useWorkbench();
	return (
		<div className="grid gap-5">
			<TextField
				label="Title"
				value={experiment.title}
				maxLength={120}
				errors={validation.byPath.get("title")}
				onChange={(title) => update((e) => ({ ...e, title }), "title")}
			/>
			<TextField
				label="Question"
				multiline
				value={experiment.question}
				maxLength={300}
				help="The one thing this experiment should answer."
				onChange={(question) => update((e) => ({ ...e, question }), "question")}
			/>
			<TextField
				label="Description"
				multiline
				value={experiment.description}
				maxLength={2000}
				onChange={(description) =>
					update((e) => ({ ...e, description }), "description")
				}
			/>
			<LinesField
				label="Expected observations"
				help="Teaching hypotheses, one per line. They are shown next to results but never computed or checked automatically."
				value={experiment.expectedObservations}
				onChange={(expectedObservations) =>
					update((e) => ({ ...e, expectedObservations }), "expected")
				}
			/>
			<LinesField
				label="Assumptions"
				help="Simplifications this model makes, one per line. They are exported with every result."
				value={experiment.assumptions}
				onChange={(assumptions) =>
					update((e) => ({ ...e, assumptions }), "assumptions")
				}
			/>
			<p className="font-mono text-muted-foreground text-xs">
				id {experiment.experimentId} · schema {experiment.schemaVersion}
			</p>
		</div>
	);
}

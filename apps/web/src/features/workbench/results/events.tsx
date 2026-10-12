import { EVENT_KINDS, type SimEventKind } from "@faultworks/engine";
import {
	type EventLogData,
	type EventRow,
	readEventRow,
} from "@faultworks/metrics";
import { Search } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { formatClock, formatCount, formatLatency } from "#/lib/format.ts";
import { seriesColor } from "#/lib/nodes.ts";
import { cn } from "#/lib/utils.ts";
import type { RunResult } from "#/workers/protocol.ts";
import { orderedWorkers } from "../layers.ts";
import { usePlayback } from "../playback-store.ts";

type Filter = "changes" | "failures" | "calls" | "late" | "all";

const FILTERS: Record<Filter, SimEventKind[]> = {
	changes: [
		"node-down",
		"node-up",
		"fault-start",
		"fault-end",
		"health-changed",
		"probe",
		"breaker",
	],
	failures: ["failed"],
	calls: ["call-start", "call-end", "routed"],
	late: ["late-response"],
	all: [...EVENT_KINDS],
};

const ROW_HEIGHT = 34;
const VIEW_HEIGHT = 440;

/**
 * The full event trace, filterable and virtualized. Entering a request id shows its complete
 * lifecycle across every hop; clicking a row moves the replay to that moment.
 */
export function EventsTable({ result }: { result: RunResult }) {
	const { t } = useTranslation();
	const log = result.log as EventLogData;
	const [filter, setFilter] = useState<Filter>("changes");
	const [node, setNode] = useState<string>("all");
	const [reqText, setReqText] = useState("");
	const [scrollTop, setScrollTop] = useState(0);
	const scroller = useRef<HTMLDivElement>(null);
	const setTime = usePlayback((s) => s.setTime);
	const filterId = useId();
	const nodeId = useId();
	const reqId = useId();
	const { nodeIds, nodeLabels, linkIds } = result.topology;
	const workersList = useMemo(
		() => orderedWorkers(result.experiment),
		[result],
	);
	const colorOf = (nodeIndex: number) => {
		const wi = workersList.findIndex((w) => w.id === nodeIds[nodeIndex]);
		return wi >= 0 ? seriesColor(wi) : "var(--muted-foreground)";
	};

	const req = reqText.trim() === "" ? null : Number(reqText);
	const reqValid = req === null || (Number.isInteger(req) && req >= 0);

	const indexes = useMemo(() => {
		const kinds = new Set(
			(req !== null ? FILTERS.all : FILTERS[filter]).map((k) =>
				EVENT_KINDS.indexOf(k),
			),
		);
		const nodeIndex = node === "all" ? null : Number(node);
		const out: number[] = [];
		for (let i = 0; i < log.length; i++) {
			if (!kinds.has(log.kind[i] as number)) continue;
			if (nodeIndex !== null) {
				const edge = log.edge[i] as number;
				const link = edge === -1 ? null : result.experiment.model.links[edge];
				const touches =
					log.node[i] === nodeIndex ||
					(link !== undefined &&
						link !== null &&
						(nodeIds.indexOf(link.target) === nodeIndex ||
							nodeIds.indexOf(link.source) === nodeIndex));
				if (!touches) continue;
			}
			if (req !== null && log.req[i] !== req) continue;
			out.push(i);
		}
		return out;
	}, [log, filter, node, req, result, nodeIds]);

	const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
	const last = Math.min(
		indexes.length,
		Math.ceil((scrollTop + VIEW_HEIGHT) / ROW_HEIGHT) + 10,
	);
	const visible = indexes.slice(first, last).map((i) => readEventRow(log, i));

	const describe = (row: EventRow): string => {
		const link =
			row.edge === null ? null : result.experiment.model.links[row.edge];
		const linkText = link
			? `${nodeLabels[nodeIds.indexOf(link.source)]} → ${nodeLabels[nodeIds.indexOf(link.target)]}`
			: "";
		switch (row.kind) {
			case "failed":
				return t("events.detail.failed", {
					reason: row.reason ? t(`reasons.${row.reason}.label`) : "",
					latency: formatLatency(row.durationMs),
				});
			case "succeeded":
				return t("events.detail.succeeded", {
					latency: formatLatency(row.durationMs),
				});
			case "call-start":
				return `${linkText}${row.attempt && row.attempt > 1 ? ` · ${t("events.detail.attempt", { n: row.attempt })}` : ""}`;
			case "call-end":
				return `${linkText} · ${row.flag ? t("events.detail.ok") : t(`reasons.${row.reason}.label`)} · ${formatLatency(row.durationMs)}`;
			case "routed":
				return t("events.detail.routed", {
					to: nodeLabels[row.via ?? -1] ?? "",
				});
			case "service-start":
				return `${
					row.durationMs
						? t("events.detail.waited", {
								latency: formatLatency(row.durationMs),
							})
						: t("events.detail.noWait")
				}${row.workMs ? ` · ${t("events.detail.work", { latency: formatLatency(row.workMs) })}` : ""}`;
			case "abandoned":
				return row.reason === "queue-timeout"
					? t("events.detail.abandonedQueue")
					: t("events.detail.abandonedDeadline");
			case "promoted":
				return t("events.detail.promoted", {
					from: nodeLabels[row.fromNode ?? -1] ?? "",
					to: nodeLabels[row.via ?? -1] ?? "",
				});
			case "job-start":
				return row.durationMs
					? t("events.detail.waited", {
							latency: formatLatency(row.durationMs),
						})
					: t("events.detail.noWait");
			case "enqueued":
				return t("events.detail.depth", { depth: row.depth });
			case "evicted":
				return row.from === "queue"
					? t("events.detail.evictedQueue")
					: t("events.detail.evictedService");
			case "cache-hit":
				return row.flag ? t("events.detail.hit") : t("events.detail.miss");
			case "job-done":
				return row.flag ? t("events.detail.ok") : t("events.detail.jobFailed");
			case "probe":
				return `${row.flag ? t("events.detail.ok") : t("events.detail.probeFailed")} · ${nodeLabels[row.via ?? -1] ?? ""}`;
			case "health-changed":
				return row.flag
					? t("events.detail.backInRotation")
					: t("events.detail.removedFromRotation");
			case "breaker":
				return `${linkText} · ${t(`breaker.${row.breakerState}`)}`;
			case "node-down":
			case "node-up":
			case "fault-start":
			case "fault-end": {
				const fault =
					row.fault === null ? null : result.experiment.faults[row.fault];
				return fault
					? `${t(`faultKinds.${fault.kind}.label`)} (${fault.id})`
					: "";
			}
			default:
				return "";
		}
	};

	const tone = (row: EventRow) =>
		row.kind === "failed" ||
		row.kind === "node-down" ||
		row.kind === "fault-start" ||
		(row.kind === "breaker" && row.breakerState === "open")
			? "text-down"
			: row.kind === "health-changed"
				? row.flag
					? "text-ok"
					: "text-gap"
				: row.kind === "succeeded" ||
						row.kind === "node-up" ||
						row.kind === "fault-end" ||
						(row.kind === "breaker" && row.breakerState === "closed")
					? "text-ok"
					: "";

	return (
		<div className="grid min-w-0 grid-cols-1 gap-3">
			<div className="flex flex-wrap items-end gap-3">
				<div className="grid gap-1">
					<Label htmlFor={filterId} className="text-xs">
						{t("events.show")}
					</Label>
					<Select
						value={filter}
						onValueChange={(v) => setFilter(v as Filter)}
						disabled={req !== null}
					>
						<SelectTrigger id={filterId} className="w-44">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(Object.keys(FILTERS) as Filter[]).map((f) => (
								<SelectItem key={f} value={f}>
									{t(`events.filters.${f}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-1">
					<Label htmlFor={nodeId} className="text-xs">
						{t("events.component")}
					</Label>
					<Select value={node} onValueChange={setNode}>
						<SelectTrigger id={nodeId} className="w-44">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">{t("events.allComponents")}</SelectItem>
							{nodeIds.map((id, i) => (
								<SelectItem key={id} value={String(i)}>
									{nodeLabels[i]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-1">
					<Label htmlFor={reqId} className="text-xs">
						{t("events.traceRequest")}
					</Label>
					<div className="relative">
						<Search
							className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
							aria-hidden="true"
						/>
						<Input
							id={reqId}
							inputMode="numeric"
							value={reqText}
							onChange={(e) => {
								setReqText(e.target.value);
								scroller.current?.scrollTo({ top: 0 });
							}}
							placeholder={t("events.tracePlaceholder")}
							className="w-36 pl-8"
							aria-invalid={!reqValid}
						/>
					</div>
				</div>
				<p className="ml-auto text-muted-foreground text-xs" aria-live="polite">
					{reqValid
						? t("events.count", {
								count: indexes.length,
								formatted: formatCount(indexes.length),
							})
						: t("events.wholeNumber")}
				</p>
			</div>

			{log.truncated && (
				<p className="rounded-md bg-gap-soft p-2 text-xs">
					{t("events.truncated")}
				</p>
			)}

			<div className="overflow-hidden rounded-lg border">
				<div
					className="grid grid-cols-[6.5rem_11rem_8rem_1fr] gap-2 border-b bg-muted/50 px-3 py-2 font-medium text-muted-foreground text-xs max-sm:grid-cols-[5.5rem_1fr]"
					aria-hidden="true"
				>
					<span>{t("events.time")}</span>
					<span>{t("events.event")}</span>
					<span className="max-sm:hidden">{t("events.component")}</span>
					<span className="max-sm:hidden">{t("events.detailColumn")}</span>
				</div>
				<div
					ref={scroller}
					className="relative overflow-y-auto"
					style={{
						height: Math.min(
							VIEW_HEIGHT,
							Math.max(ROW_HEIGHT * 3, indexes.length * ROW_HEIGHT),
						),
					}}
					onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
				>
					{indexes.length === 0 ? (
						<p className="p-6 text-center text-muted-foreground text-sm">
							{req !== null
								? t("events.noRequest", { req: reqText })
								: t("events.noEvents")}
						</p>
					) : (
						<ol
							aria-label={t("events.list")}
							className="relative"
							style={{ height: indexes.length * ROW_HEIGHT }}
						>
							{visible.map((row, k) => {
								const label = row.node === null ? null : nodeLabels[row.node];
								return (
									<li
										key={row.index}
										className="absolute inset-x-0"
										style={{
											top: (first + k) * ROW_HEIGHT,
											height: ROW_HEIGHT,
										}}
									>
										<button
											type="button"
											onClick={() => setTime(row.tMs)}
											className="grid h-full w-full grid-cols-[6.5rem_11rem_8rem_1fr] items-center gap-2 border-b px-3 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none max-sm:grid-cols-[5.5rem_1fr]"
											title={t("events.jump")}
										>
											<span className="font-mono tabular">
												{formatClock(row.tMs)}
											</span>
											<span className={cn("truncate font-medium", tone(row))}>
												{t(`events.kinds.${row.kind}`)}
												{row.req !== null && (
													<span className="ml-1 font-mono font-normal text-muted-foreground">
														#{row.req}
													</span>
												)}
											</span>
											<span className="flex items-center gap-1.5 truncate max-sm:hidden">
												{label && (
													<span
														className="size-2 shrink-0 rounded-full"
														style={{ background: colorOf(row.node as number) }}
														aria-hidden="true"
													/>
												)}
												{label ?? (
													<span className="text-muted-foreground">–</span>
												)}
											</span>
											<span className="truncate text-muted-foreground max-sm:hidden">
												{describe(row)}
											</span>
										</button>
									</li>
								);
							})}
						</ol>
					)}
				</div>
			</div>
			<p className="text-muted-foreground text-xs">
				{t("events.ordering", { links: linkIds.length })}
			</p>
		</div>
	);
}

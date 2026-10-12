import { EVENT_KINDS, type SimEventKind } from "@faultworks/engine";
import {
	type EventLogData,
	type EventRow,
	FAILURE_REASON_INFO,
	readEventRow,
} from "@faultworks/metrics";
import { Search } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
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
import { serverColor } from "#/lib/series.ts";
import { cn } from "#/lib/utils.ts";
import type { RunResult } from "#/workers/protocol.ts";
import { usePlayback } from "../playback-store.ts";

type Filter = "changes" | "failures" | "late" | "all";

const FILTERS: Record<Filter, { label: string; kinds: SimEventKind[] }> = {
	changes: {
		label: "State changes",
		kinds: ["node-down", "node-up", "health-changed", "probe"],
	},
	failures: { label: "Failed requests", kinds: ["failed"] },
	late: { label: "Late responses", kinds: ["late-response"] },
	all: { label: "All events", kinds: [...EVENT_KINDS] },
};

const KIND_LABEL: Record<SimEventKind, string> = {
	arrival: "Arrived",
	routed: "Routed",
	enqueued: "Queued",
	"service-start": "Service started",
	"service-end": "Service ended",
	evicted: "Dropped by crash",
	succeeded: "Succeeded",
	failed: "Failed",
	"late-response": "Late response discarded",
	"node-down": "Server crashed",
	"node-up": "Server recovered",
	probe: "Health probe",
	"health-changed": "Health changed",
};

const ROW_HEIGHT = 34;
const VIEW_HEIGHT = 440;

function describe(row: EventRow, result: RunResult): string {
	switch (row.kind) {
		case "failed":
			return `${row.reason ? FAILURE_REASON_INFO[row.reason].label : "Failed"} after ${formatLatency(row.durationMs)}`;
		case "succeeded":
			return `in ${formatLatency(row.durationMs)}`;
		case "service-start":
			return row.durationMs
				? `waited ${formatLatency(row.durationMs)} in queue`
				: "no wait";
		case "enqueued":
			return `queue depth ${row.depth}`;
		case "evicted":
			return row.from === "queue"
				? "was waiting in the queue"
				: "was being served";
		case "probe":
			return row.flag ? "ok" : "failed";
		case "health-changed":
			return row.flag ? "back in rotation" : "removed from rotation";
		case "node-down":
		case "node-up": {
			const fault =
				row.fault === null ? null : result.experiment.faults[row.fault];
			return fault
				? `fault ${fault.id}${row.kind === "node-down" ? `, ${fault.behavior === "refuse" ? "refusing connections" : "hanging"}` : ""}`
				: "";
		}
		default:
			return "";
	}
}

/**
 * The full event trace, filterable and virtualized. Selecting a request id shows its complete
 * lifecycle; clicking a row moves the replay to that moment.
 */
export function EventsTable({ result }: { result: RunResult }) {
	const log = result.log as EventLogData;
	const [filter, setFilter] = useState<Filter>("changes");
	const [server, setServer] = useState<string>("all");
	const [reqText, setReqText] = useState("");
	const [scrollTop, setScrollTop] = useState(0);
	const scroller = useRef<HTMLDivElement>(null);
	const setTime = usePlayback((s) => s.setTime);
	const filterId = useId();
	const serverId = useId();
	const reqId = useId();

	const req = reqText.trim() === "" ? null : Number(reqText);
	const reqValid = req === null || (Number.isInteger(req) && req >= 0);

	const indexes = useMemo(() => {
		const kinds = new Set(
			(req !== null ? FILTERS.all : FILTERS[filter]).kinds.map((k) =>
				EVENT_KINDS.indexOf(k),
			),
		);
		const serverIndex = server === "all" ? null : Number(server);
		const out: number[] = [];
		for (let i = 0; i < log.length; i++) {
			if (!kinds.has(log.kind[i] as number)) continue;
			if (serverIndex !== null && log.server[i] !== serverIndex) continue;
			if (req !== null && log.req[i] !== req) continue;
			out.push(i);
		}
		return out;
	}, [log, filter, server, req]);

	const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
	const last = Math.min(
		indexes.length,
		Math.ceil((scrollTop + VIEW_HEIGHT) / ROW_HEIGHT) + 10,
	);
	const visible = indexes.slice(first, last).map((i) => readEventRow(log, i));

	return (
		<div className="grid gap-3">
			<div className="flex flex-wrap items-end gap-3">
				<div className="grid gap-1">
					<Label htmlFor={filterId} className="text-xs">
						Show
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
									{FILTERS[f].label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-1">
					<Label htmlFor={serverId} className="text-xs">
						Server
					</Label>
					<Select value={server} onValueChange={setServer}>
						<SelectTrigger id={serverId} className="w-40">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All servers</SelectItem>
							{result.topology.servers.map((s, i) => (
								<SelectItem key={s.id} value={String(i)}>
									{s.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-1">
					<Label htmlFor={reqId} className="text-xs">
						Trace request #
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
							placeholder="e.g. 2001"
							className="w-36 pl-8"
							aria-invalid={!reqValid}
						/>
					</div>
				</div>
				<p className="ml-auto text-muted-foreground text-xs" aria-live="polite">
					{reqValid
						? `${formatCount(indexes.length)} event${indexes.length === 1 ? "" : "s"}`
						: "Enter a whole request number"}
				</p>
			</div>

			{log.truncated && (
				<p className="rounded-md bg-gap-soft p-2 text-xs">
					This run produced more request events than the table keeps. State
					changes are complete; later request-level events are not listed.
					Metrics are not affected.
				</p>
			)}

			<div className="overflow-hidden rounded-lg border">
				<div
					className="grid grid-cols-[6.5rem_11rem_8rem_1fr] gap-2 border-b bg-muted/50 px-3 py-2 font-medium text-muted-foreground text-xs max-sm:grid-cols-[5.5rem_1fr]"
					aria-hidden="true"
				>
					<span>Time</span>
					<span>Event</span>
					<span className="max-sm:hidden">Server</span>
					<span className="max-sm:hidden">Detail</span>
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
								? `No request #${reqText} in this run.`
								: "No events of this kind in this run."}
						</p>
					) : (
						<ol
							aria-label="Simulation events"
							className="relative"
							style={{ height: indexes.length * ROW_HEIGHT }}
						>
							{visible.map((row, k) => {
								const s =
									row.server === null
										? null
										: result.topology.servers[row.server];
								const tone =
									row.kind === "failed" || row.kind === "node-down"
										? "text-down"
										: row.kind === "health-changed"
											? row.flag
												? "text-ok"
												: "text-gap"
											: row.kind === "succeeded" || row.kind === "node-up"
												? "text-ok"
												: "";
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
											title="Move the replay to this moment"
										>
											<span className="font-mono tabular">
												{formatClock(row.tMs)}
											</span>
											<span className={cn("truncate font-medium", tone)}>
												{KIND_LABEL[row.kind]}
												{row.req !== null && (
													<span className="ml-1 font-mono font-normal text-muted-foreground">
														#{row.req}
													</span>
												)}
											</span>
											<span className="flex items-center gap-1.5 truncate max-sm:hidden">
												{s && (
													<span
														className="size-2 shrink-0 rounded-full"
														style={{ background: serverColor(row.server ?? 0) }}
														aria-hidden="true"
													/>
												)}
												{s?.label ?? (
													<span className="text-muted-foreground">–</span>
												)}
											</span>
											<span className="truncate text-muted-foreground max-sm:hidden">
												{describe(row, result)}
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
				Times are simulated. Events at the same instant are listed in the
				engine’s fixed processing order: faults, probe results, completions,
				timeouts, then arrivals.
			</p>
		</div>
	);
}

import type { FailureReason } from "@faultworks/engine";
import { FAILURE_REASON_INFO, type RunSummary } from "@faultworks/metrics";
import {
	formatCount,
	formatLatency,
	formatMs,
	formatPercent,
} from "#/lib/format.ts";
import { cn } from "#/lib/utils.ts";

function Tile({
	label,
	value,
	detail,
	className,
	children,
}: {
	label: string;
	value: string;
	detail?: React.ReactNode;
	className?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className={cn("min-w-0 rounded-lg border bg-card p-4", className)}>
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className="mt-1">
				<span className="font-semibold text-2xl tracking-tight">{value}</span>
				{detail && (
					<span className="mt-0.5 block text-muted-foreground text-xs">
						{detail}
					</span>
				)}
				{children}
			</dd>
		</div>
	);
}

/**
 * The run in six numbers. Failed requests lead because every v0.1 question is about them; the
 * breakdown by reason sits right under the number so "failed" is never a black box.
 */
export function SummaryTiles({
	summary,
	healthChecks,
}: {
	summary: RunSummary;
	healthChecks: boolean;
}) {
	const reasons = (
		Object.entries(summary.failedByReason) as Array<[FailureReason, number]>
	)
		.filter(([, n]) => n > 0)
		.sort((a, b) => b[1] - a[1]);
	const lat = summary.successLatency;
	const fault = summary.faults[0];
	let detection: { value: string; detail: string };
	if (!fault) detection = { value: "–", detail: "No fault in this run" };
	else if (!healthChecks)
		detection = { value: "Never", detail: "Health checks are off" };
	else if (fault.detectionDelayMs === null)
		detection = {
			value: "Not detected",
			detail:
				fault.recoveredAtMs !== null
					? "Recovered before detection"
					: "Before the run ended",
		};
	else
		detection = {
			value: formatMs(fault.detectionDelayMs),
			detail: `${fault.serverLabel}, crash to removal${summary.faults.length > 1 ? ` (first of ${summary.faults.length} faults)` : ""}`,
		};

	return (
		<dl className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-6">
			<Tile
				label="Failed requests"
				value={formatCount(summary.failed)}
				detail={`${formatPercent(summary.failed, summary.offered)} of offered`}
				className={cn("col-span-2", summary.failed > 0 && "border-down/40")}
			>
				{reasons.length > 0 && (
					<ul
						className="mt-2 flex flex-wrap gap-1.5"
						aria-label="Failures by reason"
					>
						{reasons.map(([reason, n]) => (
							<li
								key={reason}
								className="rounded-md bg-muted px-2 py-0.5 text-xs"
								title={FAILURE_REASON_INFO[reason].description}
							>
								{FAILURE_REASON_INFO[reason].label}{" "}
								<span className="font-medium tabular">{formatCount(n)}</span>
							</li>
						))}
					</ul>
				)}
			</Tile>
			<Tile
				label="Succeeded"
				value={formatCount(summary.succeeded)}
				detail={`${formatPercent(summary.succeeded, summary.offered)} of ${formatCount(summary.offered)} offered`}
			/>
			<Tile
				label="Latency p50 / p95"
				value={
					lat
						? `${formatLatency(lat.p50Ms)} / ${formatLatency(lat.p95Ms)}`
						: "–"
				}
				detail={
					<>
						{lat
							? `successful requests, n = ${formatCount(lat.n)}`
							: "no successful requests"}
						{summary.completedLatency && (
							<span className="block">
								p95 of all ended requests:{" "}
								{formatLatency(summary.completedLatency.p95Ms)}
							</span>
						)}
					</>
				}
			/>
			<Tile
				label="Detection delay"
				value={detection.value}
				detail={detection.detail}
			/>
			<Tile
				label="Still in flight"
				value={formatCount(summary.inFlight)}
				detail={
					summary.inFlight > 0
						? `no outcome at ${formatMs(summary.measuredMs)}; not counted as success or failure`
						: `every request ended by ${formatMs(summary.measuredMs)}`
				}
			/>
		</dl>
	);
}

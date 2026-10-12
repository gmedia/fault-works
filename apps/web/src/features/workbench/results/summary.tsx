import type { FailureReason } from "@faultworks/engine";
import type { RunSummary } from "@faultworks/metrics";
import { useTranslation } from "react-i18next";
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
 * The run in a few numbers. Failed requests lead because every question is about them; the
 * breakdown by reason and by origin sits right under the number so "failed" is never a black box.
 */
export function SummaryTiles({ summary }: { summary: RunSummary }) {
	const { t } = useTranslation();
	const reasons = (
		Object.entries(summary.failedByReason) as Array<[FailureReason, number]>
	)
		.filter(([, n]) => n > 0)
		.sort((a, b) => b[1] - a[1]);
	const lat = summary.successLatency;
	const crash = summary.faults.find((f) => f.kind === "node-failure");
	const origin = summary.failedByOrigin[0];
	const originNode = origin ? summary.nodes[origin.node] : undefined;
	let detection: { value: string; detail: string };
	if (!crash) detection = { value: "–", detail: t("summary.noCrash") };
	else if (!crash.possibleDetectionMs)
		detection = { value: t("summary.never"), detail: t("summary.noChecks") };
	else if (crash.detectionDelayMs === null)
		detection = {
			value: t("summary.notDetected"),
			detail:
				crash.endedAtMs !== null
					? t("summary.recoveredFirst")
					: t("summary.beforeEnd"),
		};
	else
		detection = {
			value: formatMs(crash.detectionDelayMs),
			detail: `${crash.nodeLabel}${crash.possibleDetectionMs.min !== crash.possibleDetectionMs.max ? `. ${t("summary.possible", { min: formatMs(crash.possibleDetectionMs.min), max: formatMs(crash.possibleDetectionMs.max) })}${crash.crashOnProbeTick ? ` ${t("summary.onTick")}` : ""}` : ""}`,
		};

	return (
		<dl className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-6">
			<Tile
				label={t("summary.failed")}
				value={formatCount(summary.failed)}
				detail={t("summary.ofOffered", {
					pct: formatPercent(summary.failed, summary.offered),
				})}
				className={cn("col-span-2", summary.failed > 0 && "border-down/40")}
			>
				{reasons.length > 0 && (
					<ul
						className="mt-2 flex flex-wrap gap-1.5"
						aria-label={t("summary.byReason")}
					>
						{reasons.map(([reason, n]) => (
							<li
								key={reason}
								className="rounded-md bg-muted px-2 py-0.5 text-xs"
								title={t(`reasons.${reason}.description`)}
							>
								{t(`reasons.${reason}.label`)}{" "}
								<span className="font-medium tabular">{formatCount(n)}</span>
							</li>
						))}
					</ul>
				)}
				{originNode && summary.nodes.length > 2 && (
					<span className="mt-2 block text-muted-foreground text-xs">
						{t("summary.origin", {
							node: originNode.label,
							pct: formatPercent(origin?.count ?? 0, summary.failed),
						})}
					</span>
				)}
			</Tile>
			<Tile
				label={t("summary.succeeded")}
				value={formatCount(summary.succeeded)}
				detail={t("summary.ofOfferedCount", {
					pct: formatPercent(summary.succeeded, summary.offered),
					offered: formatCount(summary.offered),
				})}
			/>
			<Tile
				label={t("summary.latency")}
				value={
					lat
						? `${formatLatency(lat.p50Ms)} / ${formatLatency(lat.p95Ms)}`
						: "–"
				}
				detail={
					<>
						{lat
							? t("summary.latencyDetail", { n: formatCount(lat.n) })
							: t("summary.noSuccess")}
						{summary.completedLatency && (
							<span className="block">
								{t("summary.endedP95", {
									value: formatLatency(summary.completedLatency.p95Ms),
								})}
							</span>
						)}
						<span className="mt-1 block">{t("summary.p95Help")}</span>
					</>
				}
			/>
			<Tile
				label={t("summary.detection")}
				value={detection.value}
				detail={detection.detail}
			/>
			<Tile
				label={t("summary.inFlight")}
				value={formatCount(summary.inFlight)}
				detail={
					summary.inFlight > 0
						? t("summary.inFlightSome", { at: formatMs(summary.measuredMs) })
						: t("summary.inFlightNone", { at: formatMs(summary.measuredMs) })
				}
			/>
		</dl>
	);
}

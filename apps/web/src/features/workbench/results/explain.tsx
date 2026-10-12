import { explainRun, type Insight } from "@faultworks/metrics";
import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button.tsx";
import {
	formatCount,
	formatLatency,
	formatMs,
	formatNumber,
} from "#/lib/format.ts";
import { cn } from "#/lib/utils.ts";
import type { RunResult } from "#/workers/protocol.ts";
import { usePlayback } from "../playback-store.ts";

const TONE: Record<Insight["tone"], { Icon: typeof Info; className: string }> =
	{
		good: { Icon: CircleCheck, className: "text-ok" },
		neutral: { Icon: Info, className: "text-muted-foreground" },
		warning: { Icon: TriangleAlert, className: "text-gap" },
		critical: { Icon: OctagonAlert, className: "text-down" },
	};

/** Turns an insight's raw parameters into formatted, translated strings. */
export function useInsightText() {
	const { t } = useTranslation();
	return (insight: Insight) => {
		const p: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(insight.params)) {
			if (v === null || v === undefined) p[k] = null;
			else if (typeof v === "number") {
				if (k.endsWith("Ms")) p[k] = formatMs(v);
				else if (k.endsWith("Pct") || k === "pct") p[k] = formatNumber(v, 1);
				else p[k] = formatCount(v);
			} else if (k === "reason" && typeof v === "string")
				p[k] = t(`reasons.${v}.label`).toLowerCase();
			else if (k === "behavior" && typeof v === "string")
				p[k] = t(`options.fault.behavior.${v}`).toLowerCase();
			else if (k === "others" && typeof v === "string")
				p[k] = v
					.split(",")
					.filter(Boolean)
					.map((pair) => {
						const [r, c] = pair.split(":");
						return `${t(`reasons.${r}.label`).toLowerCase()} ${formatCount(Number(c))}`;
					})
					.join(", ");
			else p[k] = v;
		}
		// Keys that carry latency keep their precision.
		for (const k of ["p50Ms", "p95Ms", "endedP95Ms", "maxWaitMs", "meanWaitMs"])
			if (typeof insight.params[k] === "number")
				p[k] = formatLatency(insight.params[k] as number);
		const title = t(`${insight.key}.title`, p);
		const body = t(`${insight.key}.body`, {
			...p,
			context: contextOf(insight),
		});
		return { title, body };
	};
}

function contextOf(insight: Insight): string | undefined {
	const p = insight.params;
	if (insight.key === "insight.crashDetected")
		return `${p.onTick ? "tick" : "range"}${p.restoredAtMs !== null && p.restoredAtMs !== undefined ? "_restored" : p.recoveredAtMs !== null && p.recoveredAtMs !== undefined ? "_notRestored" : ""}`;
	if (insight.key === "insight.crashUnwatched")
		return p.recoveredAtMs !== null && p.recoveredAtMs !== undefined
			? "recovered"
			: "down";
	if (insight.key === "insight.outcome")
		return (p.inFlight as number) > 0 ? "inflight" : undefined;
	if (insight.key === "insight.failureMix")
		return p.others ? "others" : undefined;
	if (insight.key === "insight.saturated")
		return (p.rejected as number) > 0 ? "rejected" : undefined;
	if (insight.key === "insight.origin") return p.reason ? "reason" : undefined;
	return undefined;
}

/** "Why did this happen", built only from recorded events, next to the author's hypotheses. */
export function Explain({ result }: { result: RunResult }) {
	const { t } = useTranslation();
	const insights = useMemo(() => explainRun(result.metrics.summary), [result]);
	const text = useInsightText();
	const setTime = usePlayback((s) => s.setTime);
	const { expectedObservations, assumptions } = result.experiment;

	return (
		<div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
			<section aria-labelledby="explain-heading">
				<h3 id="explain-heading" className="font-medium text-sm">
					{t("explain.title")}
				</h3>
				<p className="mt-1 text-muted-foreground text-xs">
					{t("explain.intro")}
				</p>
				<ul className="mt-3 grid gap-3">
					{insights.map((insight) => {
						const tone = TONE[insight.tone];
						const { title, body } = text(insight);
						return (
							<li
								key={insight.id}
								className="flex gap-3 rounded-lg border bg-card p-4"
							>
								<tone.Icon
									className={cn("mt-0.5 size-4 shrink-0", tone.className)}
									aria-hidden="true"
								/>
								<div className="min-w-0">
									<p className="font-medium text-sm">
										<span className="sr-only">
											{t(`explain.tone.${insight.tone}`)}:{" "}
										</span>
										{title}
									</p>
									<p className="mt-1 text-muted-foreground text-sm">{body}</p>
									{insight.atMs !== undefined && (
										<Button
											variant="link"
											size="sm"
											className="mt-1 h-auto p-0"
											onClick={() => setTime(insight.atMs ?? 0)}
										>
											{t("explain.replayFrom", { at: formatMs(insight.atMs) })}
										</Button>
									)}
								</div>
							</li>
						);
					})}
				</ul>
			</section>
			<div className="grid content-start gap-6">
				<section
					aria-labelledby="expected-heading"
					className="rounded-lg border p-4"
				>
					<h3 id="expected-heading" className="font-medium text-sm">
						{t("notes.expected")}
					</h3>
					<p className="mt-1 text-muted-foreground text-xs">
						{t("explain.expectedIntro")}
					</p>
					{expectedObservations.length === 0 ? (
						<p className="mt-3 text-muted-foreground text-sm">
							{t("explain.noExpected")}
						</p>
					) : (
						<ul className="mt-3 grid list-disc gap-2 pl-4 text-sm">
							{expectedObservations.map((o) => (
								<li key={o}>{o}</li>
							))}
						</ul>
					)}
				</section>
				<section
					aria-labelledby="assumptions-heading"
					className="rounded-lg border p-4"
				>
					<h3 id="assumptions-heading" className="font-medium text-sm">
						{t("explain.assumptions", { count: assumptions.length })}
					</h3>
					<ul className="mt-3 grid list-disc gap-2 pl-4 text-muted-foreground text-sm">
						{assumptions.map((a) => (
							<li key={a}>{a}</li>
						))}
					</ul>
				</section>
			</div>
		</div>
	);
}

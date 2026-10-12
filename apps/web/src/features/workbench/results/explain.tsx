import { explainRun, type Insight } from "@faultworks/metrics";
import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { Button } from "#/components/ui/button.tsx";
import { formatMs } from "#/lib/format.ts";
import { cn } from "#/lib/utils.ts";
import type { RunResult } from "#/workers/protocol.ts";
import { usePlayback } from "../playback-store.ts";

const TONE: Record<
	Insight["tone"],
	{ Icon: typeof Info; className: string; label: string }
> = {
	good: { Icon: CircleCheck, className: "text-ok", label: "Good" },
	neutral: { Icon: Info, className: "text-muted-foreground", label: "Note" },
	warning: { Icon: TriangleAlert, className: "text-gap", label: "Watch" },
	critical: { Icon: OctagonAlert, className: "text-down", label: "Problem" },
};

/** "Why did this happen", built only from recorded events, next to the author's hypotheses. */
export function Explain({ result }: { result: RunResult }) {
	const insights = useMemo(
		() => explainRun(result.metrics.summary, result.healthChecks),
		[result],
	);
	const setTime = usePlayback((s) => s.setTime);
	const { expectedObservations, assumptions } = result.experiment;

	return (
		<div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
			<section aria-labelledby="explain-heading">
				<h3 id="explain-heading" className="font-medium text-sm">
					What happened
				</h3>
				<p className="mt-1 text-muted-foreground text-xs">
					Generated from this run’s events and counts. It describes what the
					model did, not why a real system would.
				</p>
				<ul className="mt-3 grid gap-3">
					{insights.map((insight) => {
						const tone = TONE[insight.tone];
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
										<span className="sr-only">{tone.label}: </span>
										{insight.title}
									</p>
									<p className="mt-1 text-muted-foreground text-sm">
										{insight.body}
									</p>
									{insight.atMs !== undefined && (
										<Button
											variant="link"
											size="sm"
											className="mt-1 h-auto p-0"
											onClick={() => setTime(insight.atMs ?? 0)}
										>
											Replay from {formatMs(insight.atMs)}
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
						Expected observations
					</h3>
					<p className="mt-1 text-muted-foreground text-xs">
						Written with the experiment as hypotheses. Check them against the
						results yourself; they are not evaluated automatically.
					</p>
					{expectedObservations.length === 0 ? (
						<p className="mt-3 text-muted-foreground text-sm">
							None written. Add some in the Notes tab.
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
						Model assumptions ({assumptions.length})
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

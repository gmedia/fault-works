import { type Experiment, isWorker } from "@faultworks/experiment";
import type { RunSummary } from "@faultworks/metrics";
import { Dices, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button.tsx";
import { formatCount, formatLatency } from "#/lib/format.ts";
import { sweepInWorker } from "#/workers/client.ts";
import type { SweepPoint } from "#/workers/protocol.ts";

const SEEDS = 10;

/** True when the seed can change results: anything drawn from a random stream. */
export function isStochastic(e: Experiment): boolean {
	return (
		e.workload.arrival === "poisson" ||
		e.model.nodes.some(
			(n) =>
				(isWorker(n) && n.config.serviceTimeDistribution === "exponential") ||
				n.kind === "cache" ||
				(n.kind === "load-balancer" && n.config.algorithm === "random") ||
				(n.kind === "db-cluster" &&
					n.config.writeRatio > 0 &&
					n.config.writeRatio < 1),
		) ||
		e.model.links.some((l) => l.retries > 0 && l.retryJitter) ||
		e.faults.some((f) => f.kind === "error-rate" || f.kind === "link-loss")
	);
}

interface Metric {
	id: string;
	get: (s: RunSummary) => number | null;
	format: (v: number) => string;
	better: "lower" | "higher";
}

const METRICS: Metric[] = [
	{ id: "failed", get: (s) => s.failed, format: formatCount, better: "lower" },
	{
		id: "p95",
		get: (s) => s.successLatency?.p95Ms ?? null,
		format: formatLatency,
		better: "lower",
	},
	{
		id: "succeeded",
		get: (s) => s.succeeded,
		format: formatCount,
		better: "higher",
	},
];

function stats(values: number[]) {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2
			? (sorted[mid] as number)
			: ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
	return { min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0, median };
}

/**
 * Repeats A and B with the same ten seeds (paired), so one lucky seed cannot carry a conclusion.
 * Reports ranges and how often B beat A, not confidence intervals: ten runs are too few for those.
 */
export function SeedSweep({ a, b }: { a: Experiment; b: Experiment }) {
	const { t } = useTranslation();
	const [state, setState] = useState<
		| { status: "idle" }
		| { status: "running" }
		| { status: "done"; a: SweepPoint[]; b: SweepPoint[] }
		| { status: "error"; message: string }
	>({ status: "idle" });
	const random = isStochastic(a) || isStochastic(b);
	const seeds = Array.from({ length: SEEDS }, (_, i) => (a.seed + i) >>> 0);

	const start = async () => {
		setState({ status: "running" });
		try {
			const [ra, rb] = await Promise.all([
				sweepInWorker(a, seeds),
				sweepInWorker(b, seeds),
			]);
			setState({ status: "done", a: ra, b: rb });
		} catch (error) {
			setState({
				status: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	return (
		<section
			aria-labelledby="sweep-heading"
			className="rounded-lg border bg-card p-4 sm:p-5"
		>
			<h2 id="sweep-heading" className="font-semibold">
				{t("sweep.title")}
			</h2>
			{!random ? (
				<p className="mt-2 max-w-prose text-muted-foreground text-sm">
					{t("sweep.deterministic")}
				</p>
			) : (
				<>
					<p className="mt-2 max-w-prose text-muted-foreground text-sm">
						{t("sweep.intro", {
							n: SEEDS,
							from: seeds[0],
							to: seeds[seeds.length - 1],
						})}
					</p>
					<Button
						className="mt-3"
						variant="outline"
						onClick={start}
						disabled={state.status === "running"}
					>
						{state.status === "running" ? (
							<LoaderCircle className="animate-spin" aria-hidden="true" />
						) : (
							<Dices aria-hidden="true" />
						)}
						{t("sweep.run", { n: SEEDS })}
					</Button>
					<div aria-live="polite">
						{state.status === "error" && (
							<p className="mt-3 text-down text-sm">{state.message}</p>
						)}
						{state.status === "done" && (
							<div className="mt-4 overflow-x-auto rounded-md border">
								<table className="w-full text-sm tabular">
									<caption className="sr-only">
										{t("sweep.caption", { n: SEEDS })}
									</caption>
									<thead className="bg-muted/50 text-left text-muted-foreground text-xs">
										<tr>
											<th scope="col" className="px-3 py-2 font-medium">
												{t("compare.metric")}
											</th>
											<th scope="col" className="px-3 py-2 font-medium">
												{t("sweep.colA")}
											</th>
											<th scope="col" className="px-3 py-2 font-medium">
												{t("sweep.colB")}
											</th>
											<th scope="col" className="px-3 py-2 font-medium">
												{t("sweep.bBetter")}
											</th>
										</tr>
									</thead>
									<tbody>
										{METRICS.map((m) => {
											const va = state.a.map((p) => m.get(p.summary));
											const vb = state.b.map((p) => m.get(p.summary));
											const pa = va.filter((v): v is number => v !== null);
											const pb = vb.filter((v): v is number => v !== null);
											const sa = stats(pa);
											const sb = stats(pb);
											let wins = 0;
											let ties = 0;
											va.forEach((x, i) => {
												const y = vb[i];
												if (x === null || y === null || y === undefined) return;
												if (x === y) ties++;
												else if (m.better === "lower" ? y < x : y > x) wins++;
											});
											return (
												<tr key={m.id} className="border-t">
													<th
														scope="row"
														className="px-3 py-2 text-left font-medium"
													>
														{t(`rows.${m.id}`)}
													</th>
													<td className="px-3 py-2">
														{pa.length
															? `${m.format(sa.median)} (${m.format(sa.min)} – ${m.format(sa.max)})`
															: "–"}
													</td>
													<td className="px-3 py-2">
														{pb.length
															? `${m.format(sb.median)} (${m.format(sb.min)} – ${m.format(sb.max)})`
															: "–"}
													</td>
													<td className="px-3 py-2">
														{t("sweep.wins", { wins, n: SEEDS })}
														{ties > 0 && (
															<span className="text-muted-foreground">
																{" "}
																{t("sweep.ties", { ties })}
															</span>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</div>
					<p className="mt-3 text-muted-foreground text-xs">
						{t("sweep.note")}
					</p>
				</>
			)}
		</section>
	);
}

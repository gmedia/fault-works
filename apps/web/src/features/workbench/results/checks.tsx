import { canonicalJson } from "@faultworks/experiment";
import { CircleCheck, CircleX, LoaderCircle, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { formatCount } from "#/lib/format.ts";
import { runInWorker } from "#/workers/client.ts";
import type { RunResult } from "#/workers/protocol.ts";

type Verify =
	| { state: "idle" }
	| { state: "running" }
	| { state: "done"; identical: boolean; digest: string }
	| { state: "error"; message: string };

/** Correctness evidence for this run: invariants, digests, versions and a reproducibility check. */
export function Checks({ result }: { result: RunResult }) {
	const { checks, traceDigest, eventCount } = result.metrics;
	const [verify, setVerify] = useState<Verify>({ state: "idle" });
	const passed = checks.filter((c) => c.passed).length;

	const runVerify = async () => {
		setVerify({ state: "running" });
		try {
			const again = await runInWorker(result.experiment, false);
			const identical =
				again.metrics.traceDigest === traceDigest &&
				canonicalJson(again.metrics.summary) ===
					canonicalJson(result.metrics.summary);
			setVerify({
				state: "done",
				identical,
				digest: again.metrics.traceDigest,
			});
		} catch (error) {
			setVerify({
				state: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};

	return (
		<div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-2">
			<section aria-labelledby="invariants-heading">
				<h3 id="invariants-heading" className="font-medium text-sm">
					Model checks: {passed} of {checks.length} passed
				</h3>
				<p className="mt-1 text-muted-foreground text-xs">
					Checked independently from the event stream after every run. A failure
					here means a bug in the engine, not in your experiment.
				</p>
				<ul className="mt-3 grid gap-2">
					{checks.map((c) => (
						<li key={c.id} className="flex gap-3 rounded-lg border bg-card p-3">
							{c.passed ? (
								<CircleCheck
									className="mt-0.5 size-4 shrink-0 text-ok"
									aria-hidden="true"
								/>
							) : (
								<CircleX
									className="mt-0.5 size-4 shrink-0 text-down"
									aria-hidden="true"
								/>
							)}
							<div>
								<p className="font-medium text-sm">
									<span className="sr-only">
										{c.passed ? "Passed: " : "Failed: "}
									</span>
									{c.label}
								</p>
								<p className="text-muted-foreground text-xs">{c.detail}</p>
							</div>
						</li>
					))}
				</ul>
			</section>

			<section
				aria-labelledby="repro-heading"
				className="grid content-start gap-4"
			>
				<div>
					<h3 id="repro-heading" className="font-medium text-sm">
						Reproducibility
					</h3>
					<p className="mt-1 text-muted-foreground text-xs">
						Same input, seed and engine version should give the identical event
						trace on any machine.
					</p>
				</div>
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border p-3 text-xs">
					<dt className="text-muted-foreground">Engine</dt>
					<dd className="font-mono">{result.engineVersion}</dd>
					<dt className="text-muted-foreground">Metric definitions</dt>
					<dd className="font-mono">{result.metricDefinitionsVersion}</dd>
					<dt className="text-muted-foreground">Seed</dt>
					<dd className="font-mono">{result.experiment.seed}</dd>
					<dt className="text-muted-foreground">Input digest</dt>
					<dd className="break-all font-mono">sha256:{result.inputDigest}</dd>
					<dt className="text-muted-foreground">Trace digest</dt>
					<dd className="break-all font-mono">{traceDigest}</dd>
					<dt className="text-muted-foreground">Events</dt>
					<dd className="font-mono">{formatCount(eventCount)}</dd>
					<dt className="text-muted-foreground">Run took</dt>
					<dd className="font-mono">
						{Math.round(result.durationMs)} ms of wall-clock time (not part of
						the result)
					</dd>
				</dl>
				<div className="grid gap-2">
					<Button
						variant="outline"
						className="w-fit"
						onClick={runVerify}
						disabled={verify.state === "running"}
					>
						{verify.state === "running" ? (
							<LoaderCircle className="animate-spin" aria-hidden="true" />
						) : (
							<RefreshCcw aria-hidden="true" />
						)}
						Run again and compare
					</Button>
					<div aria-live="polite" className="text-sm">
						{verify.state === "done" &&
							(verify.identical ? (
								<p className="flex items-center gap-2 text-ok">
									<CircleCheck className="size-4" aria-hidden="true" />
									Identical. The second run produced trace {verify.digest} and
									the same metrics.
								</p>
							) : (
								<p className="flex items-center gap-2 text-down">
									<CircleX className="size-4" aria-hidden="true" />
									Different result ({verify.digest}). This is a determinism bug;
									please report it with the exported experiment.
								</p>
							))}
						{verify.state === "error" && (
							<p className="text-down">{verify.message}</p>
						)}
					</div>
				</div>
			</section>
		</div>
	);
}

import { canonicalJson } from "@faultworks/experiment";
import { CircleCheck, CircleX, LoaderCircle, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
	const { t } = useTranslation();
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
					{t("checks.title", { passed, total: checks.length })}
				</h3>
				<p className="mt-1 text-muted-foreground text-xs">
					{t("checks.intro")}
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
										{c.passed ? t("checks.passed") : t("checks.failedLabel")}:{" "}
									</span>
									{t(`checks.items.${c.id}`)}
								</p>
								<p className="text-muted-foreground text-xs">
									{t(`messages.${c.detail.key}`, {
										...c.detail.params,
										defaultValue: c.detail.key,
									})}
								</p>
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
						{t("checks.reproducibility")}
					</h3>
					<p className="mt-1 text-muted-foreground text-xs">
						{t("checks.reproIntro")}
					</p>
				</div>
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border p-3 text-xs">
					<dt className="text-muted-foreground">{t("checks.engine")}</dt>
					<dd className="font-mono">{result.engineVersion}</dd>
					<dt className="text-muted-foreground">{t("checks.metrics")}</dt>
					<dd className="font-mono">{result.metricDefinitionsVersion}</dd>
					<dt className="text-muted-foreground">Seed</dt>
					<dd className="font-mono">{result.experiment.seed}</dd>
					<dt className="text-muted-foreground">
						{t("verify.behaviorDigest")}
					</dt>
					<dd className="break-all font-mono">sha256:{result.runKey}</dd>
					<dt className="text-muted-foreground">{t("verify.traceDigest")}</dt>
					<dd className="break-all font-mono">fnv1a32x2:{traceDigest}</dd>
					<dt className="text-muted-foreground">{t("checks.fileDigest")}</dt>
					<dd className="break-all font-mono">sha256:{result.inputDigest}</dd>
					<dt className="text-muted-foreground">{t("checks.events")}</dt>
					<dd className="font-mono">{formatCount(eventCount)}</dd>
					<dt className="text-muted-foreground">{t("checks.took")}</dt>
					<dd className="font-mono">
						{t("checks.tookValue", { ms: Math.round(result.durationMs) })}
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
						{t("checks.runAgain")}
					</Button>
					<div aria-live="polite" className="text-sm">
						{verify.state === "done" &&
							(verify.identical ? (
								<p className="flex items-center gap-2 text-ok">
									<CircleCheck className="size-4" aria-hidden="true" />
									{t("checks.identical", { digest: verify.digest })}
								</p>
							) : (
								<p className="flex items-center gap-2 text-down">
									<CircleX className="size-4" aria-hidden="true" />
									{t("checks.different", { digest: verify.digest })}
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

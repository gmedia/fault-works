import { CircleCheck, CircleX, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button.tsx";
import { formatCount } from "#/lib/format.ts";
import { useRuns } from "#/state/runs.ts";
import { useWorkbench } from "./context.tsx";

/**
 * Shown after importing a result or comparison file: the experiment inside it was re-run here,
 * and this compares what the file claims with what this browser produced.
 */
export function VerificationBanner() {
	const { t } = useTranslation();
	const { id, result, stale, running } = useWorkbench();
	const claim = useRuns((s) => s.verifications[id]);
	const clear = useRuns((s) => s.setVerification);
	if (!claim) return null;

	const close = (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={t("verify.dismiss")}
			onClick={() => clear(id, null)}
		>
			<X />
		</Button>
	);

	if (!result || running)
		return (
			<output className="mb-5 flex items-center gap-2 rounded-lg border p-3 text-sm">
				<LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
				{t("verify.rerunning", { source: claim.source })}
			</output>
		);
	if (stale)
		return (
			<div className="mb-5 flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
				<output>{t("verify.stale", { source: claim.source })}</output>
				{close}
			</div>
		);

	const checks: Array<{
		label: string;
		claimed: string | null;
		actual: string;
	}> = [
		{
			label: t("verify.behaviorDigest"),
			claimed: claim.behaviorDigest,
			actual: result.runKey,
		},
		{
			label: t("verify.traceDigest"),
			claimed: claim.traceDigest,
			actual: result.metrics.traceDigest,
		},
		{
			label: t("rows.offered"),
			claimed: claim.offered === null ? null : formatCount(claim.offered),
			actual: formatCount(result.metrics.summary.offered),
		},
		{
			label: t("rows.failed"),
			claimed: claim.failed === null ? null : formatCount(claim.failed),
			actual: formatCount(result.metrics.summary.failed),
		},
	];
	const compared = checks.filter((c) => c.claimed !== null);
	const mismatches = compared.filter((c) => c.claimed !== c.actual);
	const engineDiffers =
		claim.engineVersion !== null &&
		claim.engineVersion !== result.engineVersion;
	const ok = mismatches.length === 0 && compared.length > 0;

	return (
		<section
			aria-label={t("verify.title")}
			className={`mb-5 rounded-lg border p-4 text-sm ${ok ? "border-ok/40 bg-ok-soft" : "border-down/40 bg-down-soft"}`}
		>
			<div className="flex items-start justify-between gap-3">
				<p
					className={`flex items-center gap-2 font-medium ${ok ? "text-ok" : "text-down"}`}
				>
					{ok ? (
						<CircleCheck className="size-4" aria-hidden="true" />
					) : (
						<CircleX className="size-4" aria-hidden="true" />
					)}
					{ok
						? t("verify.ok", { source: claim.source })
						: compared.length === 0
							? t("verify.nothingToCheck", { source: claim.source })
							: t("verify.mismatch", {
									source: claim.source,
									fields: mismatches
										.map((m) => m.label.toLowerCase())
										.join(", "),
								})}
				</p>
				{close}
			</div>
			<dl className="mt-3 grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 text-xs">
				<dt className="text-muted-foreground" />
				<dd className="text-muted-foreground">{t("verify.inFile")}</dd>
				<dd className="text-muted-foreground">{t("verify.thisRun")}</dd>
				{compared.map((c) => (
					<div key={c.label} className="contents">
						<dt className="text-muted-foreground">{c.label}</dt>
						<dd className="break-all font-mono">{c.claimed}</dd>
						<dd
							className={`break-all font-mono ${c.claimed === c.actual ? "" : "font-semibold text-down"}`}
						>
							{c.actual}
						</dd>
					</div>
				))}
			</dl>
			{engineDiffers && (
				<p className="mt-2 text-xs">
					{t("verify.engineDiffers", {
						file: claim.engineVersion,
						here: result.engineVersion,
					})}
				</p>
			)}
		</section>
	);
}

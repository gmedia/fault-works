import { CircleCheck, CircleX, LoaderCircle, X } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { formatCount } from "#/lib/format.ts";
import { useRuns } from "#/state/runs.ts";
import { useWorkbench } from "./context.tsx";

/**
 * Shown after importing a result or comparison file: the experiment inside it was re-run here,
 * and this compares what the file claims with what this browser produced.
 */
export function VerificationBanner() {
	const { id, result, stale, running } = useWorkbench();
	const claim = useRuns((s) => s.verifications[id]);
	const clear = useRuns((s) => s.setVerification);
	if (!claim) return null;

	const close = (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Dismiss the file check"
			onClick={() => clear(id, null)}
		>
			<X />
		</Button>
	);

	if (!result || running)
		return (
			<output className="mb-5 flex items-center gap-2 rounded-lg border p-3 text-sm">
				<LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
				Re-running the experiment from {claim.source} to check its results…
			</output>
		);
	if (stale)
		return (
			<div className="mb-5 flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
				<output>
					The settings were changed after import, so these results can no longer
					be checked against {claim.source}.
				</output>
				{close}
			</div>
		);

	const checks: Array<{
		label: string;
		claimed: string | null;
		actual: string;
	}> = [
		{
			label: "Behavior digest",
			claimed: claim.behaviorDigest,
			actual: result.runKey,
		},
		{
			label: "Trace fingerprint",
			claimed: claim.traceDigest,
			actual: result.metrics.traceDigest,
		},
		{
			label: "Offered requests",
			claimed: claim.offered === null ? null : formatCount(claim.offered),
			actual: formatCount(result.metrics.summary.offered),
		},
		{
			label: "Failed requests",
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
			aria-label="Result file check"
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
						? `Reproduced: this run matches ${claim.source}.`
						: compared.length === 0
							? `${claim.source} has no digests to check against.`
							: `Does not match ${claim.source}: ${mismatches.map((m) => m.label.toLowerCase()).join(", ")} differ${mismatches.length === 1 ? "s" : ""}.`}
				</p>
				{close}
			</div>
			<dl className="mt-3 grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 text-xs">
				<dt className="text-muted-foreground" />
				<dd className="text-muted-foreground">In the file</dd>
				<dd className="text-muted-foreground">This run</dd>
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
					The file was produced by engine {claim.engineVersion}; this is engine{" "}
					{result.engineVersion}. Different engine versions may legitimately
					give different traces.
				</p>
			)}
		</section>
	);
}

import { CircleAlert, LoaderCircle, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/ui/tabs.tsx";
import { cn } from "#/lib/utils.ts";
import { useRun } from "#/state/runs.ts";
import { type ResultsTab, useWorkbench } from "../context.tsx";
import { Checks } from "./checks.tsx";
import { EventsTable } from "./events.tsx";
import { Explain } from "./explain.tsx";
import { Overview } from "./overview.tsx";
import { SummaryTiles } from "./summary.tsx";

function useDelayed(flag: boolean, ms = 300) {
	const [show, setShow] = useState(false);
	useEffect(() => {
		if (!flag) {
			setShow(false);
			return;
		}
		const t = setTimeout(() => setShow(true), ms);
		return () => clearTimeout(t);
	}, [flag, ms]);
	return show;
}

export function ResultsPanel({
	tab,
	onTabChange,
}: {
	tab: ResultsTab;
	onTabChange: (tab: ResultsTab) => void;
}) {
	const { id, result, stale, running, run, validation, setInspectorTab } =
		useWorkbench();
	const record = useRun(id);
	const showSpinner = useDelayed(running);

	if (!result) {
		if (record?.status === "error")
			return (
				<div
					role="alert"
					className="rounded-lg border border-down/40 bg-down-soft p-6"
				>
					<p className="flex items-center gap-2 font-medium text-down">
						<CircleAlert className="size-4" aria-hidden="true" />
						The run could not finish
					</p>
					<p className="mt-2 text-sm">{record.error}</p>
					<p className="mt-1 text-muted-foreground text-sm">
						Your settings are unchanged. Fix the input or try again.
					</p>
					<Button className="mt-4" onClick={run}>
						<RotateCcw aria-hidden="true" />
						Try again
					</Button>
				</div>
			);
		if (running)
			return (
				<div
					className="flex min-h-56 items-center justify-center rounded-lg border border-dashed"
					aria-live="polite"
				>
					{showSpinner && (
						<p className="flex items-center gap-2 text-muted-foreground text-sm">
							<LoaderCircle
								className="size-4 animate-spin"
								aria-hidden="true"
							/>
							Running the simulation…
						</p>
					)}
				</div>
			);
		return (
			<div className="rounded-lg border border-dashed p-6 sm:p-10">
				<h2 className="font-semibold text-lg tracking-tight">No results yet</h2>
				{validation.valid ? (
					<>
						<p className="mt-2 max-w-prose text-muted-foreground">
							Run the experiment to see what happens to every request: a
							timeline of successes and failures, latency, queues, and an
							explanation built from the simulated events. It takes about a
							second and runs in your browser.
						</p>
						<Button className="mt-5" size="lg" onClick={run}>
							<Play aria-hidden="true" />
							Run experiment
						</Button>
						<p className="mt-2 text-muted-foreground text-xs">
							Shortcut:{" "}
							<kbd className="rounded border px-1 font-mono">Ctrl</kbd> +{" "}
							<kbd className="rounded border px-1 font-mono">Enter</kbd>
						</p>
					</>
				) : (
					<IssueList onOpenTab={setInspectorTab} />
				)}
			</div>
		);
	}

	return (
		<div className="grid min-w-0 grid-cols-1 gap-5">
			{stale && (
				<output className="flex flex-col gap-3 rounded-lg border border-gap/40 bg-gap-soft p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
					<p>
						<span className="font-medium">
							Settings changed since this run.
						</span>{" "}
						The results below still show the previous settings.
					</p>
					{validation.valid ? (
						<Button size="sm" onClick={run} disabled={running}>
							{running ? (
								<LoaderCircle className="animate-spin" aria-hidden="true" />
							) : (
								<Play aria-hidden="true" />
							)}
							Run again
						</Button>
					) : (
						<span className="text-down">
							Fix {validation.issues.length} problem
							{validation.issues.length === 1 ? "" : "s"} to run again.
						</span>
					)}
				</output>
			)}
			<div
				className={cn(
					"grid min-w-0 grid-cols-1 gap-5 transition-opacity",
					(stale || running) && "opacity-60",
				)}
			>
				<SummaryTiles
					summary={result.metrics.summary}
					healthChecks={result.healthChecks}
				/>
				<Tabs
					value={tab}
					onValueChange={(v) => onTabChange(v as ResultsTab)}
					className="gap-4"
				>
					<TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
						<TabsTrigger value="overview">Over time</TabsTrigger>
						<TabsTrigger value="explain">What happened</TabsTrigger>
						<TabsTrigger value="events">Events</TabsTrigger>
						<TabsTrigger value="checks">
							Checks
							<span className="text-muted-foreground tabular">
								{result.metrics.checks.filter((c) => c.passed).length}/
								{result.metrics.checks.length}
							</span>
						</TabsTrigger>
					</TabsList>
					<TabsContent value="overview">
						<Overview result={result} />
					</TabsContent>
					<TabsContent value="explain">
						<Explain result={result} />
					</TabsContent>
					<TabsContent value="events">
						<EventsTable result={result} />
					</TabsContent>
					<TabsContent value="checks">
						<Checks result={result} />
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}

export function IssueList({
	onOpenTab,
}: {
	onOpenTab: (
		tab: "component" | "traffic" | "faults" | "run" | "notes",
	) => void;
}) {
	const { validation } = useWorkbench();
	const tabFor = (path: string) =>
		path.startsWith("workload")
			? "traffic"
			: path.startsWith("faults")
				? "faults"
				: path.startsWith("seed") || path.startsWith("run")
					? "run"
					: path.startsWith("model")
						? "component"
						: "notes";
	return (
		<div role="alert">
			<p className="flex items-center gap-2 font-medium text-down">
				<CircleAlert className="size-4" aria-hidden="true" />
				Fix {validation.issues.length} problem
				{validation.issues.length === 1 ? "" : "s"} before running
			</p>
			<ul className="mt-3 grid gap-2 text-sm">
				{validation.issues.slice(0, 8).map((issue) => (
					<li
						key={`${issue.path}:${issue.message}`}
						className="flex flex-wrap items-baseline gap-x-2"
					>
						<span>{issue.message}</span>
						<button
							type="button"
							className="text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground"
							onClick={() => onOpenTab(tabFor(issue.path))}
						>
							Open {tabFor(issue.path)} settings
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

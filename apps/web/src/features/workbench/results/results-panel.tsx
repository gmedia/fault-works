import { CircleAlert, LoaderCircle, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "#/components/ui/tabs.tsx";
import { cn } from "#/lib/utils.ts";
import { useRun } from "#/state/runs.ts";
import {
	type InspectorTab,
	type ResultsTab,
	useWorkbench,
} from "../context.tsx";
import { useMessage } from "../fields.tsx";
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
		const x = setTimeout(() => setShow(true), ms);
		return () => clearTimeout(x);
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
	const { t } = useTranslation();
	const {
		id,
		result,
		stale,
		running,
		run,
		validation,
		setInspectorTab,
		phone,
	} = useWorkbench();
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
						{t("results.errorTitle")}
					</p>
					<p className="mt-2 text-sm">{record.error}</p>
					<p className="mt-1 text-muted-foreground text-sm">
						{t("results.errorHint")}
					</p>
					<Button className="mt-4" onClick={() => run()}>
						<RotateCcw aria-hidden="true" />
						{t("results.tryAgain")}
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
							{t("results.running")}
						</p>
					)}
				</div>
			);
		return (
			<div className="rounded-lg border border-dashed p-6 sm:p-10">
				<h2 className="font-semibold text-lg tracking-tight">
					{t("results.noneTitle")}
				</h2>
				{validation.valid ? (
					<>
						<p className="mt-2 max-w-prose text-muted-foreground">
							{t("results.noneBody")}
						</p>
						<Button className="mt-5" size="lg" onClick={() => run()}>
							<Play aria-hidden="true" />
							{t("results.runExperiment")}
						</Button>
						{!phone && (
							<p className="mt-2 text-muted-foreground text-xs pointer-coarse:hidden">
								{t("results.shortcut")}{" "}
								<kbd className="rounded border px-1 font-mono">Ctrl</kbd> +{" "}
								<kbd className="rounded border px-1 font-mono">Enter</kbd>
							</p>
						)}
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
						<span className="font-medium">{t("results.staleTitle")}</span>{" "}
						{t("results.staleBody")}
					</p>
					{validation.valid ? (
						<Button size="sm" onClick={() => run()} disabled={running}>
							{running ? (
								<LoaderCircle className="animate-spin" aria-hidden="true" />
							) : (
								<Play aria-hidden="true" />
							)}
							{t("actions.runAgain")}
						</Button>
					) : (
						<span className="text-down">
							{t("results.staleFix", { count: validation.issues.length })}
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
				<SummaryTiles summary={result.metrics.summary} />
				<Tabs
					value={tab}
					onValueChange={(v) => onTabChange(v as ResultsTab)}
					className="gap-4"
				>
					<TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
						<TabsTrigger value="overview">
							{t("results.tabs.overview")}
						</TabsTrigger>
						<TabsTrigger value="explain">
							{t("results.tabs.explain")}
						</TabsTrigger>
						<TabsTrigger value="events">{t("results.tabs.events")}</TabsTrigger>
						<TabsTrigger value="checks">
							{t("results.tabs.checks")}
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
	onOpenTab: (tab: InspectorTab) => void;
}) {
	const { t } = useTranslation();
	const { validation } = useWorkbench();
	const message = useMessage();
	const tabFor = (path: string): InspectorTab =>
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
				{t("results.fixFirst", { count: validation.issues.length })}
			</p>
			<ul className="mt-3 grid gap-2 text-sm">
				{validation.issues.slice(0, 8).map((issue) => (
					<li
						key={`${issue.path}:${issue.message.key}`}
						className="flex flex-wrap items-baseline gap-x-2"
					>
						<span>{message(issue)}</span>
						<button
							type="button"
							className="text-muted-foreground text-xs underline underline-offset-4 hover:text-foreground"
							onClick={() => onOpenTab(tabFor(issue.path))}
						>
							{t("results.openTab", {
								tab: t(`inspector.tabs.${tabFor(issue.path)}`),
							})}
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

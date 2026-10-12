import { removeServer, servers } from "@faultworks/experiment";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { isTypingTarget } from "#/components/app/app-shell.tsx";
import { formatCount } from "#/lib/format.ts";
import { prefersReducedMotion, useMediaQuery } from "#/lib/use-media-query.ts";
import { cn } from "#/lib/utils.ts";
import { useEntry, useLibrary } from "#/state/library.ts";
import { useRun, useRuns } from "#/state/runs.ts";
import { useValidation } from "#/state/validation.ts";
import { TopologyCanvas } from "./canvas.tsx";
import {
	type InspectorTab,
	type ResultsTab,
	WorkbenchContext,
	type WorkbenchContextValue,
} from "./context.tsx";
import { WorkbenchHeader } from "./header.tsx";
import { Inspector } from "./inspector.tsx";
import { PlaybackBar, stateChangeTimes } from "./playback.tsx";
import { usePlayback } from "./playback-store.ts";
import { ResultsPanel } from "./results/results-panel.tsx";
import { StackedTopology } from "./stacked-topology.tsx";
import { VerificationBanner } from "./verification.tsx";

interface WorkbenchProps {
	id: string;
	selectedNode: string | null;
	onSelectNode: (id: string | null) => void;
	inspectorTab: InspectorTab;
	onInspectorTab: (tab: InspectorTab) => void;
	resultsTab: ResultsTab;
	onResultsTab: (tab: ResultsTab) => void;
}

export function Workbench(props: WorkbenchProps) {
	const { id } = props;
	const entry = useEntry(id);
	const experiment = entry?.experiment;
	const updateEntry = useLibrary((s) => s.update);
	const runExperiment = useRuns((s) => s.run);
	const record = useRun(id);
	const validation = useValidation(experiment);
	const resetPlayback = usePlayback((s) => s.reset);
	const [announcement, setAnnouncement] = useState("");
	const phone = useMediaQuery("(max-width: 639px)");
	const stackedLayout = useMediaQuery("(max-width: 1023px)");
	const { onSelectNode } = props;
	// Below the desktop layout the settings sit under the topology: bring them into view.
	const selectNode = useCallback(
		(node: string | null) => {
			onSelectNode(node);
			if (node && stackedLayout)
				requestAnimationFrame(() =>
					document.getElementById("settings")?.scrollIntoView({
						behavior: prefersReducedMotion() ? "auto" : "smooth",
						block: "start",
					}),
				);
		},
		[onSelectNode, stackedLayout],
	);

	useEffect(() => resetPlayback(id), [id, resetPlayback]);

	const result = record?.result ?? null;
	const running = record?.status === "running";
	const stale = Boolean(
		result && validation && result.runKey !== validation.runKey,
	);

	const update = useCallback(
		(recipe: Parameters<WorkbenchContextValue["update"]>[0], key?: string) =>
			updateEntry(id, recipe, key),
		[id, updateEntry],
	);

	const run = useCallback(
		(options: { reveal?: boolean } = { reveal: true }) => {
			if (!experiment || !validation?.valid || running) return;
			void runExperiment(id, experiment).then((r) => {
				// On narrow screens the results sit far below the Run button; bring them into view.
				if (
					r &&
					options.reveal &&
					window.matchMedia("(max-width: 1023px)").matches
				)
					document.getElementById("results")?.scrollIntoView({
						behavior: prefersReducedMotion() ? "auto" : "smooth",
						block: "start",
					});
				if (!r) {
					setAnnouncement("The run failed.");
					return;
				}
				const s = r.metrics.summary;
				setAnnouncement(
					`Run finished. ${formatCount(s.succeeded)} of ${formatCount(s.offered)} requests succeeded, ${formatCount(s.failed)} failed.`,
				);
				const t = usePlayback.getState().timeMs;
				if (t > r.horizonMs) usePlayback.getState().setTime(r.horizonMs);
			});
		},
		[experiment, validation, running, runExperiment, id],
	);

	// Results are not stored, but they are reproducible: re-run on open when this browser has run
	// these exact settings before, or when an imported result file is waiting to be verified.
	const autoRunKey = validation?.valid ? validation.runKey : null;
	const hasRecord = record !== undefined;
	// biome-ignore lint/correctness/useExhaustiveDependencies: only on open; later edits must wait for an explicit run.
	useEffect(() => {
		if (hasRecord || !autoRunKey) return;
		const { ranKeys, verifications } = useRuns.getState();
		if (ranKeys.includes(autoRunKey) || verifications[id])
			run({ reveal: false });
	}, [id]);

	// Shortcuts. Typing in a field keeps native behavior (including the field's own undo).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			if (mod && e.key === "Enter") {
				e.preventDefault();
				run();
				return;
			}
			if (isTypingTarget(e.target)) return;
			if (mod && e.key.toLowerCase() === "z") {
				e.preventDefault();
				const ok = e.shiftKey
					? useLibrary.getState().redo(id)
					: useLibrary.getState().undo(id);
				if (!ok) toast(e.shiftKey ? "Nothing to redo" : "Nothing to undo");
				return;
			}
			if (mod || e.altKey) return;
			const target = e.target as HTMLElement | null;
			const onControl =
				target?.closest(
					"button,a,[role='slider'],input,[role='tab'],.react-flow",
				) !== null;
			const playback = usePlayback.getState();
			const current = useRuns.getState().runs[id]?.result;
			if (e.key === " " && current && !onControl) {
				e.preventDefault();
				if (!playback.playing && playback.timeMs >= current.horizonMs)
					playback.setTime(0);
				playback.setPlaying(!playback.playing);
			}
			if (
				(e.key === "ArrowLeft" || e.key === "ArrowRight") &&
				current &&
				!onControl
			) {
				e.preventDefault();
				playback.setPlaying(false);
				const forward = e.key === "ArrowRight";
				if (e.shiftKey) {
					const times = stateChangeTimes(current);
					const t = forward
						? times.find((x) => x > playback.timeMs + 0.5)
						: [...times].reverse().find((x) => x < playback.timeMs - 0.5);
					if (t !== undefined) playback.setTime(t);
				} else {
					const w = current.metrics.series.windowMs;
					playback.setTime(
						Math.max(
							0,
							Math.min(current.horizonMs, playback.timeMs + (forward ? w : -w)),
						),
					);
				}
			}
			if ((e.key === "Delete" || e.key === "Backspace") && props.selectedNode) {
				const exp = useLibrary.getState().entries[id]?.experiment;
				const node = exp?.model.nodes.find((n) => n.id === props.selectedNode);
				if (!exp || node?.kind !== "server") return;
				if (servers(exp).length <= 1) {
					toast("An experiment needs at least one server");
					return;
				}
				e.preventDefault();
				const { experiment: next } = removeServer(exp, node.id);
				useLibrary.getState().update(id, () => next);
				props.onSelectNode(null);
				toast(`Removed ${node.label ?? node.id}`, {
					description: "Undo with Ctrl+Z.",
				});
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [run, id, props]);

	const value = useMemo<WorkbenchContextValue | null>(
		() =>
			experiment && validation
				? {
						id,
						experiment,
						update,
						validation,
						selectedNode: experiment.model.nodes.some(
							(n) => n.id === props.selectedNode,
						)
							? props.selectedNode
							: null,
						selectNode,
						inspectorTab: props.inspectorTab,
						setInspectorTab: props.onInspectorTab,
						result,
						stale,
						running,
						run,
					}
				: null,
		[
			experiment,
			validation,
			id,
			update,
			props,
			selectNode,
			result,
			stale,
			running,
			run,
		],
	);

	if (!value) return null;

	return (
		<WorkbenchContext.Provider value={value}>
			<p className="sr-only" aria-live="polite">
				{announcement}
			</p>
			<WorkbenchHeader />
			<div className="mx-auto grid max-w-[1600px] lg:h-[540px] lg:grid-cols-[minmax(0,1fr)_380px]">
				<section
					aria-label="Topology"
					className={cn(
						"flex min-h-0 flex-col lg:h-full",
						!phone && "h-[460px]",
					)}
				>
					<div className="min-h-0 flex-1">
						{phone ? <StackedTopology /> : <TopologyCanvas />}
					</div>
					{result && <PlaybackBar result={result} disabled={stale} />}
				</section>
				<aside
					id="settings"
					aria-label="Settings"
					className="min-h-0 border-t bg-card lg:border-t-0 lg:border-l"
				>
					<Inspector />
				</aside>
			</div>
			<section
				id="results"
				aria-labelledby="results-heading"
				className="scroll-mt-16 border-t"
			>
				<div className="mx-auto max-w-[1600px] px-4 py-6">
					<h2 id="results-heading" className="sr-only">
						Results
					</h2>
					<VerificationBanner />
					<ResultsPanel
						tab={props.resultsTab}
						onTabChange={props.onResultsTab}
					/>
				</div>
			</section>
		</WorkbenchContext.Provider>
	);
}

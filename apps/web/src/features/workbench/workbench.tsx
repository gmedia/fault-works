import { removeLink, removeNode } from "@faultworks/experiment";
import { BarChart3, Hammer, LoaderCircle, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { isTypingTarget } from "#/components/app/app-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet.tsx";
import { formatCount } from "#/lib/format.ts";
import { prefersReducedMotion, useMediaQuery } from "#/lib/use-media-query.ts";
import { cn } from "#/lib/utils.ts";
import { useEntry, useLibrary } from "#/state/library.ts";
import { useRun, useRuns } from "#/state/runs.ts";
import { useValidation } from "#/state/validation.ts";
import { TopologyCanvas } from "./canvas.tsx";
import {
	type InspectorTab,
	type PhoneTab,
	type ResultsTab,
	type Selection,
	useWorkbench,
	WorkbenchContext,
	type WorkbenchContextValue,
} from "./context.tsx";
import { WorkbenchHeader } from "./header.tsx";
import { Inspector } from "./inspector.tsx";
import { PlaybackBar } from "./playback.tsx";
import { usePlayback } from "./playback-store.ts";
import { ResultsPanel } from "./results/results-panel.tsx";
import { StackedTopology } from "./stacked-topology.tsx";
import { stateChangeTimes } from "./state-at.ts";
import { VerificationBanner } from "./verification.tsx";

interface WorkbenchProps {
	id: string;
	selection: Selection;
	onSelect: (selection: Selection) => void;
	inspectorTab: InspectorTab;
	onInspectorTab: (tab: InspectorTab) => void;
	resultsTab: ResultsTab;
	onResultsTab: (tab: ResultsTab) => void;
	phoneTab: PhoneTab;
	onPhoneTab: (tab: PhoneTab) => void;
}

export function Workbench(props: WorkbenchProps) {
	const { t } = useTranslation();
	const { id } = props;
	const entry = useEntry(id);
	const experiment = entry?.experiment;
	const updateEntry = useLibrary((s) => s.update);
	const runExperiment = useRuns((s) => s.run);
	const record = useRun(id);
	const validation = useValidation(experiment);
	const resetPlayback = usePlayback((s) => s.reset);
	const [announcement, setAnnouncement] = useState("");
	const phone = useMediaQuery("(max-width: 767px)");
	const stackedLayout = useMediaQuery("(max-width: 1023px)");
	const [sheetOpen, setSheetOpen] = useState(false);
	const { onSelect, onInspectorTab, onPhoneTab } = props;

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

	// On a phone the inspector is a bottom sheet; selecting a component opens it.
	const select = useCallback(
		(selection: Selection) => {
			onSelect(selection);
			if (selection && phone) setSheetOpen(true);
			else if (selection && stackedLayout)
				requestAnimationFrame(() =>
					document.getElementById("settings")?.scrollIntoView({
						behavior: prefersReducedMotion() ? "auto" : "smooth",
						block: "start",
					}),
				);
		},
		[onSelect, phone, stackedLayout],
	);
	const setInspectorTab = useCallback(
		(tab: InspectorTab) => {
			onInspectorTab(tab);
			if (phone) setSheetOpen(true);
		},
		[onInspectorTab, phone],
	);

	const run = useCallback(
		(options: { reveal?: boolean } = { reveal: true }) => {
			if (!experiment || !validation?.valid || running) return;
			void runExperiment(id, experiment).then((r) => {
				if (!r) {
					setAnnouncement(t("state.runFailed"));
					return;
				}
				const s = r.metrics.summary;
				setAnnouncement(
					t("state.runFinished", {
						succeeded: formatCount(s.succeeded),
						offered: formatCount(s.offered),
						failed: formatCount(s.failed),
					}),
				);
				const tm = usePlayback.getState().timeMs;
				if (tm > r.horizonMs) usePlayback.getState().setTime(r.horizonMs);
				if (options.reveal) {
					if (phone) onPhoneTab("replay");
					else if (stackedLayout)
						document.getElementById("results")?.scrollIntoView({
							behavior: prefersReducedMotion() ? "auto" : "smooth",
							block: "start",
						});
				}
			});
		},
		[
			experiment,
			validation,
			running,
			runExperiment,
			id,
			t,
			phone,
			stackedLayout,
			onPhoneTab,
		],
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
				if (!ok)
					toast(t(e.shiftKey ? "state.nothingToRedo" : "state.nothingToUndo"));
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
					const x = forward
						? times.find((v) => v > playback.timeMs + 0.5)
						: [...times].reverse().find((v) => v < playback.timeMs - 0.5);
					if (x !== undefined) playback.setTime(x);
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
			if ((e.key === "Delete" || e.key === "Backspace") && props.selection) {
				const exp = useLibrary.getState().entries[id]?.experiment;
				if (!exp) return;
				if (props.selection.type === "link") {
					e.preventDefault();
					useLibrary
						.getState()
						.update(id, (x) =>
							removeLink(x, (props.selection as { id: string }).id),
						);
					onSelect(null);
					toast(t("inspector.linkRemoved"), {
						description: t("inspector.undoHint"),
					});
					return;
				}
				const node = exp.model.nodes.find(
					(n) => n.id === (props.selection as { id: string }).id,
				);
				if (!node || node.kind === "client") return;
				if (exp.model.nodes.length <= 2) {
					toast(t("inspector.needOneComponent"));
					return;
				}
				e.preventDefault();
				const { experiment: next } = removeNode(exp, node.id);
				useLibrary.getState().update(id, () => next);
				onSelect(null);
				toast(t("inspector.removed", { name: node.label ?? node.id }), {
					description: t("inspector.undoHint"),
				});
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [run, id, props.selection, onSelect, t]);

	const value = useMemo<WorkbenchContextValue | null>(() => {
		if (!experiment || !validation) return null;
		const sel = props.selection;
		const exists =
			sel === null ||
			(sel.type === "node"
				? experiment.model.nodes.some((n) => n.id === sel.id)
				: experiment.model.links.some((l) => l.id === sel.id));
		return {
			id,
			experiment,
			update,
			validation,
			selection: exists ? sel : null,
			select,
			inspectorTab: props.inspectorTab,
			setInspectorTab,
			result,
			stale,
			running,
			run,
			phone,
			phoneTab: props.phoneTab,
			setPhoneTab: onPhoneTab,
		};
	}, [
		experiment,
		validation,
		id,
		update,
		props.selection,
		props.inspectorTab,
		props.phoneTab,
		select,
		setInspectorTab,
		result,
		stale,
		running,
		run,
		phone,
		onPhoneTab,
	]);

	if (!value) return null;

	const results = (
		<section
			id="results"
			aria-labelledby="results-heading"
			className={cn("scroll-mt-16", !phone && "border-t")}
		>
			<div className="mx-auto max-w-[1600px] px-4 py-6">
				<h2 id="results-heading" className="sr-only">
					{t("results.heading")}
				</h2>
				<VerificationBanner />
				<ResultsPanel tab={props.resultsTab} onTabChange={props.onResultsTab} />
			</div>
		</section>
	);

	return (
		<WorkbenchContext.Provider value={value}>
			<p className="sr-only" aria-live="polite">
				{announcement}
			</p>
			<WorkbenchHeader />
			{phone ? (
				<div className="pb-20">
					{props.phoneTab === "build" && (
						<section aria-label={t("phone.build")}>
							<StackedTopology />
						</section>
					)}
					{props.phoneTab === "replay" && (
						<section aria-label={t("phone.replay")}>
							{result ? (
								<>
									<PlaybackBar result={result} disabled={stale} />
									<StackedTopology readOnly />
								</>
							) : (
								<div className="p-6 text-center text-muted-foreground text-sm">
									{t("phone.runFirst")}
								</div>
							)}
						</section>
					)}
					{props.phoneTab === "results" && results}
					<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
						<SheetContent side="bottom" className="max-h-[85dvh] gap-0 p-0">
							<SheetHeader className="sr-only">
								<SheetTitle>{t("inspector.settings")}</SheetTitle>
								<SheetDescription>
									{t("inspector.settingsDescription")}
								</SheetDescription>
							</SheetHeader>
							<div className="h-[80dvh]">
								<Inspector />
							</div>
						</SheetContent>
					</Sheet>
					<PhoneTabBar onOpenSettings={() => setSheetOpen(true)} />
				</div>
			) : (
				<>
					<div className="mx-auto grid max-w-[1600px] lg:h-[560px] lg:grid-cols-[minmax(0,1fr)_380px]">
						<section
							aria-label={t("phone.build")}
							className="flex h-[480px] min-h-0 flex-col lg:h-full"
						>
							<div className="min-h-0 flex-1">
								<TopologyCanvas />
							</div>
							{result && <PlaybackBar result={result} disabled={stale} />}
						</section>
						<aside
							id="settings"
							aria-label={t("inspector.settings")}
							className="min-h-0 border-t bg-card lg:border-t-0 lg:border-l"
						>
							<Inspector />
						</aside>
					</div>
					{results}
				</>
			)}
		</WorkbenchContext.Provider>
	);
}

/** Phone: three screens plus Run, in the thumb zone. */
function PhoneTabBar({ onOpenSettings }: { onOpenSettings: () => void }) {
	const { t } = useTranslation();
	const { phoneTab, setPhoneTab, run, running, validation, result } =
		useWorkbench();
	const tabs: Array<{ id: PhoneTab; label: string; Icon: typeof Hammer }> = [
		{ id: "build", label: t("phone.build"), Icon: Hammer },
		{ id: "replay", label: t("phone.replay"), Icon: Play },
		{ id: "results", label: t("phone.results"), Icon: BarChart3 },
	];
	return (
		<nav
			aria-label={t("phone.screens")}
			className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur"
		>
			<div className="grid grid-cols-[1fr_1fr_1fr_auto] items-stretch">
				{tabs.map(({ id, label, Icon }) => (
					<button
						key={id}
						type="button"
						aria-current={phoneTab === id ? "page" : undefined}
						onClick={() => {
							// A second tap on Build opens the settings sheet; the first just shows the screen.
							if (id === "build" && phoneTab === "build") onOpenSettings();
							setPhoneTab(id);
						}}
						className={cn(
							"flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs",
							phoneTab === id
								? "font-medium text-foreground"
								: "text-muted-foreground",
						)}
					>
						<Icon className="size-5" aria-hidden="true" />
						{label}
					</button>
				))}
				<div className="flex items-center px-2">
					<Button
						onClick={() => run()}
						disabled={!validation.valid || running}
						className="min-h-11"
					>
						{running ? (
							<LoaderCircle className="animate-spin" aria-hidden="true" />
						) : (
							<Play aria-hidden="true" />
						)}
						{result ? t("actions.runAgain") : t("actions.run")}
					</Button>
				</div>
			</div>
		</nav>
	);
}

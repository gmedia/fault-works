import { EXAMPLE_IDS, type Locale } from "@faultworks/experiment";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRightLeft,
	ChevronDown,
	CircleAlert,
	CircleCheck,
	CircleDashed,
	Copy,
	Download,
	EllipsisVertical,
	LoaderCircle,
	Play,
	Redo2,
	RotateCcw,
	Trash2,
	Undo2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import {
	exportEventsCsv,
	exportExperiment,
	exportResult,
} from "#/features/library/export.ts";
import {
	useCanRedo,
	useCanUndo,
	useEntry,
	useLibrary,
} from "#/state/library.ts";
import { useWorkbench } from "./context.tsx";

function RunState() {
	const { t } = useTranslation();
	const { result, stale, running, validation } = useWorkbench();
	let content: { Icon: typeof CircleCheck; text: string; className: string };
	if (running)
		content = {
			Icon: LoaderCircle,
			text: t("state.running"),
			className: "text-muted-foreground [&>svg]:animate-spin",
		};
	else if (!validation.valid)
		content = {
			Icon: CircleAlert,
			text: t("state.problems", { count: validation.issues.length }),
			className: "text-down",
		};
	else if (!result)
		content = {
			Icon: CircleDashed,
			text: t("state.notRun"),
			className: "text-muted-foreground",
		};
	else if (stale)
		content = {
			Icon: CircleAlert,
			text: t("state.stale"),
			className: "text-gap",
		};
	else
		content = {
			Icon: CircleCheck,
			text: t("state.current"),
			className: "text-ok",
		};
	return (
		<output
			className={`flex items-center gap-1.5 text-xs ${content.className}`}
		>
			<content.Icon className="size-3.5" aria-hidden="true" />
			{content.text}
		</output>
	);
}

export function WorkbenchHeader() {
	const { t, i18n } = useTranslation();
	const { id, experiment, validation, running, run, result, stale, phone } =
		useWorkbench();
	const entry = useEntry(id);
	const canUndo = useCanUndo(id);
	const canRedo = useCanRedo(id);
	const undo = useLibrary((s) => s.undo);
	const redo = useLibrary((s) => s.redo);
	const remove = useLibrary((s) => s.remove);
	const restoreEntry = useLibrary((s) => s.restoreEntry);
	const createVariant = useLibrary((s) => s.createVariant);
	const resetToBuiltIn = useLibrary((s) => s.resetToBuiltIn);
	const original = useLibrary((s) =>
		entry?.basedOn ? s.entries[entry.basedOn] : undefined,
	);
	const navigate = useNavigate();
	const isBuiltIn = EXAMPLE_IDS.includes(id);
	const currentResult = result && !stale ? result : null;

	const variant = () => {
		const newId = createVariant(
			id,
			t("variant.suffix"),
			t("variant.descriptionPrompt", { title: experiment.title }),
		);
		if (!newId) return;
		toast.success(t("variant.created"), {
			description: t("variant.createdHint"),
		});
		void navigate({
			to: "/experiments/$experimentId",
			params: { experimentId: newId },
		});
	};

	return (
		<div className="border-b bg-card/50">
			<div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-start lg:justify-between lg:py-4">
				<div className="min-w-0">
					<nav
						aria-label={t("nav.breadcrumb")}
						className="text-muted-foreground text-xs"
					>
						<Link to="/" className="hover:text-foreground hover:underline">
							{t("nav.experiments")}
						</Link>
						{original && (
							<>
								<span aria-hidden="true"> / </span>
								<Link
									to="/experiments/$experimentId"
									params={{ experimentId: original.experiment.experimentId }}
									className="hover:text-foreground hover:underline"
								>
									{original.experiment.title}
								</Link>
							</>
						)}
					</nav>
					<h1 className="mt-1 font-semibold text-xl tracking-tight sm:text-2xl">
						{experiment.title}
					</h1>
					{experiment.question && (
						<p className="mt-1 max-w-3xl text-muted-foreground text-sm sm:text-base">
							{experiment.question}
						</p>
					)}
					<div className="mt-2">
						<RunState />
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<div className="flex items-center">
						<Button
							variant="ghost"
							size="icon"
							aria-label={t("shortcuts.undo")}
							title={`${t("shortcuts.undo")} (Ctrl+Z)`}
							disabled={!canUndo}
							onClick={() => undo(id)}
						>
							<Undo2 />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							aria-label={t("shortcuts.redo")}
							title={`${t("shortcuts.redo")} (Ctrl+Shift+Z)`}
							disabled={!canRedo}
							onClick={() => redo(id)}
						>
							<Redo2 />
						</Button>
					</div>

					<div className="hidden items-center gap-2 sm:flex">
						<Button variant="outline" onClick={variant}>
							<Copy aria-hidden="true" />
							{t("actions.variant")}
						</Button>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline">
									<ArrowRightLeft aria-hidden="true" />
									{t("actions.compare")}
									<ChevronDown className="opacity-60" aria-hidden="true" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{original && (
									<DropdownMenuItem asChild>
										<Link
											to="/compare"
											search={{ a: original.experiment.experimentId, b: id }}
										>
											{t("actions.compareOriginal", {
												title: original.experiment.title,
											})}
										</Link>
									</DropdownMenuItem>
								)}
								<DropdownMenuItem asChild>
									<Link to="/compare" search={{ b: id }}>
										{t("actions.compareOther")}
									</Link>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline">
									<Download aria-hidden="true" />
									{t("actions.export")}
									<ChevronDown className="opacity-60" aria-hidden="true" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-72">
								<DropdownMenuItem onSelect={() => exportExperiment(experiment)}>
									{t("export.experiment")}
									<span className="ml-auto text-muted-foreground text-xs">
										{t("export.share")}
									</span>
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
									{currentResult
										? t("export.fromResults")
										: t("export.runFirst")}
								</DropdownMenuLabel>
								<DropdownMenuItem
									disabled={!currentResult}
									onSelect={() => currentResult && exportResult(currentResult)}
								>
									{t("export.result")}
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={!currentResult?.log}
									onSelect={() =>
										currentResult && exportEventsCsv(currentResult)
									}
								>
									{t("export.events")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>

					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("actions.more")}
							>
								<EllipsisVertical />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-72">
							<div className="sm:hidden">
								<DropdownMenuItem onSelect={variant}>
									<Copy aria-hidden="true" />
									{t("actions.variant")}
								</DropdownMenuItem>
								{original && (
									<DropdownMenuItem asChild>
										<Link
											to="/compare"
											search={{ a: original.experiment.experimentId, b: id }}
										>
											<ArrowRightLeft aria-hidden="true" />
											{t("actions.compareOriginal", {
												title: original.experiment.title,
											})}
										</Link>
									</DropdownMenuItem>
								)}
								<DropdownMenuItem asChild>
									<Link to="/compare" search={{ b: id }}>
										<ArrowRightLeft aria-hidden="true" />
										{t("actions.compareOther")}
									</Link>
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => exportExperiment(experiment)}>
									<Download aria-hidden="true" />
									{t("export.experiment")}
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={!currentResult}
									onSelect={() => currentResult && exportResult(currentResult)}
								>
									<Download aria-hidden="true" />
									{t("export.result")}
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={!currentResult?.log}
									onSelect={() =>
										currentResult && exportEventsCsv(currentResult)
									}
								>
									<Download aria-hidden="true" />
									{t("export.events")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
							</div>
							{isBuiltIn && (
								<DropdownMenuItem
									onSelect={() => {
										resetToBuiltIn(id, i18n.language as Locale);
										toast(t("actions.resetDone"), {
											description: t("inspector.undoHint"),
										});
									}}
								>
									<RotateCcw aria-hidden="true" />
									{t("actions.reset")}
								</DropdownMenuItem>
							)}
							<DropdownMenuItem
								variant="destructive"
								onSelect={() => {
									const removed = remove(id);
									if (!removed) return;
									void navigate({ to: "/" });
									toast(t("library.deleted", { title: experiment.title }), {
										action: {
											label: t("common.undo"),
											onClick: () => restoreEntry(removed.entry, removed.index),
										},
									});
								}}
							>
								<Trash2 aria-hidden="true" />
								{t("actions.delete")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					{!phone && (
						<Button
							onClick={() => run()}
							disabled={!validation.valid || running}
							title={
								validation.valid
									? `${t("actions.run")} (Ctrl+Enter)`
									: t("state.fixFirst")
							}
							className="min-w-28"
						>
							{running ? (
								<LoaderCircle className="animate-spin" aria-hidden="true" />
							) : (
								<Play aria-hidden="true" />
							)}
							{result ? t("actions.runAgain") : t("actions.run")}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}

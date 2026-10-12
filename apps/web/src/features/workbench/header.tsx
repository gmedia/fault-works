import { findBuiltIn } from "@faultworks/experiment";
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
	const { result, stale, running, validation } = useWorkbench();
	let content: { Icon: typeof CircleCheck; text: string; className: string };
	if (running)
		content = {
			Icon: LoaderCircle,
			text: "Running…",
			className: "text-muted-foreground [&>svg]:animate-spin",
		};
	else if (!validation.valid)
		content = {
			Icon: CircleAlert,
			text: `${validation.issues.length} problem${validation.issues.length === 1 ? "" : "s"} to fix`,
			className: "text-down",
		};
	else if (!result)
		content = {
			Icon: CircleDashed,
			text: "Not run yet",
			className: "text-muted-foreground",
		};
	else if (stale)
		content = {
			Icon: CircleAlert,
			text: "Settings changed since the last run",
			className: "text-gap",
		};
	else
		content = {
			Icon: CircleCheck,
			text: "Results match these settings",
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
	const { id, experiment, validation, running, run, result, stale } =
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
	const isBuiltIn = findBuiltIn(id) !== undefined;
	const currentResult = result && !stale ? result : null;

	const variant = () => {
		const newId = createVariant(id);
		if (!newId) return;
		toast.success("Variant created", {
			description:
				"Change one setting, run it, then compare it with the original.",
		});
		void navigate({
			to: "/experiments/$experimentId",
			params: { experimentId: newId },
		});
	};

	return (
		<div className="border-b bg-card/50">
			<div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
				<div className="min-w-0">
					<nav
						aria-label="Breadcrumb"
						className="text-muted-foreground text-xs"
					>
						<Link to="/" className="hover:text-foreground hover:underline">
							Experiments
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
						<p className="mt-1 max-w-3xl text-muted-foreground">
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
							aria-label="Undo"
							title="Undo (Ctrl+Z)"
							disabled={!canUndo}
							onClick={() => undo(id)}
						>
							<Undo2 />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Redo"
							title="Redo (Ctrl+Shift+Z)"
							disabled={!canRedo}
							onClick={() => redo(id)}
						>
							<Redo2 />
						</Button>
					</div>

					<Button variant="outline" onClick={variant}>
						<Copy aria-hidden="true" />
						<span className="max-sm:sr-only">Create variant</span>
					</Button>

					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline">
								<ArrowRightLeft aria-hidden="true" />
								<span className="max-sm:sr-only">Compare</span>
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
										With the original ({original.experiment.title})
									</Link>
								</DropdownMenuItem>
							)}
							<DropdownMenuItem asChild>
								<Link to="/compare" search={{ a: id }}>
									With another experiment…
								</Link>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline">
								<Download aria-hidden="true" />
								<span className="max-sm:sr-only">Export</span>
								<ChevronDown className="opacity-60" aria-hidden="true" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-64">
							<DropdownMenuItem onSelect={() => exportExperiment(experiment)}>
								Experiment (.json)
								<span className="ml-auto text-muted-foreground text-xs">
									input
								</span>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuLabel className="font-normal text-muted-foreground text-xs">
								{currentResult
									? "From the current results"
									: "Run first to export results"}
							</DropdownMenuLabel>
							<DropdownMenuItem
								disabled={!currentResult}
								onSelect={() => currentResult && exportResult(currentResult)}
							>
								Result with metrics (.json)
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={!currentResult?.log}
								onSelect={() => currentResult && exportEventsCsv(currentResult)}
							>
								Event log (.csv)
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" aria-label="More actions">
								<EllipsisVertical />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{isBuiltIn && (
								<DropdownMenuItem
									onSelect={() => {
										resetToBuiltIn(id);
										toast("Reset to the original example", {
											description: "Undo with Ctrl+Z.",
										});
									}}
								>
									<RotateCcw aria-hidden="true" />
									Reset to original example
								</DropdownMenuItem>
							)}
							<DropdownMenuItem
								variant="destructive"
								onSelect={() => {
									const removed = remove(id);
									if (!removed) return;
									void navigate({ to: "/" });
									toast(`Deleted “${experiment.title}”`, {
										action: {
											label: "Undo",
											onClick: () => restoreEntry(removed.entry, removed.index),
										},
									});
								}}
							>
								<Trash2 aria-hidden="true" />
								Delete experiment
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					<Button
						onClick={run}
						disabled={!validation.valid || running}
						title={
							validation.valid
								? "Run (Ctrl+Enter)"
								: "Fix the problems listed below first"
						}
						className="min-w-28"
					>
						{running ? (
							<LoaderCircle className="animate-spin" aria-hidden="true" />
						) : (
							<Play aria-hidden="true" />
						)}
						{result ? "Run again" : "Run"}
					</Button>
				</div>
			</div>
		</div>
	);
}

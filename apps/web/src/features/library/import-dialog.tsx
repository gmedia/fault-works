import {
	type Experiment,
	type ImportedRun,
	type ImportResult,
	parseImportJson,
} from "@faultworks/experiment";
import { useNavigate } from "@tanstack/react-router";
import { FileUp, TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { cn } from "#/lib/utils.ts";
import { useLibrary } from "#/state/library.ts";
import { useRuns } from "#/state/runs.ts";
import { validate } from "#/state/validation.ts";

interface Placed {
	id: string;
	reused: boolean;
	renamedFrom: string | null;
}

/**
 * Adds an imported experiment, or reuses an existing one that already has the same title and the
 * same behavior, so importing a file twice never creates look-alike duplicates.
 */
function place(experiment: Experiment): Placed {
	const { entries, add } = useLibrary.getState();
	const key = validate(experiment).runKey;
	const twin = Object.values(entries).find(
		(e) =>
			e.experiment.title === experiment.title &&
			validate(e.experiment).runKey === key,
	);
	if (twin)
		return {
			id: twin.experiment.experimentId,
			reused: true,
			renamedFrom: null,
		};
	const clash = entries[experiment.experimentId] !== undefined;
	const id = add(
		clash
			? { ...experiment, title: `${experiment.title} (imported)`.slice(0, 120) }
			: experiment,
		"imported",
	);
	return {
		id,
		reused: false,
		renamedFrom: clash ? experiment.experimentId : null,
	};
}

function describePlacement(
	title: string,
	placed: Placed,
	migratedFrom: string | null,
): string {
	return [
		placed.reused
			? `“${title}” is already in this browser with the same settings, so the existing copy is used.`
			: null,
		placed.renamedFrom
			? `A different experiment already uses the id ${placed.renamedFrom}, so this one is saved as ${placed.id} and marked “(imported)”.`
			: null,
		migratedFrom ? `Upgraded from schema ${migratedFrom}.` : null,
	]
		.filter(Boolean)
		.join(" ");
}

/**
 * Import from a file (picker or drop) or pasted JSON. Accepts experiment, result and comparison
 * files. Input is parsed as data only: it is size-limited, schema-validated and never executed.
 * Result claims (digests, counts) are queued so the next run can verify them.
 */
export function ImportDialog({ trigger }: { trigger: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const [result, setResult] = useState<ImportResult | null>(null);
	const [source, setSource] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const setVerification = useRuns((s) => s.setVerification);
	const navigate = useNavigate();
	const textId = useId();
	const errorId = useId();

	const reset = () => {
		setText("");
		setResult(null);
		setSource(null);
	};

	const queueVerification = (id: string, run: ImportedRun, from: string) => {
		if (run.claimed) setVerification(id, { ...run.claimed, source: from });
	};

	const accept = (parsed: ImportResult, from: string) => {
		setResult(parsed);
		if (!parsed.ok) return;
		setOpen(false);
		reset();
		if (parsed.kind === "comparison") {
			const a = place(parsed.a.experiment);
			const b = place(parsed.b.experiment);
			queueVerification(a.id, parsed.a, from);
			queueVerification(b.id, parsed.b, from);
			toast.success("Imported a comparison", {
				description:
					[
						describePlacement(
							parsed.a.experiment.title,
							a,
							parsed.a.migratedFrom,
						),
						describePlacement(
							parsed.b.experiment.title,
							b,
							parsed.b.migratedFrom,
						),
					]
						.filter(Boolean)
						.join(" ") ||
					"Both experiments run again now so their results can be checked.",
			});
			void navigate({ to: "/compare", search: { a: a.id, b: b.id } });
			return;
		}
		const placed = place(parsed.experiment);
		queueVerification(placed.id, parsed, from);
		toast.success(
			parsed.kind === "result"
				? `Imported the experiment inside the result file “${parsed.experiment.title}”`
				: `Imported “${parsed.experiment.title}”`,
			{
				description:
					[
						describePlacement(
							parsed.experiment.title,
							placed,
							parsed.migratedFrom,
						),
						parsed.kind === "result"
							? "It runs again now and the numbers are checked against the file."
							: null,
					]
						.filter(Boolean)
						.join(" ") || undefined,
			},
		);
		void navigate({
			to: "/experiments/$experimentId",
			params: { experimentId: placed.id },
		});
	};

	const readFile = async (file: File) => {
		setSource(file.name);
		if (file.size > 16 * 1024 * 1024) {
			setResult({
				ok: false,
				issues: [
					{
						path: "",
						message: `${file.name} is ${Math.ceil(file.size / 1024)} KB, which is more than FaultWorks ever exports.`,
					},
				],
			});
			return;
		}
		const content = await file.text();
		setText(content);
		accept(parseImportJson(content), file.name);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				setOpen(v);
				if (!v) reset();
			}}
		>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Import an experiment</DialogTitle>
					<DialogDescription>
						Choose a FaultWorks <span className="font-mono">.json</span> file or
						paste its contents: an experiment, a result (it is re-run and
						checked) or a comparison (both sides come in). Files are checked
						against the schema and stay in this browser.
					</DialogDescription>
				</DialogHeader>

				{/* biome-ignore lint/a11y/noStaticElementInteractions: dropping is a pointer shortcut; the "Choose file" button and the paste field are the keyboard paths. */}
				<div
					onDragOver={(e) => {
						e.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={(e) => {
						e.preventDefault();
						setDragging(false);
						const file = e.dataTransfer.files[0];
						if (file) void readFile(file);
					}}
					className={cn(
						"flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
						dragging ? "border-ring bg-accent" : "border-input",
					)}
				>
					<FileUp className="size-5 text-muted-foreground" aria-hidden="true" />
					<p className="text-sm">Drop a file here, or</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => fileInput.current?.click()}
					>
						Choose file
					</Button>
					<input
						ref={fileInput}
						type="file"
						accept="application/json,.json"
						className="sr-only"
						tabIndex={-1}
						aria-hidden="true"
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) void readFile(file);
							e.target.value = "";
						}}
					/>
					{source && (
						<p className="font-mono text-muted-foreground text-xs">{source}</p>
					)}
				</div>

				<div className="grid gap-2">
					<Label htmlFor={textId}>Or paste JSON</Label>
					<Textarea
						id={textId}
						value={text}
						onChange={(e) => {
							setText(e.target.value);
							setResult(null);
							setSource(null);
						}}
						rows={6}
						spellCheck={false}
						className="max-h-60 font-mono text-xs"
						placeholder='{ "schemaVersion": "0.1.0", … }'
						aria-describedby={result && !result.ok ? errorId : undefined}
						aria-invalid={result !== null && !result.ok}
					/>
				</div>

				{result && !result.ok && (
					<div
						id={errorId}
						role="alert"
						className="max-h-48 overflow-y-auto rounded-md border border-down/40 bg-down-soft p-3 text-sm"
					>
						<p className="flex items-center gap-2 font-medium text-down">
							<TriangleAlert className="size-4" aria-hidden="true" />
							This experiment can’t be imported yet ({result.issues.length}{" "}
							problem
							{result.issues.length === 1 ? "" : "s"})
						</p>
						<ul className="mt-2 space-y-1">
							{result.issues.slice(0, 12).map((issue) => (
								<li key={`${issue.path}:${issue.message}`}>
									{issue.path && (
										<span className="font-mono text-xs">{issue.path}: </span>
									)}
									{issue.message}
								</li>
							))}
							{result.issues.length > 12 && (
								<li>…and {result.issues.length - 12} more.</li>
							)}
						</ul>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						disabled={text.trim() === "" || (result !== null && !result.ok)}
						onClick={() => accept(parseImportJson(text), "pasted JSON")}
					>
						Import
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

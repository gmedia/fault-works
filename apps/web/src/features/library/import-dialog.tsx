import {
	type Experiment,
	type ImportedRun,
	type ImportResult,
	parseImportJson,
} from "@faultworks/experiment";
import { useNavigate } from "@tanstack/react-router";
import { FileUp, TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useMessage } from "#/features/workbench/fields.tsx";
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
function place(experiment: Experiment, importedSuffix: string): Placed {
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
			? {
					...experiment,
					title: `${experiment.title} (${importedSuffix})`.slice(0, 120),
				}
			: experiment,
		"imported",
	);
	return {
		id,
		reused: false,
		renamedFrom: clash ? experiment.experimentId : null,
	};
}

/**
 * Import from a file (picker or drop) or pasted JSON. Accepts experiment, result and comparison
 * files. Input is parsed as data only: it is size-limited, schema-validated and never executed.
 * Result claims (digests, counts) are queued so the next run can verify them.
 */
export function ImportDialog({ trigger }: { trigger: ReactNode }) {
	const { t } = useTranslation();
	const message = useMessage();
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

	const describePlacement = (
		title: string,
		placed: Placed,
		migratedFrom: string | null,
	) =>
		[
			placed.reused ? t("import.reused", { title }) : null,
			placed.renamedFrom
				? t("import.renamed", { from: placed.renamedFrom, id: placed.id })
				: null,
			migratedFrom ? t("import.upgraded", { from: migratedFrom }) : null,
		]
			.filter(Boolean)
			.join(" ");

	const queueVerification = (id: string, run: ImportedRun, from: string) => {
		if (run.claimed) setVerification(id, { ...run.claimed, source: from });
	};

	const accept = (parsed: ImportResult, from: string) => {
		setResult(parsed);
		if (!parsed.ok) return;
		setOpen(false);
		reset();
		if (parsed.kind === "comparison") {
			const a = place(parsed.a.experiment, t("import.suffix"));
			const b = place(parsed.b.experiment, t("import.suffix"));
			queueVerification(a.id, parsed.a, from);
			queueVerification(b.id, parsed.b, from);
			toast.success(t("import.comparisonDone"), {
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
						.join(" ") || t("import.comparisonHint"),
			});
			void navigate({ to: "/compare", search: { a: a.id, b: b.id } });
			return;
		}
		const placed = place(parsed.experiment, t("import.suffix"));
		queueVerification(placed.id, parsed, from);
		toast.success(
			parsed.kind === "result"
				? t("import.resultDone", { title: parsed.experiment.title })
				: t("import.done", { title: parsed.experiment.title }),
			{
				description:
					[
						describePlacement(
							parsed.experiment.title,
							placed,
							parsed.migratedFrom,
						),
						parsed.kind === "result" ? t("import.resultHint") : null,
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
						message: {
							key: "import.tooLargeBundle",
							params: { kb: Math.ceil(file.size / 1024) },
						},
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
					<DialogTitle>{t("import.title")}</DialogTitle>
					<DialogDescription>{t("import.description")}</DialogDescription>
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
					<p className="text-sm">{t("import.drop")}</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => fileInput.current?.click()}
					>
						{t("import.chooseFile")}
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
					<Label htmlFor={textId}>{t("import.paste")}</Label>
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
						placeholder='{ "schemaVersion": "0.2.0", … }'
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
							{t("import.failed", { count: result.issues.length })}
						</p>
						<ul className="mt-2 space-y-1">
							{result.issues.slice(0, 12).map((issue) => (
								<li key={`${issue.path}:${issue.message.key}`}>
									{issue.path && (
										<span className="font-mono text-xs">{issue.path}: </span>
									)}
									{message(issue)}
								</li>
							))}
							{result.issues.length > 12 && (
								<li>
									{t("import.more", { count: result.issues.length - 12 })}
								</li>
							)}
						</ul>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => setOpen(false)}>
						{t("common.cancel")}
					</Button>
					<Button
						disabled={text.trim() === "" || (result !== null && !result.ok)}
						onClick={() => accept(parseImportJson(text), t("import.pasted"))}
					>
						{t("import.action")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

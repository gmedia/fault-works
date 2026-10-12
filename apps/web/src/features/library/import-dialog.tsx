import { type ParseResult, parseExperimentJson } from "@faultworks/experiment";
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

/**
 * Import from a file (picker or drop) or pasted JSON. Input is parsed as data only: it is
 * size-limited, schema-validated and never executed.
 */
export function ImportDialog({ trigger }: { trigger: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const [result, setResult] = useState<ParseResult | null>(null);
	const [source, setSource] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const add = useLibrary((s) => s.add);
	const navigate = useNavigate();
	const textId = useId();
	const errorId = useId();

	const reset = () => {
		setText("");
		setResult(null);
		setSource(null);
	};

	const accept = (parsed: ParseResult) => {
		setResult(parsed);
		if (!parsed.ok) return;
		const id = add(parsed.experiment, "imported");
		setOpen(false);
		reset();
		toast.success(`Imported “${parsed.experiment.title}”`, {
			description:
				[
					parsed.migratedFrom
						? `Upgraded from schema ${parsed.migratedFrom}.`
						: null,
					id !== parsed.experiment.experimentId
						? `An experiment with id ${parsed.experiment.experimentId} already existed, so this one is saved as ${id}.`
						: null,
				]
					.filter(Boolean)
					.join(" ") || undefined,
		});
		void navigate({
			to: "/experiments/$experimentId",
			params: { experimentId: id },
		});
	};

	const readFile = async (file: File) => {
		setSource(file.name);
		if (file.size > 512 * 1024) {
			setResult({
				ok: false,
				issues: [
					{
						path: "",
						message: `${file.name} is ${Math.ceil(file.size / 1024)} KB; experiments are limited to 512 KB.`,
					},
				],
			});
			return;
		}
		const content = await file.text();
		setText(content);
		accept(parseExperimentJson(content));
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
						paste its contents. The file is checked against the schema and stays
						in this browser.
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
						disabled={text.trim() === ""}
						onClick={() => accept(parseExperimentJson(text))}
					>
						Import
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

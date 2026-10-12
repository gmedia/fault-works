import {
	type Experiment,
	findBuiltIn,
	STARTER_COMPARISON,
	uniqueId,
} from "@faultworks/experiment";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";
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
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { useLibrary } from "#/state/library.ts";

/**
 * Starts a new experiment from the two-server template. The title comes first because it also
 * names the file people will share (`<id>.experiment.json`).
 */
export function NewExperimentDialog({ trigger }: { trigger: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState("");
	const add = useLibrary((s) => s.add);
	const entries = useLibrary((s) => s.entries);
	const taken = Object.keys(entries);
	const navigate = useNavigate();
	const titleId = useId();
	const hintId = useId();
	const id = uniqueId(title.trim() || "untitled-experiment", taken);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		const template = structuredClone(
			findBuiltIn(STARTER_COMPARISON.a) as Experiment,
		);
		template.experimentId = id;
		template.title = title.trim() || "Untitled experiment";
		template.question = "";
		template.description = "";
		template.faults = [];
		template.expectedObservations = [];
		const created = add(template, "created");
		setOpen(false);
		setTitle("");
		void navigate({
			to: "/experiments/$experimentId",
			params: { experimentId: created },
			search: { panel: "notes" },
		});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={submit} className="grid gap-4">
					<DialogHeader>
						<DialogTitle>New experiment</DialogTitle>
						<DialogDescription>
							Starts from a client, a load balancer and two healthy servers. Add
							servers, traffic and faults next.
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-1.5">
						<Label htmlFor={titleId}>Title</Label>
						<Input
							id={titleId}
							value={title}
							maxLength={120}
							autoFocus
							placeholder="e.g. Lab 3: three servers, one crashes"
							onChange={(e) => setTitle(e.target.value)}
							aria-describedby={hintId}
						/>
						<p id={hintId} className="text-muted-foreground text-xs">
							File name: <span className="font-mono">{id}.experiment.json</span>
						</p>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
						>
							Cancel
						</Button>
						<Button type="submit">Create</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

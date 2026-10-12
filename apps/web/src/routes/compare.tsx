import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeftRight } from "lucide-react";
import { useEffect, useId } from "react";
import { z } from "zod";
import { Button } from "#/components/ui/button.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { CompareView } from "#/features/compare/compare-view.tsx";
import { useDocumentTitle } from "#/lib/use-document-title.ts";
import { useLibrary } from "#/state/library.ts";

const searchSchema = z.object({
	a: z.string().optional().catch(undefined),
	b: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/compare")({
	validateSearch: searchSchema,
	component: ComparePage,
});

function Picker({
	label,
	hint,
	value,
	exclude,
	onChange,
	color,
}: {
	label: string;
	hint: string;
	value: string | undefined;
	exclude?: string;
	onChange: (id: string) => void;
	color: string;
}) {
	const id = useId();
	const entries = useLibrary((s) => s.entries);
	const order = useLibrary((s) => s.order);
	return (
		<div className="grid min-w-0 flex-1 gap-1.5">
			<Label htmlFor={id} className="flex items-center gap-2">
				<span
					className="inline-block h-0.5 w-4 rounded-full"
					style={{ background: color }}
					aria-hidden="true"
				/>
				{label}
			</Label>
			<Select
				value={value && entries[value] ? value : undefined}
				onValueChange={onChange}
			>
				<SelectTrigger
					id={id}
					className="w-full bg-card"
					aria-describedby={`${id}-hint`}
				>
					<SelectValue placeholder="Choose an experiment" />
				</SelectTrigger>
				<SelectContent>
					{order
						.filter((x) => x !== exclude && entries[x])
						.map((x) => (
							<SelectItem key={x} value={x}>
								{entries[x]?.experiment.title}
							</SelectItem>
						))}
				</SelectContent>
			</Select>
			<p id={`${id}-hint`} className="text-muted-foreground text-xs">
				{hint}
			</p>
		</div>
	);
}

function ComparePage() {
	const { a, b } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const entryA = useLibrary((s) => (a ? s.entries[a] : undefined));
	const entryB = useLibrary((s) => (b ? s.entries[b] : undefined));
	useDocumentTitle(
		entryA && entryB
			? `Compare: ${entryA.experiment.title} vs ${entryB.experiment.title}`
			: "Compare",
	);

	const set = (patch: { a?: string; b?: string }) =>
		void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

	// Opened with only a variant: its original is the natural baseline.
	const suggestedA = !a && entryB?.basedOn ? entryB.basedOn : undefined;
	const hasSuggestion = useLibrary((s) =>
		suggestedA ? s.entries[suggestedA] !== undefined : false,
	);
	useEffect(() => {
		if (suggestedA && hasSuggestion)
			void navigate({
				search: (prev) => ({ ...prev, a: suggestedA }),
				replace: true,
			});
	}, [suggestedA, hasSuggestion, navigate]);

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
			<h1 className="font-semibold text-3xl tracking-tight">
				Compare two experiments
			</h1>
			<p className="mt-3 max-w-2xl text-muted-foreground">
				Pick a baseline (A) and a variant (B). A comparison teaches the most
				when exactly one behavior setting differs between them.
			</p>

			<div className="mt-8 flex flex-col gap-4 rounded-lg border bg-muted/40 p-4 sm:flex-row sm:items-start">
				<Picker
					label="A · baseline"
					hint="What you compare against"
					value={a}
					exclude={b}
					onChange={(v) => set({ a: v })}
					color="var(--series-1)"
				/>
				<Button
					variant="outline"
					size="icon"
					className="self-center sm:mt-6"
					aria-label="Swap A and B"
					disabled={!a && !b}
					onClick={() => set({ a: b, b: a })}
				>
					<ArrowLeftRight />
				</Button>
				<Picker
					label="B · variant"
					hint="The version with one change"
					value={b}
					exclude={a}
					onChange={(v) => set({ b: v })}
					color="var(--series-2)"
				/>
			</div>

			<div className="mt-10">
				{entryA && entryB ? (
					<CompareView
						key={`${a}|${b}`}
						a={{ id: a as string, experiment: entryA.experiment }}
						b={{ id: b as string, experiment: entryB.experiment }}
					/>
				) : (
					<p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
						{(a && !entryA) || (b && !entryB)
							? "One of the experiments in this link is not in this browser. Choose another one above."
							: "Choose two experiments above. Both run automatically in your browser."}
					</p>
				)}
			</div>
		</div>
	);
}

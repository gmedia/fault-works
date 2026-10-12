import {
	type Experiment,
	findBuiltIn,
	STARTER_COMPARISON,
	servers,
} from "@faultworks/experiment";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRightLeft,
	Copy,
	Download,
	EllipsisVertical,
	FilePlus2,
	FlaskConical,
	Search,
	Trash2,
	Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Input } from "#/components/ui/input.tsx";
import { exportExperiment } from "#/features/library/export.ts";
import { ImportDialog } from "#/features/library/import-dialog.tsx";
import { TopologyThumbnail } from "#/features/library/topology-thumbnail.tsx";
import { formatRelative } from "#/lib/format.ts";
import { useDocumentTitle } from "#/lib/use-document-title.ts";
import { type LibraryEntry, useLibrary } from "#/state/library.ts";

export const Route = createFileRoute("/")({
	component: HomePage,
});

function HomePage() {
	const entries = useLibrary((s) => s.entries);
	const order = useLibrary((s) => s.order);
	const add = useLibrary((s) => s.add);
	const restoreBuiltIns = useLibrary((s) => s.restoreBuiltIns);
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	useDocumentTitle("Experiments");

	const list = useMemo(() => {
		const q = query.trim().toLowerCase();
		return order
			.map((id) => entries[id])
			.filter((e): e is LibraryEntry => e !== undefined)
			.filter(
				(e) =>
					q === "" ||
					e.experiment.title.toLowerCase().includes(q) ||
					e.experiment.question.toLowerCase().includes(q) ||
					e.experiment.experimentId.includes(q),
			);
	}, [entries, order, query]);

	const total = order.length;
	const starterReady =
		entries[STARTER_COMPARISON.a] && entries[STARTER_COMPARISON.b];
	const missingBuiltIns =
		!entries[STARTER_COMPARISON.a] || !entries[STARTER_COMPARISON.b];

	const createNew = () => {
		const template = structuredClone(
			findBuiltIn(STARTER_COMPARISON.a) as Experiment,
		);
		template.experimentId = "untitled-experiment";
		template.title = "Untitled experiment";
		template.question = "";
		template.description = "";
		template.faults = [];
		template.expectedObservations = [];
		const id = add(template, "created");
		void navigate({
			to: "/experiments/$experimentId",
			params: { experimentId: id },
		});
	};

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
			<div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
				<div className="max-w-2xl">
					<h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">
						Failure experiments
					</h1>
					<p className="mt-3 text-lg text-muted-foreground">
						Describe a small system, break one part on purpose, and see what
						changes. Every run is reproducible from its file and seed.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<ImportDialog
						trigger={
							<Button variant="outline">
								<Upload aria-hidden="true" />
								Import
							</Button>
						}
					/>
					<Button variant="outline" onClick={createNew}>
						<FilePlus2 aria-hidden="true" />
						New experiment
					</Button>
				</div>
			</div>

			{starterReady && <StarterCard />}

			<section aria-labelledby="library-heading" className="mt-12">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<h2
						id="library-heading"
						className="font-semibold text-xl tracking-tight"
					>
						In this browser{" "}
						<span className="font-normal text-muted-foreground">({total})</span>
					</h2>
					{total > 3 && (
						<div className="relative sm:w-72">
							<Search
								className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
								aria-hidden="true"
							/>
							<Input
								type="search"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Filter by title or question"
								aria-label="Filter experiments"
								className="pl-9"
							/>
						</div>
					)}
				</div>

				{total === 0 ? (
					<div className="mt-6 rounded-lg border border-dashed p-8 text-center">
						<FlaskConical
							className="mx-auto size-6 text-muted-foreground"
							aria-hidden="true"
						/>
						<p className="mt-3 font-medium">No experiments in this browser</p>
						<p className="mt-1 text-muted-foreground text-sm">
							Bring back the five built-in examples, import a file, or start
							from a two-server template.
						</p>
						<div className="mt-4 flex flex-wrap justify-center gap-2">
							<Button
								onClick={() => {
									const n = restoreBuiltIns();
									toast.success(
										`Restored ${n} built-in example${n === 1 ? "" : "s"}`,
									);
								}}
							>
								Restore examples
							</Button>
							<Button variant="outline" onClick={createNew}>
								New experiment
							</Button>
						</div>
					</div>
				) : list.length === 0 ? (
					<p className="mt-6 rounded-lg border border-dashed p-6 text-center text-muted-foreground">
						No experiment matches “{query}”.{" "}
						<button
							type="button"
							className="underline underline-offset-4"
							onClick={() => setQuery("")}
						>
							Clear the filter
						</button>
					</p>
				) : (
					<ul className="mt-4 divide-y rounded-lg border bg-card">
						{list.map((entry) => (
							<ExperimentRow
								key={entry.experiment.experimentId}
								entry={entry}
							/>
						))}
					</ul>
				)}

				{total > 0 && missingBuiltIns && (
					<p className="mt-3 text-muted-foreground text-sm">
						Some built-in examples were removed.{" "}
						<button
							type="button"
							className="underline underline-offset-4 hover:text-foreground"
							onClick={() => {
								const n = restoreBuiltIns();
								toast.success(
									`Restored ${n} built-in example${n === 1 ? "" : "s"}`,
								);
							}}
						>
							Restore them
						</button>
					</p>
				)}
			</section>
		</div>
	);
}

function StarterCard() {
	const baseline = useLibrary((s) => s.entries[STARTER_COMPARISON.a]);
	if (!baseline) return null;
	return (
		<section
			aria-labelledby="starter-heading"
			className="mt-10 grid overflow-hidden rounded-xl border bg-card md:grid-cols-[1fr_minmax(0,22rem)]"
		>
			<div className="p-6 sm:p-8">
				<p className="text-muted-foreground text-sm">
					Start here · about 5 minutes
				</p>
				<h2
					id="starter-heading"
					className="mt-2 font-semibold text-2xl tracking-tight"
				>
					What do health checks actually save you?
				</h2>
				<p className="mt-3 max-w-prose text-muted-foreground">
					Two experiments that differ in exactly one setting. Server B crashes
					for 20 seconds while the client sends 100 requests per second. In the
					first, the load balancer never checks its backends. In the second, it
					probes them every 5 seconds.
				</p>
				<ol className="mt-5 space-y-2 text-sm">
					{[
						"Run the baseline and look at the failed requests.",
						"Run the version with health checks.",
						"Compare them and read why the numbers differ.",
					].map((step, i) => (
						<li key={step} className="flex gap-3">
							<span
								className="flex size-6 shrink-0 items-center justify-center rounded-full border font-medium text-xs tabular"
								aria-hidden="true"
							>
								{i + 1}
							</span>
							<span className="pt-0.5">{step}</span>
						</li>
					))}
				</ol>
				<div className="mt-6 flex flex-wrap gap-2">
					<Button asChild>
						<Link
							to="/experiments/$experimentId"
							params={{ experimentId: STARTER_COMPARISON.a }}
						>
							Open the baseline
						</Link>
					</Button>
					<Button asChild variant="outline">
						<Link
							to="/compare"
							search={{ a: STARTER_COMPARISON.a, b: STARTER_COMPARISON.b }}
						>
							<ArrowRightLeft aria-hidden="true" />
							Compare the pair
						</Link>
					</Button>
				</div>
			</div>
			<div className="relative hidden items-center justify-center border-l bg-background/60 p-6 md:flex">
				<StarterIllustration />
			</div>
		</section>
	);
}

/** A labeled sketch of the timeline both experiments share: crash, detection, recovery. */
function StarterIllustration() {
	return (
		<figure className="w-full">
			<svg
				viewBox="0 0 300 150"
				className="w-full"
				role="img"
				aria-labelledby="starter-fig"
			>
				<title id="starter-fig">
					Timeline: Server B is down from 20 to 40 seconds. Without health
					checks it receives traffic the whole time; with checks it is removed
					after about 5 seconds.
				</title>
				<line x1="10" y1="120" x2="290" y2="120" stroke="var(--chart-axis)" />
				{[0, 20, 40, 60].map((s) => (
					<g key={s}>
						<line
							x1={10 + s * 4.6}
							y1="118"
							x2={10 + s * 4.6}
							y2="124"
							stroke="var(--chart-axis)"
						/>
						<text
							x={10 + s * 4.6}
							y="138"
							textAnchor="middle"
							fontSize="10"
							fill="var(--muted-foreground)"
						>
							{s} s
						</text>
					</g>
				))}
				<text x="10" y="22" fontSize="10.5" fill="var(--muted-foreground)">
					No health checks
				</text>
				<rect
					x={10 + 20 * 4.6}
					y="30"
					width={20 * 4.6}
					height="22"
					rx="2"
					fill="url(#hatch)"
				/>
				<text x="10" y="76" fontSize="10.5" fill="var(--muted-foreground)">
					With health checks
				</text>
				<rect
					x={10 + 20 * 4.6}
					y="84"
					width={5 * 4.6}
					height="22"
					rx="2"
					fill="url(#hatch)"
				/>
				<rect
					x={10 + 25 * 4.6}
					y="84"
					width={15 * 4.6}
					height="22"
					rx="2"
					fill="var(--off-soft)"
					stroke="var(--border)"
				/>
				<text
					x={10 + 26 * 4.6}
					y="99"
					fontSize="9.5"
					fill="var(--muted-foreground)"
				>
					out of rotation
				</text>
				<defs>
					<pattern
						id="hatch"
						width="7"
						height="7"
						patternUnits="userSpaceOnUse"
						patternTransform="rotate(135)"
					>
						<rect
							width="7"
							height="7"
							fill="color-mix(in oklab, var(--gap-band) 16%, transparent)"
						/>
						<rect
							width="2"
							height="7"
							fill="color-mix(in oklab, var(--gap-band) 60%, transparent)"
						/>
					</pattern>
				</defs>
			</svg>
			<figcaption className="mt-2 flex items-center gap-2 text-muted-foreground text-xs">
				<span
					className="gap-hatch inline-block size-3 rounded-sm"
					aria-hidden="true"
				/>
				Down, but the load balancer still sends it requests
			</figcaption>
		</figure>
	);
}

const ORIGIN_LABEL: Record<LibraryEntry["origin"], string> = {
	"built-in": "Example",
	imported: "Imported",
	variant: "Variant",
	created: "Yours",
};

function ExperimentRow({ entry }: { entry: LibraryEntry }) {
	const { experiment } = entry;
	const remove = useLibrary((s) => s.remove);
	const restoreEntry = useLibrary((s) => s.restoreEntry);
	const createVariant = useLibrary((s) => s.createVariant);
	const basedOnTitle = useLibrary((s) =>
		entry.basedOn ? s.entries[entry.basedOn]?.experiment.title : undefined,
	);
	const navigate = useNavigate();
	const serverCount = servers(experiment).length;

	return (
		<li className="group relative flex items-start gap-4 p-4 hover:bg-accent/40 sm:items-center">
			<TopologyThumbnail
				experiment={experiment}
				className="hidden h-12 w-20 shrink-0 sm:block"
			/>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<Link
						to="/experiments/$experimentId"
						params={{ experimentId: experiment.experimentId }}
						className="font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-ring"
					>
						{experiment.title}
					</Link>
					<Badge variant="secondary" className="font-normal">
						{ORIGIN_LABEL[entry.origin]}
					</Badge>
				</div>
				{experiment.question && (
					<p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
						{experiment.question}
					</p>
				)}
				<p className="mt-1.5 text-muted-foreground text-xs">
					{serverCount} server{serverCount === 1 ? "" : "s"} ·{" "}
					{experiment.faults.length} fault
					{experiment.faults.length === 1 ? "" : "s"} ·{" "}
					{experiment.workload.offeredRps} req/s · seed{" "}
					<span className="font-mono">{experiment.seed}</span> · edited{" "}
					{formatRelative(entry.updatedAt)}
					{basedOnTitle && <> · variant of {basedOnTitle}</>}
				</p>
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="relative z-10"
						aria-label={`Actions for ${experiment.title}`}
					>
						<EllipsisVertical />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						onSelect={() => {
							const id = createVariant(experiment.experimentId);
							if (id) {
								toast.success("Variant created", {
									description:
										"Change one setting, then compare it with the original.",
								});
								void navigate({
									to: "/experiments/$experimentId",
									params: { experimentId: id },
								});
							}
						}}
					>
						<Copy aria-hidden="true" />
						Create a variant
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => exportExperiment(experiment)}>
						<Download aria-hidden="true" />
						Export JSON
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						onSelect={() => {
							const removed = remove(experiment.experimentId);
							if (!removed) return;
							toast(`Deleted “${experiment.title}”`, {
								action: {
									label: "Undo",
									onClick: () => restoreEntry(removed.entry, removed.index),
								},
							});
						}}
					>
						<Trash2 aria-hidden="true" />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</li>
	);
}

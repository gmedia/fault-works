import { type Locale, STARTER_COMPARISON } from "@faultworks/experiment";
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
import { useTranslation } from "react-i18next";
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
import { NewExperimentDialog } from "#/features/library/new-experiment-dialog.tsx";
import { TopologyThumbnail } from "#/features/library/topology-thumbnail.tsx";
import { formatRelative } from "#/lib/format.ts";
import { useDocumentTitle } from "#/lib/use-document-title.ts";
import { type LibraryEntry, useLibrary } from "#/state/library.ts";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
	const { t, i18n } = useTranslation();
	const entries = useLibrary((s) => s.entries);
	const order = useLibrary((s) => s.order);
	const restoreBuiltIns = useLibrary((s) => s.restoreBuiltIns);
	const [query, setQuery] = useState("");
	useDocumentTitle(t("nav.experiments"));

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
	const starterReady = Boolean(
		entries[STARTER_COMPARISON.a] && entries[STARTER_COMPARISON.b],
	);
	const restore = () => {
		const n = restoreBuiltIns(i18n.language as Locale);
		toast.success(t("library.restored", { count: n }));
	};

	return (
		<div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
			<div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
				<div className="max-w-2xl">
					<h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">
						{t("home.title")}
					</h1>
					<p className="mt-3 text-lg text-muted-foreground">{t("home.lead")}</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<ImportDialog
						trigger={
							<Button variant="outline">
								<Upload aria-hidden="true" />
								{t("home.import")}
							</Button>
						}
					/>
					<NewExperimentDialog
						trigger={
							<Button>
								<FilePlus2 aria-hidden="true" />
								{t("home.new")}
							</Button>
						}
					/>
				</div>
			</div>

			{starterReady && <StarterCard />}

			<section aria-labelledby="library-heading" className="mt-12">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<h2
						id="library-heading"
						className="font-semibold text-xl tracking-tight"
					>
						{t("home.inBrowser")}{" "}
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
								placeholder={t("home.filter")}
								aria-label={t("home.filterLabel")}
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
						<p className="mt-3 font-medium">{t("home.emptyTitle")}</p>
						<p className="mt-1 text-muted-foreground text-sm">
							{t("home.emptyBody")}
						</p>
						<div className="mt-4 flex flex-wrap justify-center gap-2">
							<Button onClick={restore}>{t("home.restore")}</Button>
							<NewExperimentDialog
								trigger={<Button variant="outline">{t("home.new")}</Button>}
							/>
						</div>
					</div>
				) : list.length === 0 ? (
					<p className="mt-6 rounded-lg border border-dashed p-6 text-center text-muted-foreground">
						{t("home.noMatch", { query })}{" "}
						<button
							type="button"
							className="underline underline-offset-4"
							onClick={() => setQuery("")}
						>
							{t("home.clearFilter")}
						</button>
					</p>
				) : (
					<ul className="mt-4 grid gap-3 sm:grid-cols-2">
						{list.map((entry) => (
							<ExperimentCard
								key={entry.experiment.experimentId}
								entry={entry}
							/>
						))}
					</ul>
				)}

				{total > 0 && !starterReady && (
					<p className="mt-3 text-muted-foreground text-sm">
						{t("home.someRemoved")}{" "}
						<button
							type="button"
							className="underline underline-offset-4 hover:text-foreground"
							onClick={restore}
						>
							{t("home.restoreThem")}
						</button>
					</p>
				)}
			</section>
		</div>
	);
}

function StarterCard() {
	const { t } = useTranslation();
	return (
		<section
			aria-labelledby="starter-heading"
			className="mt-10 grid overflow-hidden rounded-xl border bg-card md:grid-cols-[1fr_minmax(0,20rem)]"
		>
			<div className="p-6 sm:p-8">
				<p className="text-muted-foreground text-sm">{t("starter.kicker")}</p>
				<h2
					id="starter-heading"
					className="mt-2 font-semibold text-2xl tracking-tight"
				>
					{t("starter.title")}
				</h2>
				<p className="mt-3 max-w-prose text-muted-foreground">
					{t("starter.body")}
				</p>
				<ol className="mt-5 space-y-2 text-sm">
					{(t("starter.steps", { returnObjects: true }) as string[]).map(
						(step, i) => (
							<li key={step} className="flex gap-3">
								<span
									className="flex size-6 shrink-0 items-center justify-center rounded-full border font-medium text-xs tabular"
									aria-hidden="true"
								>
									{i + 1}
								</span>
								<span className="pt-0.5">{step}</span>
							</li>
						),
					)}
				</ol>
				<p className="mt-4 max-w-prose text-muted-foreground text-sm">
					{t("starter.note")}
				</p>
				<div className="mt-6 flex flex-wrap gap-2">
					<Button asChild>
						<Link
							to="/experiments/$experimentId"
							params={{ experimentId: STARTER_COMPARISON.a }}
						>
							{t("starter.open")}
						</Link>
					</Button>
					<Button asChild variant="outline">
						<Link
							to="/compare"
							search={{ a: STARTER_COMPARISON.a, b: STARTER_COMPARISON.b }}
						>
							<ArrowRightLeft aria-hidden="true" />
							{t("starter.compare")}
						</Link>
					</Button>
				</div>
			</div>
			<div className="hidden items-center justify-center border-l bg-background/60 p-6 md:flex">
				<StarterIllustration />
			</div>
		</section>
	);
}

/** A labeled sketch of the timeline both experiments share: crash, detection, recovery. */
function StarterIllustration() {
	const { t } = useTranslation();
	return (
		<figure className="w-full">
			<svg
				viewBox="0 0 300 150"
				className="w-full"
				role="img"
				aria-labelledby="starter-fig"
			>
				<title id="starter-fig">{t("starter.figure")}</title>
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
							{s} {t("units.s")}
						</text>
					</g>
				))}
				<text x="10" y="22" fontSize="10.5" fill="var(--muted-foreground)">
					{t("starter.noChecks")}
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
					{t("starter.withChecks")}
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
					{t("starter.outOfRotation")}
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
				{t("bands.legend.gap")}
			</figcaption>
		</figure>
	);
}

function ExperimentCard({ entry }: { entry: LibraryEntry }) {
	const { t } = useTranslation();
	const { experiment } = entry;
	const remove = useLibrary((s) => s.remove);
	const restoreEntry = useLibrary((s) => s.restoreEntry);
	const createVariant = useLibrary((s) => s.createVariant);
	const basedOnTitle = useLibrary((s) =>
		entry.basedOn ? s.entries[entry.basedOn]?.experiment.title : undefined,
	);
	const navigate = useNavigate();
	const nodes = experiment.model.nodes.length - 1;

	return (
		<li className="group relative flex gap-4 rounded-lg border bg-card p-4 hover:border-input">
			<TopologyThumbnail
				experiment={experiment}
				className="h-14 w-24 shrink-0"
			/>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<Link
						to="/experiments/$experimentId"
						params={{ experimentId: experiment.experimentId }}
						className="font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-ring"
					>
						{experiment.title}
					</Link>
					<Badge variant="secondary" className="font-normal">
						{t(`origin.${entry.origin}`)}
					</Badge>
				</div>
				{experiment.question && (
					<p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
						{experiment.question}
					</p>
				)}
				<p className="mt-1.5 text-muted-foreground text-xs">
					{t("library.meta", {
						nodes,
						faults: experiment.faults.length,
						rps: experiment.workload.offeredRps,
						when: formatRelative(entry.updatedAt),
					})}
					{basedOnTitle &&
						` · ${t("library.variantOf", { title: basedOnTitle })}`}
				</p>
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="relative z-10 shrink-0"
						aria-label={t("library.actionsFor", { title: experiment.title })}
					>
						<EllipsisVertical />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						onSelect={() => {
							const id = createVariant(
								experiment.experimentId,
								t("variant.suffix"),
								t("variant.descriptionPrompt", { title: experiment.title }),
							);
							if (id) {
								toast.success(t("variant.created"), {
									description: t("variant.createdHint"),
								});
								void navigate({
									to: "/experiments/$experimentId",
									params: { experimentId: id },
								});
							}
						}}
					>
						<Copy aria-hidden="true" />
						{t("actions.variant")}
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => exportExperiment(experiment)}>
						<Download aria-hidden="true" />
						{t("export.experiment")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						onSelect={() => {
							const removed = remove(experiment.experimentId);
							if (!removed) return;
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
		</li>
	);
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "#/components/ui/button.tsx";
import { Workbench } from "#/features/workbench/workbench.tsx";
import { useDocumentTitle } from "#/lib/use-document-title.ts";
import { useEntry } from "#/state/library.ts";

const searchSchema = z.object({
	node: z.string().optional().catch(undefined),
	link: z.string().optional().catch(undefined),
	panel: z
		.enum(["component", "traffic", "faults", "run", "notes"])
		.optional()
		.catch(undefined),
	tab: z
		.enum(["overview", "explain", "events", "checks"])
		.optional()
		.catch(undefined),
	screen: z.enum(["build", "replay", "results"]).optional().catch(undefined),
});

export const Route = createFileRoute("/experiments/$experimentId")({
	validateSearch: searchSchema,
	component: ExperimentPage,
});

function ExperimentPage() {
	const { t } = useTranslation();
	const { experimentId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const entry = useEntry(experimentId);
	useDocumentTitle(entry?.experiment.title ?? t("missing.title"));

	if (!entry)
		return (
			<div className="mx-auto max-w-xl px-4 py-24">
				<h1 className="font-semibold text-2xl tracking-tight">
					{t("missing.title")}
				</h1>
				<p className="mt-3 text-muted-foreground">
					{t("missing.body", { id: experimentId })}
				</p>
				<Button asChild className="mt-6">
					<Link to="/">{t("missing.back")}</Link>
				</Button>
			</div>
		);

	const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
		void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
	const selection = search.node
		? { type: "node" as const, id: search.node }
		: search.link
			? { type: "link" as const, id: search.link }
			: null;

	return (
		<Workbench
			key={experimentId}
			id={experimentId}
			selection={selection}
			onSelect={(sel) =>
				setSearch({
					node: sel?.type === "node" ? sel.id : undefined,
					link: sel?.type === "link" ? sel.id : undefined,
				})
			}
			inspectorTab={search.panel ?? (selection ? "component" : "traffic")}
			onInspectorTab={(panel) => setSearch({ panel })}
			resultsTab={search.tab ?? "overview"}
			onResultsTab={(tab) => setSearch({ tab })}
			phoneTab={search.screen ?? "build"}
			onPhoneTab={(screen) => setSearch({ screen })}
		/>
	);
}

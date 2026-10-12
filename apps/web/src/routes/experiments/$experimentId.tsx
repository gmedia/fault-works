import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "#/components/ui/button.tsx";
import { Workbench } from "#/features/workbench/workbench.tsx";
import { useDocumentTitle } from "#/lib/use-document-title.ts";
import { useEntry } from "#/state/library.ts";

const searchSchema = z.object({
	node: z.string().optional().catch(undefined),
	panel: z
		.enum(["component", "traffic", "faults", "run", "notes"])
		.optional()
		.catch(undefined),
	tab: z
		.enum(["overview", "explain", "events", "checks"])
		.optional()
		.catch(undefined),
});

export const Route = createFileRoute("/experiments/$experimentId")({
	validateSearch: searchSchema,
	component: ExperimentPage,
});

function ExperimentPage() {
	const { experimentId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const entry = useEntry(experimentId);
	useDocumentTitle(entry?.experiment.title ?? "Experiment not found");

	if (!entry)
		return (
			<div className="mx-auto max-w-xl px-4 py-24">
				<h1 className="font-semibold text-2xl tracking-tight">
					This experiment is not in this browser
				</h1>
				<p className="mt-3 text-muted-foreground">
					There is no experiment with the id{" "}
					<span className="font-mono">{experimentId}</span> here. It may have
					been deleted, or it was created in another browser. Experiments are
					shared by exporting and importing their JSON file.
				</p>
				<Button asChild className="mt-6">
					<Link to="/">Go to experiments</Link>
				</Button>
			</div>
		);

	const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
		void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

	return (
		<Workbench
			key={experimentId}
			id={experimentId}
			selectedNode={search.node ?? null}
			onSelectNode={(node) => setSearch({ node: node ?? undefined })}
			inspectorTab={search.panel ?? (search.node ? "component" : "traffic")}
			onInspectorTab={(panel) => setSearch({ panel })}
			resultsTab={search.tab ?? "overview"}
			onResultsTab={(tab) => setSearch({ tab })}
		/>
	);
}

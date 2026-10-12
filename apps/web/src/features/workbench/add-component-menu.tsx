import {
	addNode,
	CATALOG_CATEGORIES,
	type CatalogEntry,
	canAddNode,
	LIMITS,
} from "@faultworks/experiment";
import { Plus } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { ADDABLE, catalogIcon } from "#/lib/nodes.ts";
import { cn } from "#/lib/utils.ts";
import { useWorkbench } from "./context.tsx";
import { lastLeaf } from "./layers.ts";

/**
 * The component catalog as a menu, grouped by category. The new component is linked from `from`
 * (or inserted after it when `from` can only call one component).
 */
export function AddComponentMenu({
	from,
	label,
	onAdded,
	className,
	variant = "outline",
	size = "sm",
	align = "start",
}: {
	from: string | undefined;
	label?: string;
	onAdded?: (id: string) => void;
	className?: string;
	variant?: "outline" | "default";
	size?: "sm" | "default";
	align?: "start" | "end";
}) {
	const { t } = useTranslation();
	const { experiment, update, select, setInspectorTab } = useWorkbench();
	const canAdd = canAddNode(experiment);
	const add = (entry: CatalogEntry) => {
		// With nothing selected, continue the chain from its end instead of leaving the new
		// component unconnected; links to anything else can be drawn afterwards.
		const { experiment: next, id } = addNode(experiment, entry.kind, {
			from: from ?? lastLeaf(experiment),
			preset: entry.id,
			label: t(`catalog.${entry.id}.label`),
		});
		update(() => next);
		select({ type: "node", id });
		setInspectorTab("component");
		onAdded?.(id);
	};
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant={variant}
					size={size}
					className={cn("bg-card", className)}
					disabled={!canAdd}
					title={
						canAdd
							? undefined
							: t("inspector.maxNodes", { max: LIMITS.maxNodes })
					}
				>
					<Plus aria-hidden="true" />
					{label ?? t("canvas.addComponent")}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align={align}
				className="max-h-[70dvh] w-80 overflow-y-auto"
			>
				{CATALOG_CATEGORIES.map((category, i) => (
					<Fragment key={category}>
						{i > 0 && <DropdownMenuSeparator />}
						<DropdownMenuLabel className="text-muted-foreground text-xs">
							{t(`catalog.categories.${category}`)}
						</DropdownMenuLabel>
						{ADDABLE.filter((e) => e.category === category).map((entry) => {
							const Icon = catalogIcon(entry);
							return (
								<DropdownMenuItem
									key={entry.id}
									onSelect={() => add(entry)}
									className="items-start"
								>
									<Icon className="mt-0.5" aria-hidden="true" />
									<span className="grid gap-0.5">
										<span>{t(`catalog.${entry.id}.label`)}</span>
										<span className="text-muted-foreground text-xs leading-snug">
											{t(`catalog.${entry.id}.hint`)}
										</span>
									</span>
								</DropdownMenuItem>
							);
						})}
					</Fragment>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

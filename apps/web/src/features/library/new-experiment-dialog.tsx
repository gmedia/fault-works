import {
	TEMPLATE_IDS,
	type TemplateId,
	templateExperiment,
	uniqueId,
} from "@faultworks/experiment";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { cn } from "#/lib/utils.ts";
import { useLibrary } from "#/state/library.ts";
import { TopologyThumbnail } from "./topology-thumbnail.tsx";

/** Starts a new experiment from a template. The title names the file people will share. */
export function NewExperimentDialog({
	trigger,
	defaultOpen = false,
}: {
	trigger: ReactNode;
	defaultOpen?: boolean;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(defaultOpen);
	const [title, setTitle] = useState("");
	const [template, setTemplate] = useState<TemplateId>("api-database");
	const entries = useLibrary((s) => s.entries);
	const add = useLibrary((s) => s.add);
	const navigate = useNavigate();
	const titleId = useId();
	const hintId = useId();
	const id = uniqueId(
		title.trim() || t("new.untitledId"),
		Object.keys(entries),
	);
	const text = {
		client: t("defaults.client"),
		balancer: t("defaults.load-balancer"),
		api: t("defaults.api"),
		database: t("defaults.database"),
		cache: t("defaults.cache"),
		queue: t("defaults.queue"),
		auth: t("defaults.auth"),
		worker: t("defaults.worker"),
		server: (letter: string) => t("defaults.server", { letter }),
		assumptions: t("defaults.assumptions", { returnObjects: true }) as string[],
	};

	const submit = (e: FormEvent) => {
		e.preventDefault();
		const experiment = templateExperiment(
			template,
			id,
			title.trim() || t("new.untitled"),
			text,
		);
		const created = add(experiment, "created");
		setOpen(false);
		setTitle("");
		void navigate({
			to: "/experiments/$experimentId",
			params: { experimentId: created },
			search: { panel: template === "blank" ? "component" : "faults" },
		});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
				<form onSubmit={submit} className="grid gap-5">
					<DialogHeader>
						<DialogTitle>{t("new.title")}</DialogTitle>
						<DialogDescription>{t("new.description")}</DialogDescription>
					</DialogHeader>
					<fieldset className="grid gap-2">
						<legend className="mb-1 font-medium text-sm">
							{t("new.template")}
						</legend>
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
							{TEMPLATE_IDS.map((tid) => {
								const preview = templateExperiment(tid, "preview", "", text);
								return (
									<label
										key={tid}
										className={cn(
											"grid cursor-pointer gap-2 rounded-lg border p-3 text-left text-sm transition-colors hover:border-input",
											template === tid && "border-ring ring-2 ring-ring/30",
										)}
									>
										<input
											type="radio"
											name="template"
											value={tid}
											checked={template === tid}
											onChange={() => setTemplate(tid)}
											className="sr-only"
										/>
										<TopologyThumbnail
											experiment={preview}
											className="h-12 w-full"
										/>
										<span className="font-medium">
											{t(`templates.${tid}.title`)}
										</span>
										<span className="text-muted-foreground text-xs">
											{t(`templates.${tid}.description`)}
										</span>
									</label>
								);
							})}
						</div>
					</fieldset>
					<div className="grid gap-1.5">
						<Label htmlFor={titleId}>{t("notes.title")}</Label>
						<Input
							id={titleId}
							value={title}
							maxLength={120}
							placeholder={t("new.titlePlaceholder")}
							onChange={(e) => setTitle(e.target.value)}
							aria-describedby={hintId}
						/>
						<p id={hintId} className="text-muted-foreground text-xs">
							{t("new.fileName")}{" "}
							<span className="font-mono">{id}.experiment.json</span>
						</p>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
						>
							{t("common.cancel")}
						</Button>
						<Button type="submit">{t("new.create")}</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

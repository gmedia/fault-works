import type { Experiment } from "@faultworks/experiment";
import { useTranslation } from "react-i18next";
import { layerNodes } from "#/features/workbench/layers.ts";

/**
 * Static sketch of an experiment's graph, laid out by depth from the client. Components with a
 * scheduled fault are drawn as open rings, mirroring the logo, so a list shows at a glance which
 * experiments break something.
 */
export function TopologyThumbnail({
	experiment,
	className,
}: {
	experiment: Experiment;
	className?: string;
}) {
	const { t } = useTranslation();
	const layers = layerNodes(experiment);
	const faulted = new Set(experiment.faults.map((f) => f.target));
	const faultedLinks = new Set(
		experiment.faults
			.filter((f) => f.kind.startsWith("link-"))
			.map((f) => f.target),
	);
	const width = Math.max(120, layers.length * 44);
	const height = Math.max(
		56,
		Math.max(...layers.map((l) => l.length)) * 22 + 16,
	);
	const pos = new Map<string, { x: number; y: number }>();
	layers.forEach((layer, depth) => {
		const x = 12 + depth * ((width - 24) / Math.max(1, layers.length - 1));
		layer.forEach((n, i) => {
			pos.set(n.id, {
				x: layers.length === 1 ? width / 2 : x,
				y: (height / (layer.length + 1)) * (i + 1),
			});
		});
	});
	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			className={className}
			role="img"
			aria-label={t("thumbnail.alt", {
				nodes: experiment.model.nodes.length,
				faults: experiment.faults.length,
			})}
		>
			{experiment.model.links.map((l) => {
				const a = pos.get(l.source);
				const b = pos.get(l.target);
				if (!a || !b) return null;
				return (
					<line
						key={l.id}
						x1={a.x}
						y1={a.y}
						x2={b.x}
						y2={b.y}
						stroke={
							faultedLinks.has(l.id) ? "var(--gap-band)" : "var(--chart-axis)"
						}
						strokeWidth="1.5"
						strokeDasharray={faultedLinks.has(l.id) ? "3 2" : undefined}
					/>
				);
			})}
			{experiment.model.nodes.map((n) => {
				const p = pos.get(n.id);
				if (!p) return null;
				if (n.kind === "client")
					return (
						<circle
							key={n.id}
							cx={p.x}
							cy={p.y}
							r="4.5"
							fill="var(--muted-foreground)"
						/>
					);
				if (n.kind === "load-balancer")
					return (
						<rect
							key={n.id}
							x={p.x - 6}
							y={p.y - 6}
							width="12"
							height="12"
							rx="3"
							fill="var(--foreground)"
						/>
					);
				if (faulted.has(n.id))
					return (
						<circle
							key={n.id}
							cx={p.x}
							cy={p.y}
							r="5"
							fill="none"
							stroke="var(--gap-band)"
							strokeWidth="2"
						/>
					);
				return (
					<circle
						key={n.id}
						cx={p.x}
						cy={p.y}
						r="5"
						fill={`var(--kind-${n.kind})`}
					/>
				);
			})}
		</svg>
	);
}

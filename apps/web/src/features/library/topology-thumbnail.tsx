import { type Experiment, servers } from "@faultworks/experiment";
import { serverColor } from "#/lib/series.ts";

/**
 * Static sketch of an experiment's topology. Failing servers are drawn as open rings with a
 * broken link, mirroring the logo, so a list of experiments shows at a glance which ones break.
 */
export function TopologyThumbnail({
	experiment,
	className,
}: {
	experiment: Experiment;
	className?: string;
}) {
	const list = servers(experiment);
	const failing = new Set(experiment.faults.map((f) => f.target));
	const height = Math.max(60, list.length * 22 + 16);
	const ys = list.map((_, i) => (height / (list.length + 1)) * (i + 1));
	const mid = height / 2;
	return (
		<svg
			viewBox={`0 0 120 ${height}`}
			className={className}
			role="img"
			aria-label={`Client, load balancer and ${list.length} server${list.length === 1 ? "" : "s"}${failing.size ? `; ${failing.size} with a scheduled failure` : ""}`}
		>
			<line
				x1="14"
				y1={mid}
				x2="52"
				y2={mid}
				stroke="var(--chart-axis)"
				strokeWidth="1.5"
			/>
			{list.map((s, i) => {
				const y = ys[i] as number;
				const broken = failing.has(s.id);
				return (
					<g key={s.id}>
						<line
							x1="60"
							y1={mid}
							x2={broken ? 82 : 100}
							y2={broken ? mid + (y - mid) * 0.55 : y}
							stroke="var(--chart-axis)"
							strokeWidth="1.5"
						/>
						{broken ? (
							<circle
								cx="104"
								cy={y}
								r="5"
								fill="none"
								stroke="var(--gap-band)"
								strokeWidth="2"
							/>
						) : (
							<circle cx="104" cy={y} r="5" fill={serverColor(i)} />
						)}
					</g>
				);
			})}
			<circle cx="12" cy={mid} r="5" fill="var(--muted-foreground)" />
			<rect
				x="50"
				y={mid - 7}
				width="14"
				height="14"
				rx="3"
				fill="var(--foreground)"
			/>
		</svg>
	);
}

import {
	CircleCheck,
	CircleDashed,
	CircleOff,
	OctagonX,
	TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "#/lib/utils.ts";
import type { NodeStatus } from "./state-at.ts";

const STYLE: Record<
	NodeStatus,
	{ className: string; Icon: typeof CircleCheck }
> = {
	up: { className: "bg-ok-soft text-ok", Icon: CircleCheck },
	degraded: { className: "bg-gap-soft text-gap", Icon: TriangleAlert },
	"down-routed": { className: "gap-hatch text-gap", Icon: OctagonX },
	"down-removed": { className: "bg-down-soft text-down", Icon: CircleOff },
	recovering: { className: "bg-off-soft text-off", Icon: CircleDashed },
};

/** Status as icon + words + color; the color is never the only cue. */
export function StatusBadge({
	status,
	className,
}: {
	status: NodeStatus;
	className?: string;
}) {
	const { t } = useTranslation();
	const { className: tone, Icon } = STYLE[status];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[11px] leading-4",
				tone,
				className,
			)}
			title={t(`status.${status}.description`)}
		>
			<Icon className="size-3" aria-hidden="true" />
			{t(`status.${status}.label`)}
		</span>
	);
}

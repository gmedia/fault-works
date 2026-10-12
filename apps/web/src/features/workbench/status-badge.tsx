import { CircleCheck, CircleDashed, CircleOff, OctagonX } from "lucide-react";
import { cn } from "#/lib/utils.ts";
import { type ServerStatus, STATUS_INFO } from "./state-at.ts";

const STYLE: Record<
	ServerStatus,
	{ className: string; Icon: typeof CircleCheck }
> = {
	up: { className: "bg-ok-soft text-ok", Icon: CircleCheck },
	"down-routed": { className: "gap-hatch text-gap", Icon: OctagonX },
	"down-removed": { className: "bg-down-soft text-down", Icon: CircleOff },
	recovering: { className: "bg-off-soft text-off", Icon: CircleDashed },
};

/** Status as icon + words + color; the color is never the only cue. */
export function StatusBadge({
	status,
	className,
}: {
	status: ServerStatus;
	className?: string;
}) {
	const { className: tone, Icon } = STYLE[status];
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[11px] leading-4",
				tone,
				className,
			)}
			title={STATUS_INFO[status].description}
		>
			<Icon className="size-3" aria-hidden="true" />
			{STATUS_INFO[status].label}
		</span>
	);
}

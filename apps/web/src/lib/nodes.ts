import type { NodeKind } from "@faultworks/experiment";
import {
	Database,
	HardDriveDownload,
	Layers,
	ListOrdered,
	Radio,
	Server,
	Waypoints,
} from "lucide-react";

/** One icon per component kind, used everywhere a component is named. */
export const NODE_ICONS: Record<NodeKind, typeof Server> = {
	client: Radio,
	"load-balancer": Waypoints,
	service: Server,
	database: Database,
	cache: Layers,
	queue: ListOrdered,
};

export const FAULT_ICON = HardDriveDownload;

/** Component identity color by its position among workers. Color follows the component, never its rank. */
export function seriesColor(index: number): string {
	return `var(--series-${(((index % 8) + 8) % 8) + 1})`;
}

export const WORKER_KINDS: NodeKind[] = [
	"service",
	"database",
	"cache",
	"queue",
];
export const ADDABLE_KINDS: NodeKind[] = [
	"load-balancer",
	"service",
	"database",
	"cache",
	"queue",
];

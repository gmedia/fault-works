import {
	CATALOG,
	type CatalogEntry,
	type ExperimentNode,
	type NodeKind,
	type PresetId,
} from "@faultworks/experiment";
import {
	Archive,
	Boxes,
	Cable,
	Database,
	Gauge,
	Globe,
	HardDriveDownload,
	Layers,
	ListOrdered,
	MessagesSquare,
	MonitorCog,
	Plug,
	Radio,
	Search,
	Server,
	ShieldCheck,
	Waypoints,
} from "lucide-react";

/** One icon per component kind, used everywhere a component is named. */
export const NODE_ICONS: Record<NodeKind, typeof Server> = {
	client: Radio,
	"load-balancer": Waypoints,
	service: Server,
	database: Database,
	pooler: Cable,
	"db-cluster": Boxes,
	"rate-limiter": Gauge,
	cache: Layers,
	queue: ListOrdered,
};

/** Catalog presets get their own icon so a CDN does not look like any other cache. */
export const PRESET_ICONS: Record<PresetId, typeof Server> = {
	cdn: Globe,
	"api-gateway": ShieldCheck,
	"web-server": MonitorCog,
	"external-api": Plug,
	"object-storage": Archive,
	"search-engine": Search,
	"message-broker": MessagesSquare,
};

export function nodeIcon(node: Pick<ExperimentNode, "kind" | "preset">) {
	return node.preset ? PRESET_ICONS[node.preset] : NODE_ICONS[node.kind];
}

export function catalogIcon(entry: CatalogEntry) {
	return entry.id in PRESET_ICONS
		? PRESET_ICONS[entry.id as PresetId]
		: NODE_ICONS[entry.kind];
}

/** Translation key of what a node is: its preset ("CDN") or its kind ("Cache"). */
export function nodeTypeKey(node: Pick<ExperimentNode, "kind" | "preset">) {
	return node.preset ? `catalog.${node.preset}.label` : `kinds.${node.kind}`;
}

export const FAULT_ICON = HardDriveDownload;

/** Component identity color by its position among workers. Color follows the component, never its rank. */
export function seriesColor(index: number): string {
	return `var(--series-${(((index % 8) + 8) % 8) + 1})`;
}

/** The add-component menu: every catalog entry, grouped by category. */
export const ADDABLE = CATALOG;

import type { NodeKind, PresetId } from "./schema.ts";

/**
 * The component catalog. Every entry is a node kind with realistic starting values; presets add a
 * name, an icon and defaults on top of a kind, never new behavior. The numbers are plausible
 * orders of magnitude for a small deployment, not measurements of any product.
 */
export type CatalogCategory =
	| "edge"
	| "compute"
	| "data"
	| "messaging"
	| "external";

export interface CatalogEntry {
	/** A preset id, or the kind itself for the generic component of that kind. */
	id: PresetId | Exclude<NodeKind, "client">;
	kind: Exclude<NodeKind, "client">;
	category: CatalogCategory;
	/** Overrides of the kind's default config. */
	config?: Record<string, unknown>;
}

export const CATALOG: readonly CatalogEntry[] = [
	{
		id: "cdn",
		kind: "cache",
		category: "edge",
		config: {
			capacity: 2000,
			queueCapacity: 0,
			serviceTimeMs: 2,
			serviceTimeDistribution: "fixed",
			hitRatio: 0.9,
		},
	},
	{ id: "load-balancer", kind: "load-balancer", category: "edge" },
	{
		id: "api-gateway",
		kind: "rate-limiter",
		category: "edge",
		config: { ratePerSec: 500, burst: 100 },
	},
	{ id: "rate-limiter", kind: "rate-limiter", category: "edge" },
	{ id: "service", kind: "service", category: "compute" },
	{
		id: "web-server",
		kind: "service",
		category: "compute",
		config: {
			capacity: 32,
			queueCapacity: 128,
			serviceTimeMs: 30,
			serviceTimeDistribution: "exponential",
		},
	},
	{ id: "database", kind: "database", category: "data" },
	{ id: "pooler", kind: "pooler", category: "data" },
	{ id: "db-cluster", kind: "db-cluster", category: "data" },
	{ id: "cache", kind: "cache", category: "data" },
	{
		id: "search-engine",
		kind: "service",
		category: "data",
		config: {
			capacity: 16,
			queueCapacity: 200,
			serviceTimeMs: 40,
			serviceTimeDistribution: "exponential",
			contention: 0.05,
		},
	},
	{
		id: "object-storage",
		kind: "service",
		category: "data",
		config: {
			capacity: 500,
			queueCapacity: 0,
			serviceTimeMs: 60,
			serviceTimeDistribution: "exponential",
		},
	},
	{ id: "queue", kind: "queue", category: "messaging" },
	{
		id: "message-broker",
		kind: "queue",
		category: "messaging",
		config: {
			capacity: 8,
			queueCapacity: 100_000,
			serviceTimeMs: 20,
			serviceTimeDistribution: "exponential",
		},
	},
	{
		id: "external-api",
		kind: "service",
		category: "external",
		config: {
			capacity: 100,
			queueCapacity: 0,
			serviceTimeMs: 300,
			serviceTimeDistribution: "exponential",
		},
	},
];

export const CATALOG_CATEGORIES: readonly CatalogCategory[] = [
	"edge",
	"compute",
	"data",
	"messaging",
	"external",
];

export function catalogEntry(id: string): CatalogEntry | undefined {
	return CATALOG.find((e) => e.id === id);
}

/** A preset may only sit on the kind it was made for. */
export function presetFits(preset: string, kind: NodeKind): boolean {
	return catalogEntry(preset)?.kind === kind;
}

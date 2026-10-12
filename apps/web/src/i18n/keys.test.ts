import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { EVENT_KINDS, FAILURE_REASONS } from "@faultworks/engine";
import {
	CATALOG,
	CATALOG_CATEGORIES,
	EXAMPLE_IDS,
	FAULT_FIELDS,
	FIELDS,
	findBuiltIn,
	TEMPLATE_IDS,
} from "@faultworks/experiment";
import { compareSummaries, explainRun } from "@faultworks/metrics";
import { describe, expect, it } from "vitest";
import { executeRun } from "#/workers/protocol.ts";
import en from "./locales/en.json";
import id from "./locales/id.json";

type Tree = { [key: string]: Tree | string | string[] };

function flatten(tree: Tree, prefix = ""): string[] {
	const out: string[] = [];
	for (const [k, v] of Object.entries(tree)) {
		const key = prefix ? `${prefix}.${k}` : k;
		if (typeof v === "string" || Array.isArray(v)) out.push(key);
		else out.push(...flatten(v, key));
	}
	return out;
}

/** Plural and context suffixes resolve to the base key. */
function base(key: string) {
	return key.replace(/_(one|other|zero|two|few|many)$/, "");
}

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(name) &&
			!name.endsWith(".test.ts") &&
			!name.endsWith(".gen.ts")
			? [path]
			: [];
	});
}

/** Every static `t("…")` key in the web source. Template keys are covered by the families below. */
function usedKeys(): Set<string> {
	const keys = new Set<string>();
	for (const file of sourceFiles(join(__dirname, ".."))) {
		const text = readFileSync(file, "utf8");
		for (const m of text.matchAll(/\bt\(\s*"([a-zA-Z0-9_.:/%-]+)"/g))
			keys.add(m[1] as string);
	}
	return keys;
}

const idKeys = new Set(flatten(id as Tree).map(base));
const enKeys = new Set(flatten(en as Tree).map(base));

describe("locale files", () => {
	it("have the same keys in Indonesian and English", () => {
		expect([...idKeys].filter((k) => !enKeys.has(k))).toEqual([]);
		expect([...enKeys].filter((k) => !idKeys.has(k))).toEqual([]);
	});

	it("cover every static key the web app uses", () => {
		const missing = [...usedKeys()].filter((k) => !idKeys.has(k));
		expect(missing).toEqual([]);
	});

	it("cover the key families built from engine, experiment and metrics constants", () => {
		const families: string[] = [];
		for (const kind of EVENT_KINDS) families.push(`events.kinds.${kind}`);
		for (const reason of FAILURE_REASONS)
			families.push(`reasons.${reason}.label`, `reasons.${reason}.description`);
		for (const field of Object.keys(FIELDS))
			families.push(`fields.${field}.label`, `fields.${field}.help`);
		for (const kind of Object.keys(FAULT_FIELDS))
			families.push(
				`faultKinds.${kind}.label`,
				`faultKinds.${kind}.help`,
				`faultKinds.${kind}.short`,
				`options.fault.kind.${kind}`,
			);
		for (const kind of [
			"client",
			"load-balancer",
			"service",
			"database",
			"pooler",
			"db-cluster",
			"rate-limiter",
			"cache",
			"queue",
		])
			families.push(`kinds.${kind}`);
		for (const entry of CATALOG)
			families.push(
				`catalog.${entry.id}.label`,
				`catalog.${entry.id}.hint`,
				`catalog.${entry.id}.description`,
			);
		for (const category of CATALOG_CATEGORIES)
			families.push(`catalog.categories.${category}`);
		for (const template of TEMPLATE_IDS)
			families.push(
				`templates.${template}.title`,
				`templates.${template}.description`,
			);
		for (const status of [
			"up",
			"degraded",
			"down-routed",
			"down-removed",
			"recovering",
		])
			families.push(`status.${status}.label`, `status.${status}.description`);
		for (const check of [
			"conservation",
			"single-terminal",
			"capacity",
			"queue-bounds",
			"monotonic-time",
		])
			families.push(`checks.items.${check}`, `messages.checks.${check}.ok`);
		const missing = families.filter((k) => !idKeys.has(k));
		expect(missing).toEqual([]);
	});

	it("cover every insight and comparison row the built-in examples produce", {
		timeout: 120_000,
	}, () => {
		const families = new Set<string>();
		let previous: ReturnType<typeof executeRun> | null = null;
		for (const exampleId of EXAMPLE_IDS) {
			const experiment = findBuiltIn(exampleId);
			if (!experiment) throw new Error(`missing example ${exampleId}`);
			const result = executeRun(experiment, false);
			for (const insight of explainRun(result.metrics.summary)) {
				families.add(`${insight.key}.title`);
				families.add(`${insight.key}.body`);
			}
			if (previous)
				for (const row of compareSummaries(
					previous.metrics.summary,
					result.metrics.summary,
				))
					families.add(`rows.${row.id}`);
			previous = result;
		}
		expect(families.size).toBeGreaterThan(20);
		// Bodies may exist only in context variants (body_tick, body_range, …).
		const covered = (key: string) =>
			idKeys.has(key) || [...idKeys].some((k) => k.startsWith(`${key}_`));
		const missing = [...families].filter((k) => !covered(k));
		expect(missing).toEqual([]);
	});

	it("keep the same interpolation placeholders in both languages", () => {
		const placeholders = (tree: Tree) => {
			const byBase = new Map<string, Set<string>>();
			const walk = (node: Tree, prefix: string) => {
				for (const [k, v] of Object.entries(node)) {
					const key = prefix ? `${prefix}.${k}` : k;
					if (typeof v === "string" || Array.isArray(v)) {
						const set = byBase.get(base(key)) ?? new Set<string>();
						for (const m of (Array.isArray(v) ? v.join(" ") : v).matchAll(
							/\{\{\s*([a-zA-Z0-9_]+)/g,
						))
							set.add(m[1] as string);
						byBase.set(base(key), set);
					} else walk(v, key);
				}
			};
			walk(tree, "");
			return byBase;
		};
		const idPlaceholders = placeholders(id as Tree);
		const enPlaceholders = placeholders(en as Tree);
		const mismatched = [...idPlaceholders]
			.filter(
				([key, set]) =>
					JSON.stringify([...set].sort()) !==
					JSON.stringify([...(enPlaceholders.get(key) ?? [])].sort()),
			)
			.map(([key]) => key);
		expect(mismatched).toEqual([]);
	});
});

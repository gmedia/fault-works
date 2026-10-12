import { expect, type Page, test } from "@playwright/test";

async function newFromTemplate(page: Page, template: string, title: string) {
	await page.goto("/");
	await page.getByRole("button", { name: "New experiment" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByText(template, { exact: true }).click();
	await dialog.getByLabel("Title").fill(title);
	await dialog.getByRole("button", { name: "Create" }).click();
	await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

/** Drags from a node's source dot and releases over the middle of another node's card. */
async function dragLink(page: Page, from: string, to: string) {
	const source = page.locator(".react-flow__node").filter({ hasText: from }).first();
	const target = page.locator(".react-flow__node").filter({ hasText: to }).first();
	await source.hover();
	const handle = await source.locator(".react-flow__handle.source").boundingBox();
	const card = await target.boundingBox();
	if (!handle || !card) throw new Error("node not on screen");
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2, { steps: 12 });
	await page.mouse.up();
}

const edges = (page: Page) => page.locator(".react-flow__edge");

test("links form when dropped anywhere on a card, and impossible links are refused with a reason", async ({ page }) => {
	await newFromTemplate(page, "API and database", "Linking");
	// With nothing selected, a new component continues the chain from its end (the database).
	await page.locator(".react-flow__pane").click({ position: { x: 40, y: 200 } });
	await page.getByRole("button", { name: "Add component" }).first().click();
	await page.getByRole("menuitem", { name: /^Cache/ }).click();
	await expect(edges(page)).toHaveCount(3);

	// A second caller for the cache, dropped on the middle of its card.
	await dragLink(page, "API", "Cache");
	await expect(edges(page)).toHaveCount(4);
	await expect(page.getByRole("heading", { name: /API\s*Cache/ })).toBeVisible();

	// Database → API would let a request call itself.
	await dragLink(page, "Database", "API");
	await expect(edges(page)).toHaveCount(4);
	await expect(page.getByText(/Calls go in a circle/)).toBeVisible();
	await expect(page.getByText(/problems? to fix/)).toHaveCount(0);
});

test("a CDN from the catalog goes in front of the API instead of breaking the graph", async ({ page }) => {
	await newFromTemplate(page, "API and database", "With a CDN");
	await page.locator(".react-flow__node").filter({ hasText: "Client" }).first().click();
	await page.getByRole("button", { name: "Add component" }).first().click();
	await page.getByRole("menuitem", { name: /^CDN/ }).click();
	await expect(page.getByText(/only a starting point/)).toBeVisible();
	await expect(page.getByLabel("Hit ratio")).toHaveValue("90");
	await expect(page.getByText(/problems? to fix/)).toHaveCount(0);
	await page.getByRole("button", { name: "Run", exact: true }).click();
	await expect(page.getByText("Results match these settings")).toBeVisible();
});

test("a connection pooler beats a database with too many connections", async ({ page }) => {
	await page.goto("/compare?a=postgres-too-many-connections&b=postgres-with-pooler");
	await expect(page.getByRole("heading", { name: "Results" })).toBeVisible({ timeout: 60_000 });
	const failed = page.getByRole("row", { name: /^Failed/ }).first();
	await expect(failed).toContainText("41,036");
	await expect(failed).toContainText("3,042");
});

test("the database inspector explains where throughput peaks", async ({ page }) => {
	await page.goto("/experiments/postgres-too-many-connections?node=db");
	await expect(page.getByLabel("Maximum connections")).toHaveValue("300");
	await expect(page.getByText(/Throughput peaks at about .* with 44 pieces of work/)).toBeVisible();
	await page.getByRole("button", { name: "No slowdown" }).click();
	await expect(page.getByLabel("Contention (α)")).toHaveValue("0");
});

test("every link of every built-in experiment is drawn on the canvas", async ({ page }) => {
	const { readdirSync, readFileSync } = await import("node:fs");
	const dir = new URL("../../../examples/en/", import.meta.url);
	for (const file of readdirSync(dir)) {
		const experiment = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
		await page.goto(`/experiments/${experiment.experimentId}`);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await expect(edges(page), experiment.experimentId).toHaveCount(
			experiment.model.links.length,
		);
	}
});

test("a link from a connection pooler stays visible after it is made", async ({ page }) => {
	// The reported bug: the pooler → database line vanished as soon as the link existed.
	await newFromTemplate(page, "Blank", "Pooler link");
	for (const item of [/^Service/, /^Connection pooler/, /^Relational database/]) {
		await page.locator(".react-flow__pane").click({ position: { x: 40, y: 200 } });
		await page.getByRole("button", { name: "Add component" }).first().click();
		await page.getByRole("menuitem", { name: item }).click();
	}
	await expect(edges(page)).toHaveCount(3);
	const pooler = page.locator(".react-flow__node").filter({ hasText: "Connection pooler" });
	await expect(pooler.locator(".react-flow__handle.source")).toHaveCount(1);
	await expect(page.getByText(/problems? to fix/)).toHaveCount(0);
	await pooler.click();
	await expect(page.getByText(/The real capacity is set by Relational database/)).toBeVisible();
});

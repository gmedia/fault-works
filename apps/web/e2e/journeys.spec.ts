import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const failedTile = (page: Page) => page.locator("dl > div").filter({ hasText: "Failed requests" });

async function run(page: Page) {
	await page.getByRole("button", { name: /^Run( experiment| again)?$/ }).first().click();
	await expect(page.getByText("Results match these settings")).toBeVisible();
}

test("first-use journey: baseline, one-change variant, compare", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("heading", { name: "Failure experiments", level: 1 })).toBeVisible();
	await page.getByRole("link", { name: "Open the baseline" }).click();

	await expect(page.getByRole("heading", { name: "Load balancer failure without health checks" })).toBeVisible();
	await expect(page.getByText("Not run yet")).toBeVisible();
	await run(page);
	await expect(failedTile(page)).toContainText("1,005");
	await expect(failedTile(page)).toContainText("Refused 1,000");

	await page.getByRole("button", { name: "Create variant" }).click();
	await expect(page.getByRole("heading", { name: /\(variant\)$/ })).toBeVisible();
	await page.getByRole("tab", { name: "Component" }).click();
	await page.getByRole("button", { name: /^Load balancer/ }).first().click();
	await page.getByLabel("Health checks").click();
	await run(page);
	await expect(failedTile(page)).toContainText("255");

	await page.getByRole("button", { name: "Compare" }).click();
	await page.getByRole("menuitem", { name: /With the original/ }).click();
	await expect(page.getByText(/^Exactly one behavior setting differs/)).toBeVisible();
	await expect(page.getByRole("row", { name: /Health checks/ })).toContainText("off");
	const failedRow = page.getByRole("row", { name: /^Failed/ });
	await expect(failedRow).toContainText("1,005");
	await expect(failedRow).toContainText("255");
	await expect(failedRow).toContainText("−750");
});

test("anyone can build a system from a template, break it and run it", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "New experiment" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByText("API and database", { exact: true }).click();
	await expect(dialog.getByRole("radio", { name: /API and database/ })).toBeChecked();
	await dialog.getByLabel("Title").fill("Lab 3: slow database");
	await dialog.getByRole("button", { name: "Create" }).click();
	await expect(page.getByRole("heading", { name: "Lab 3: slow database" })).toBeVisible();
	await expect(page).toHaveURL(/\/experiments\/lab-3-slow-database/);

	// Add a cache in front of the database, from the API's settings.
	await page.getByRole("tab", { name: "Component" }).click();
	await page.getByRole("button", { name: /^API/ }).first().click();
	await page.getByRole("button", { name: "Add a component called from here" }).click();
	await page.getByRole("menuitem", { name: /^Cache/ }).click();
	await expect(page.getByLabel("Hit ratio")).toBeVisible();

	// Break the database with a slowdown.
	await page.getByRole("tab", { name: "Faults" }).click();
	await page.getByLabel("New fault kind").selectOption({ label: "Slowdown" });
	await page.getByRole("button", { name: "Add fault" }).click();
	await expect(page.getByLabel("Slowdown factor")).toBeVisible();

	await run(page);
	await expect(page.getByRole("tab", { name: "What happened" })).toBeVisible();
	await page.getByRole("tab", { name: "What happened" }).click();
	await expect(page.getByText(/slowed down at/)).toBeVisible();
});

test("edits can be undone and persist across reloads", async ({ page }) => {
	await page.goto("/experiments/failover-overload?node=server-a");
	const concurrency = page.getByLabel("Concurrency");
	await concurrency.fill("20");
	await concurrency.blur();
	await expect(page.getByText(/At most about 133 req\/s/)).toBeVisible();

	await page.getByRole("button", { name: "Undo" }).click();
	await expect(concurrency).toHaveValue("10");
	await page.getByRole("button", { name: "Redo" }).click();
	await expect(concurrency).toHaveValue("20");

	// History is per session; the experiment itself is saved in the browser.
	await page.reload();
	await expect(page.getByLabel("Concurrency")).toHaveValue("20");
	await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("invalid settings block the run and say how to fix them", async ({ page }) => {
	await page.goto("/experiments/lb-failure-no-health-checks?node=server-b");
	await page.getByLabel("Service time", { exact: true }).fill("-5");
	await expect(page.getByText("Service time must be greater than 0 ms").first()).toBeVisible();
	await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
	await expect(page.getByText(/Fix 1 problem before running/)).toBeVisible();
	await page.getByLabel("Service time", { exact: true }).fill("100");
	await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
});

test("replay speed never changes the results", async ({ page }) => {
	await page.goto("/experiments/random-traffic-burst");
	await run(page);
	const before = await failedTile(page).innerText();
	await page.getByLabel("Replay speed").click();
	await page.getByRole("option", { name: "20×" }).click();
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await page.waitForTimeout(1500);
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await page.getByRole("button", { name: "Run again" }).click();
	await expect(page.getByText("Results match these settings")).toBeVisible();
	expect(await failedTile(page).innerText()).toBe(before);

	await page.getByRole("tab", { name: /Engine checks/ }).click();
	await expect(page.getByText("Model checks: 5 of 5 passed")).toBeVisible();
	await page.getByRole("button", { name: "Run again and compare" }).click();
	await expect(page.getByText(/^Identical\./)).toBeVisible();
});

test("Ctrl+Enter runs and the event log traces one request", async ({ page }) => {
	await page.goto("/experiments/lb-failure-with-health-checks");
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await page.keyboard.press("Control+Enter");
	await expect(page.getByText("Results match these settings")).toBeVisible();
	await page.getByRole("tab", { name: "Events" }).click();
	await expect(page.getByText("Health changed").first()).toBeVisible();
	await page.getByLabel("Trace request #").fill("2001");
	const log = page.getByRole("list", { name: "Simulation events" });
	await expect(log).toContainText("Arrived");
	await expect(log).toContainText("Failed");
	await expect(log).toContainText("Refused");
});

test("import validates files and upgrades older formats", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Import" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Or paste JSON").fill('{ "schemaVersion": "9.0.0" }');
	await dialog.getByRole("button", { name: "Import" }).click();
	await expect(dialog.getByRole("alert")).toContainText("schema version 9.0.0");

	const older = await readFile(new URL("../../../packages/experiment/src/fixtures/v0.1.0.json", import.meta.url), "utf8");
	await dialog.getByLabel("Or paste JSON").fill(older);
	await dialog.getByRole("button", { name: "Import" }).click();
	await expect(page.getByText(/Upgraded from schema 0\.1\.0/)).toBeVisible();
	await expect(page).toHaveURL(/\/experiments\//);
	await run(page);
});

test("export downloads the experiment and the result artifact", async ({ page }) => {
	await page.goto("/experiments/hanging-backend");
	await run(page);
	await page.getByRole("button", { name: "Export" }).click();
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("menuitem", { name: "Result with metrics (.json)" }).click(),
	]);
	expect(download.suggestedFilename()).toBe("hanging-backend.result.json");
	const artifact = JSON.parse(await readFile((await download.path()) as string, "utf8"));
	expect(artifact.engineVersion).toBe("0.3.0");
	expect(artifact.inputDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
	expect(artifact.metrics.failed).toBe(355);
	expect(artifact.experiment.experimentId).toBe("hanging-backend");
});

test("deleting an experiment can be undone", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Actions for Random traffic with a burst" }).click();
	await page.getByRole("menuitem", { name: "Delete" }).click();
	await expect(page.getByRole("link", { name: "Random traffic with a burst" })).toHaveCount(0);
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(page.getByRole("link", { name: "Random traffic with a burst" })).toBeVisible();
});

test("the language switch changes the UI and is remembered", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Language" }).click();
	await page.getByRole("menuitemradio", { name: "Bahasa Indonesia" }).click();
	await expect(page.getByRole("heading", { name: "Eksperimen kegagalan", level: 1 })).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("lang", "id");
	await page.reload();
	await expect(page.getByRole("heading", { name: "Eksperimen kegagalan", level: 1 })).toBeVisible();
	await page.getByRole("link", { name: "Buka eksperimen dasar" }).click();
	await page.getByRole("button", { name: "Jalankan", exact: true }).click();
	await expect(page.getByText("Hasil sesuai pengaturan ini")).toBeVisible();
	await expect(page.locator("dl > div").filter({ hasText: "Request gagal" })).toContainText("1.005");
});

test("unknown experiment ids get a helpful page", async ({ page }) => {
	await page.goto("/experiments/does-not-exist");
	await expect(page.getByRole("heading", { name: "This experiment is not in this browser" })).toBeVisible();
	await page.goto("/nowhere");
	await expect(page.getByRole("heading", { name: "This address does not lead to anything" })).toBeVisible();
});

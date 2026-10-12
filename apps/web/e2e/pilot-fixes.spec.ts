import { expect, type Page, test } from "@playwright/test";

// Regression tests for the problems found in the simulated pilot (docs/12-SIMULATED-PILOT.md).

async function runAndWait(page: Page) {
	await page.getByRole("button", { name: /^Run( experiment| again)?$/ }).first().click();
	await expect(page.getByText("Results match these settings")).toBeVisible();
}

async function download(page: Page, menu: string, item: string | RegExp) {
	await page.getByRole("button", { name: menu }).click();
	const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: item }).click()]);
	return (await file.path()) as string;
}

test("a result file can be imported elsewhere and is verified by re-running it", async ({ page, browser }) => {
	await page.goto("/experiments/lb-failure-with-health-checks");
	await runAndWait(page);
	const resultPath = await download(page, "Export", "Result with metrics (.json)");

	const colleague = await (await browser.newContext({ locale: "en-US" })).newPage();
	await colleague.goto("/");
	await colleague.getByRole("button", { name: "Import" }).click();
	const chooser = colleague.waitForEvent("filechooser");
	await colleague.getByRole("button", { name: "Choose file" }).click();
	await (await chooser).setFiles(resultPath);

	await expect(colleague.getByText(/Reproduced: this run matches/)).toBeVisible();
	await expect(colleague.getByRole("region", { name: "Result file check" })).toContainText("Trace fingerprint");
	// Same settings as the built-in example, so no look-alike duplicate is created.
	await expect(colleague).toHaveURL(/\/experiments\/lb-failure-with-health-checks$/);
});

test("a comparison exports as one file and imports back into both sides", async ({ page, browser }) => {
	await page.goto("/compare?a=lb-failure-no-health-checks&b=lb-failure-with-health-checks");
	await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
	const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export comparison (.json)" }).click()]);
	const bundle = (await file.path()) as string;

	const other = await (await browser.newContext({ locale: "en-US" })).newPage();
	await other.goto("/");
	await other.getByRole("button", { name: "Import" }).click();
	const chooser = other.waitForEvent("filechooser");
	await other.getByRole("button", { name: "Choose file" }).click();
	await (await chooser).setFiles(bundle);
	await expect(other).toHaveURL(/\/compare\?/);
	await expect(other.getByText(/^Exactly one behavior setting differs/)).toBeVisible();
	await expect(other.getByRole("row", { name: /^Failed/ }).first()).toContainText("255");
});

test("results come back after a reload because the run is reproducible", async ({ page }) => {
	await page.goto("/experiments/hanging-backend");
	await runAndWait(page);
	await page.reload();
	await expect(page.getByText("Results match these settings")).toBeVisible();
	await expect(page.locator("dl > div").filter({ hasText: "Failed requests" })).toContainText("355");
});

test("the seed sweep shows the spread when an experiment has random parts", async ({ page }) => {
	await page.goto("/experiments/random-traffic-burst");
	await page.getByRole("button", { name: "Create variant" }).click();
	await expect(page.getByRole("heading", { name: /\(variant\)$/ })).toBeVisible();
	await page.getByRole("tab", { name: "Traffic" }).click();
	const rate = page.getByLabel("Offered rate");
	await rate.fill("120");
	await rate.blur();
	await page.getByRole("button", { name: "Compare" }).click();
	await page.getByRole("menuitem", { name: /With the original/ }).click();
	await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
	await page.getByRole("button", { name: /Repeat both with 10 seeds/ }).click();
	// Twenty runs in the worker; give it time on slow CI machines.
	await expect(page.getByRole("table", { name: /Results across 10 seeds/ })).toBeVisible({ timeout: 90_000 });
	await expect(page.getByText(/Seeds are paired/)).toBeVisible();
});

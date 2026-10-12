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

	const colleague = await (await browser.newContext()).newPage();
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
	const [file] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("button", { name: "Export comparison (.json)" }).click(),
	]);
	const bundle = (await file.path()) as string;

	const other = await (await browser.newContext()).newPage();
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

test("comparing from a variant puts the original as A and the variant as B", async ({ page }) => {
	await page.goto("/experiments/lb-failure-no-health-checks");
	await page.getByRole("button", { name: "Create variant" }).click();
	await expect(page.getByRole("heading", { name: /\(variant\)$/ })).toBeVisible();
	await page.getByRole("tab", { name: "Notes" }).click();
	await expect(page.getByLabel("Expected observations")).toHaveValue("");
	await page.getByRole("button", { name: "Compare" }).click();
	await page.getByRole("menuitem", { name: /With another experiment/ }).click();
	await expect(page).toHaveURL(/a=lb-failure-no-health-checks&b=lb-failure-no-health-checks-variant|b=lb-failure-no-health-checks-variant.*a=lb-failure-no-health-checks/);
	await expect(page.getByText(/^No behavior setting differs/)).toBeVisible();
});

test("explanations name the possible detection range and the latency story", async ({ page }) => {
	await page.goto("/compare?a=lb-failure-no-health-checks&b=lb-failure-with-health-checks");
	await expect(page.getByText(/^Latency did not change/)).toBeVisible();
	await page.goto("/experiments/lb-failure-with-health-checks?tab=explain");
	await runAndWait(page);
	await expect(page.getByText(/shortest delay these settings allow/)).toBeVisible();
	await expect(page.getByText(/health probes/)).toBeVisible();
});

test("new experiments are named from their title, and the id can be changed", async ({ page }) => {
	await page.goto("/");
	await page.getByRole("button", { name: "New experiment" }).first().click();
	await page.getByLabel("Title").fill("Lab 3: three servers");
	await expect(page.getByText("lab-3-three-servers.experiment.json")).toBeVisible();
	await page.getByRole("button", { name: "Create" }).click();
	await expect(page).toHaveURL(/\/experiments\/lab-3-three-servers/);

	const id = page.getByLabel("File name (id)");
	await id.fill("lab-3");
	await id.press("Enter");
	await expect(page).toHaveURL(/\/experiments\/lab-3(\?|$)/);
	await expect(page.getByRole("heading", { name: "Lab 3: three servers" })).toBeVisible();
});

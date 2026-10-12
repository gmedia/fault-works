import { expect, test } from "@playwright/test";

for (const path of ["/", "/experiments/failover-overload", "/compare?a=lb-failure-no-health-checks&b=lb-failure-with-health-checks", "/guide"]) {
	test(`no horizontal page scroll on a phone: ${path}`, async ({ page }) => {
		await page.goto(path);
		const run = page.getByRole("button", { name: "Run", exact: true });
		if (await run.count()) {
			await run.click();
			await expect(page.getByText("Results match these settings")).toBeVisible();
		}
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		expect(overflow).toBeLessThanOrEqual(0);
	});
}

test("on a phone the system is a readable list, a tap opens settings, and the run moves to the replay", async ({ page }) => {
	await page.goto("/experiments/lb-failure-with-health-checks");
	await expect(page.getByRole("region", { name: "Build" })).toBeVisible();
	await page.getByRole("button", { name: /^Server B/ }).tap();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(page.getByLabel("Concurrency")).toBeInViewport();
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Run", exact: true }).tap();
	await expect(page.getByText("Results match these settings")).toBeVisible();
	await expect(page.getByRole("region", { name: "Replay" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();

	const screens = page.getByRole("navigation", { name: "Screens" });
	await screens.getByRole("button", { name: "Results" }).tap();
	await expect(page.locator("dl > div").filter({ hasText: "Failed requests" })).toContainText("255");
	await screens.getByRole("button", { name: "Build" }).tap();
	await expect(page.getByRole("region", { name: "Build" })).toBeVisible();
	// A second tap on Build opens the settings sheet.
	await screens.getByRole("button", { name: "Build" }).tap();
	await expect(page.getByRole("dialog")).toBeVisible();
	await expect(page.getByRole("tab", { name: "Traffic" })).toBeVisible();
});

test("on a phone the secondary actions live in the more menu", async ({ page }) => {
	await page.goto("/experiments/lb-failure-with-health-checks");
	await expect(page.getByRole("button", { name: "Create variant" })).toBeHidden();
	await page.getByRole("button", { name: "More actions" }).tap();
	await page.getByRole("menuitem", { name: "Create variant" }).tap();
	await expect(page.getByRole("heading", { name: /\(variant\)$/ })).toBeVisible();
});

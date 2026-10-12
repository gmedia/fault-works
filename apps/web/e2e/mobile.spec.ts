import { expect, test } from "@playwright/test";

for (const path of [
	"/",
	"/experiments/failover-overload",
	"/compare?a=lb-failure-no-health-checks&b=lb-failure-with-health-checks",
	"/guide",
]) {
	test(`no horizontal page scroll on a phone: ${path}`, async ({ page }) => {
		await page.goto(path);
		const run = page.getByRole("button", { name: "Run experiment" });
		if (await run.count()) {
			await run.click();
			await expect(page.getByText("Results match these settings")).toBeVisible();
		}
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		expect(overflow).toBeLessThanOrEqual(0);
	});
}

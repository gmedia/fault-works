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

test("on a phone the topology is a readable list and tapping a server opens its settings", async ({ page }) => {
	await page.goto("/experiments/lb-failure-with-health-checks");
	const servers = page.getByRole("list", { name: "Servers" });
	await expect(servers).toBeVisible();
	await servers.getByRole("button", { name: /Server B/ }).tap();
	await expect(page.getByLabel("Concurrency")).toBeInViewport();
	await page.getByRole("button", { name: "Run", exact: true }).tap();
	await expect(page.locator("#results")).toBeInViewport();
});

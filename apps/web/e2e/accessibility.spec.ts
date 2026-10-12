import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const PAGES: Array<{ name: string; path: string; run?: boolean }> = [
	{ name: "experiments", path: "/" },
	{ name: "workbench before run", path: "/experiments/lb-failure-with-health-checks" },
	{ name: "workbench after run", path: "/experiments/lb-failure-with-health-checks", run: true },
	{ name: "workbench with a component selected", path: "/experiments/cascading-failure?node=database" },
	{ name: "compare", path: "/compare?a=lb-failure-no-health-checks&b=lb-failure-with-health-checks" },
	{ name: "guide", path: "/guide" },
];

async function scan(page: Page) {
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		// React Flow's own attribution link sits outside our control.
		.exclude(".react-flow__attribution")
		.analyze();
	return results.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
}

for (const theme of ["light", "dark"] as const) {
	test.describe(`${theme} theme`, () => {
		test.use({ colorScheme: theme });
		for (const p of PAGES) {
			test(`${p.name} has no WCAG A/AA violations`, async ({ page }) => {
				await page.goto(p.path);
				if (p.run) {
					await page.getByRole("button", { name: "Run experiment" }).click();
					await expect(page.getByText("Results match these settings")).toBeVisible();
				}
				if (p.path.startsWith("/compare")) await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
				expect(await scan(page)).toEqual([]);
			});
		}
	});
}

test("the Indonesian UI has no WCAG A/AA violations either", async ({ page }) => {
	await page.goto("/experiments/lb-failure-with-health-checks");
	await page.getByRole("button", { name: "Language" }).click();
	await page.getByRole("menuitemradio", { name: "Bahasa Indonesia" }).click();
	await page.getByRole("button", { name: "Jalankan", exact: true }).click();
	await expect(page.getByText("Hasil sesuai pengaturan ini")).toBeVisible();
	expect(await scan(page)).toEqual([]);
});

test("keyboard: skip link, focusable canvas nodes, chart slider", async ({ page }) => {
	await page.goto("/experiments/lb-failure-with-health-checks");
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await page.keyboard.press("Tab");
	await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
	await page.keyboard.press("Control+Enter");
	await expect(page.getByText("Results match these settings")).toBeVisible();
	const chart = page.getByRole("slider", { name: "Requests per second" });
	await chart.focus();
	await page.keyboard.press("ArrowRight");
	await expect(chart).toHaveAttribute("aria-valuetext", /Succeeded/);
	const node = page.getByLabel("Server B (service)");
	await node.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByLabel("Concurrency")).toBeVisible();
});

test("reduced motion disables the replay animation but not the replay", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/experiments/lb-failure-with-health-checks");
	await page.getByRole("button", { name: "Run", exact: true }).click();
	await expect(page.getByText("Results match these settings")).toBeVisible();
	await page.getByRole("button", { name: "Next state change" }).click();
	await expect(page.getByRole("slider", { name: "Replay position" })).toHaveAttribute("aria-valuetext", /20/);
});

import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the production build served by `vite preview`, the same static
// bundle a user would get.
export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: "http://localhost:4173",
		// The app follows the browser language and defaults to Indonesian; the specs pin English
		// and switch languages explicitly where they test i18n.
		locale: "en-US",
		trace: "retain-on-failure",
	},
	projects: [
		{ name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
		{ name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
	],
	webServer: {
		command: "pnpm build && pnpm preview --port 4173 --strictPort",
		url: "http://localhost:4173",
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});

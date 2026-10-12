import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRoute,
	type ErrorComponentProps,
	Link,
	Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import { AppShell } from "#/components/app/app-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import { TooltipProvider } from "#/components/ui/tooltip.tsx";
import { useResolvedTheme } from "#/state/theme.ts";

export const Route = createRootRoute({
	component: RootComponent,
	notFoundComponent: NotFound,
	errorComponent: RouteError,
});

function RootComponent() {
	const theme = useResolvedTheme();
	return (
		<TooltipProvider delayDuration={300}>
			<AppShell>
				<Outlet />
			</AppShell>
			<Toaster
				theme={theme}
				position="bottom-right"
				closeButton
				richColors={false}
			/>
			{import.meta.env.DEV && (
				<TanStackDevtools
					config={{ position: "bottom-left" }}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
			)}
		</TooltipProvider>
	);
}

function NotFound() {
	const { t } = useTranslation();
	return (
		<div className="mx-auto max-w-xl px-4 py-24">
			<p className="font-mono text-muted-foreground text-sm">404</p>
			<h1 className="mt-2 font-semibold text-2xl tracking-tight">
				{t("notFound.title")}
			</h1>
			<p className="mt-3 text-muted-foreground">{t("notFound.body")}</p>
			<div className="mt-6 flex flex-wrap gap-2">
				<Button asChild>
					<Link to="/">{t("missing.back")}</Link>
				</Button>
				<Button asChild variant="outline">
					<Link to="/guide">{t("notFound.guide")}</Link>
				</Button>
			</div>
		</div>
	);
}

function RouteError({ error, reset }: ErrorComponentProps) {
	const { t } = useTranslation();
	return (
		<div className="mx-auto max-w-xl px-4 py-24" role="alert">
			<h1 className="font-semibold text-2xl tracking-tight">
				{t("error.title")}
			</h1>
			<p className="mt-3 text-muted-foreground">{t("error.body")}</p>
			<pre className="mt-4 overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">
				{error instanceof Error ? error.message : String(error)}
			</pre>
			<div className="mt-6 flex flex-wrap gap-2">
				<Button onClick={reset}>{t("results.tryAgain")}</Button>
				<Button asChild variant="outline">
					<Link to="/">{t("missing.back")}</Link>
				</Button>
			</div>
		</div>
	);
}

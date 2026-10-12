import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRoute,
	type ErrorComponentProps,
	Link,
	Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
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
	return (
		<div className="mx-auto max-w-xl px-4 py-24">
			<p className="font-mono text-muted-foreground text-sm">404</p>
			<h1 className="mt-2 font-semibold text-2xl tracking-tight">
				This address does not lead to anything
			</h1>
			<p className="mt-3 text-muted-foreground">
				The link may point to an experiment that was deleted from this browser,
				or it was typed incorrectly. Experiments are stored per browser, so a
				link from someone else only works if they also sent you the exported
				file.
			</p>
			<div className="mt-6 flex flex-wrap gap-2">
				<Button asChild>
					<Link to="/">Go to experiments</Link>
				</Button>
				<Button asChild variant="outline">
					<Link to="/guide">Read the model guide</Link>
				</Button>
			</div>
		</div>
	);
}

function RouteError({ error, reset }: ErrorComponentProps) {
	return (
		<div className="mx-auto max-w-xl px-4 py-24" role="alert">
			<h1 className="font-semibold text-2xl tracking-tight">
				Something broke on this page
			</h1>
			<p className="mt-3 text-muted-foreground">
				Your experiments are saved in this browser and are not affected. Try
				again, or go back to the experiment list.
			</p>
			<pre className="mt-4 overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">
				{error instanceof Error ? error.message : String(error)}
			</pre>
			<div className="mt-6 flex flex-wrap gap-2">
				<Button onClick={reset}>Try again</Button>
				<Button asChild variant="outline">
					<Link to="/">Go to experiments</Link>
				</Button>
			</div>
		</div>
	);
}

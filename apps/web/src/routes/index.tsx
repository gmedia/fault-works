import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: HomePage,
});

function HomePage() {
	return (
		<main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4">
			<h1 className="font-semibold text-3xl tracking-tight">FaultWorks</h1>
			<p className="text-muted-foreground">
				Experiment with failure. Build more resilient systems.
			</p>
			<p className="text-muted-foreground text-sm">
				v0.1 in progress: the Load Balancer Failure experiment will live here.
			</p>
		</main>
	);
}

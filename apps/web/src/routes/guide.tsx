import { ENGINE_VERSION } from "@faultworks/engine";
import { LIMITS, SCHEMA_VERSION } from "@faultworks/experiment";
import {
	FAILURE_REASON_INFO,
	METRIC_DEFINITIONS_VERSION,
} from "@faultworks/metrics";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatCount } from "#/lib/format.ts";
import { useDocumentTitle } from "#/lib/use-document-title.ts";

export const Route = createFileRoute("/guide")({
	component: GuidePage,
});

const SECTIONS = [
	{ id: "what", title: "What is simulated" },
	{ id: "lifecycle", title: "Life of a request" },
	{ id: "health", title: "Failures and health checks" },
	{ id: "metrics", title: "Metric definitions" },
	{ id: "reproducibility", title: "Reproducibility" },
	{ id: "checks", title: "Correctness checks" },
	{ id: "limits", title: "Limits and what is not modeled" },
];

function Section({
	id,
	title,
	children,
}: {
	id: string;
	title: string;
	children: ReactNode;
}) {
	return (
		<section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20">
			<h2 id={`${id}-h`} className="font-semibold text-xl tracking-tight">
				{title}
			</h2>
			<div className="mt-3 grid gap-3 text-[15px] leading-relaxed [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
				{children}
			</div>
		</section>
	);
}

function GuidePage() {
	useDocumentTitle("Model guide");
	return (
		<div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:py-12 lg:grid-cols-[14rem_minmax(0,1fr)]">
			<nav
				aria-label="On this page"
				className="lg:sticky lg:top-20 lg:self-start"
			>
				<p className="font-medium text-sm">On this page</p>
				<ul className="mt-2 grid gap-1 text-muted-foreground text-sm">
					{SECTIONS.map((s) => (
						<li key={s.id}>
							<a
								href={`#${s.id}`}
								className="hover:text-foreground hover:underline"
							>
								{s.title}
							</a>
						</li>
					))}
				</ul>
				<p className="mt-6 font-mono text-muted-foreground text-xs leading-5">
					engine {ENGINE_VERSION}
					<br />
					schema {SCHEMA_VERSION}
					<br />
					metrics {METRIC_DEFINITIONS_VERSION}
				</p>
			</nav>

			<article className="grid max-w-[72ch] gap-12">
				<header>
					<h1 className="font-semibold text-3xl tracking-tight">Model guide</h1>
					<p className="mt-3 text-lg text-muted-foreground">
						FaultWorks runs an abstract, request-level discrete-event
						simulation. This page says exactly what that model does, so you can
						judge what a result does and does not tell you.
					</p>
				</header>

				<Section id="what" title="What is simulated">
					<p>
						An experiment has one client, one load balancer and one to{" "}
						{LIMITS.maxServers} servers. Traffic always flows client → load
						balancer → servers. Time is simulated in whole microseconds and
						moves from event to event; nothing depends on how fast your computer
						is or how fast the replay plays.
					</p>
					<ul>
						<li>
							<strong>Client</strong> sends requests at a constant rate (exact
							intervals) or as a Poisson process (random gaps from the seed),
							plus optional bursts. Each request has a deadline: the client
							timeout.
						</li>
						<li>
							<strong>Load balancer</strong> picks backends in round-robin order
							among those it considers healthy. Without health checks, it
							considers every backend healthy forever.
						</li>
						<li>
							<strong>Server</strong> has a number of slots (concurrency) and a
							FIFO queue. A request occupies a slot for its service time, either
							fixed or drawn from an exponential distribution.
						</li>
					</ul>
				</Section>

				<Section id="lifecycle" title="Life of a request">
					<ol>
						<li>
							The request arrives at the load balancer. If no backend is marked
							healthy, it fails at once (no healthy backend).
						</li>
						<li>It is routed to the next backend in rotation.</li>
						<li>
							If that backend has crashed with <em>refuse</em>, it fails at once
							(backend refused). With <em>hang</em>, it waits until the client
							timeout.
						</li>
						<li>
							If a slot is free it starts service; otherwise it waits in the
							queue; if the queue is full it fails (queue full).
						</li>
						<li>
							It succeeds when service completes at or before its deadline.
							Otherwise it fails with a timeout at the deadline. The server does
							not know the client gave up: it finishes the work later, and that
							late response is discarded, never counted as a success.
						</li>
						<li>
							If the server crashes while the request is queued or in service,
							the work is lost. With <em>refuse</em> the request fails at the
							crash (lost in crash); with <em>hang</em> it fails at its timeout.
						</li>
					</ol>
					<p>
						Every request ends exactly once. Events at the same instant are
						processed in a fixed order: faults, probe results, service
						completions, timeouts, probe sends, arrivals. A response landing
						exactly on the deadline therefore counts as on time.
					</p>
				</Section>

				<Section id="health" title="Failures and health checks">
					<p>
						A fault crashes one server at a simulated time and optionally brings
						it back later with an empty queue. Two behaviors are modeled:{" "}
						<em>refuse</em> (the process died; connections and probes fail
						immediately) and
						<em> hang</em> (the host is unreachable; connections and probes wait
						for their timeouts).
					</p>
					<p>
						With health checks on, the load balancer probes every backend each
						interval, starting at time 0. Probes bypass the request queue and
						answer instantly when the server is up. After the configured number
						of consecutive failed probes the backend is removed from rotation;
						after the configured number of consecutive successes it is added
						back. This is a simplified active check; it does not reproduce any
						specific proxy’s passive or active checking.
					</p>
					<p>
						The period between a crash and its detection is the amber hatched
						band on every timeline: the server is down, but still receives
						traffic.
					</p>
				</Section>

				<Section id="metrics" title="Metric definitions">
					<dl className="grid gap-3">
						{[
							[
								"Offered",
								"Requests the client generated, whether or not they succeeded.",
							],
							[
								"Admitted",
								"Requests a backend accepted into a slot or its queue.",
							],
							[
								"Succeeded",
								"Requests whose response completed at or before their deadline.",
							],
							[
								"Failed",
								"Requests that ended without success, broken down by reason (below).",
							],
							[
								"Still in flight",
								"Requests without an outcome when the run stopped. They are censored: counted neither as success nor failure. Offered = succeeded + failed + still in flight.",
							],
							[
								"Latency",
								"Completion time minus arrival time. Percentiles use the nearest-rank method on successful requests and always show the number of samples (n). Timeouts appear in the failure count, not in these percentiles.",
							],
							[
								"Requests per second",
								"Counted per chart window: offered by arrival time, succeeded and failed by the time they ended.",
							],
							[
								"Successful completions per second",
								"Succeeded divided by simulated time. No latency objective is declared, so this is not called goodput.",
							],
							[
								"Detection delay",
								"Time the load balancer marked a server unhealthy minus the time it actually crashed.",
							],
							[
								"Queue depth, busy slots",
								"Peak value within each chart window, per server.",
							],
						].map(([term, def]) => (
							<div key={term} className="rounded-md border p-3">
								<dt className="font-medium">{term}</dt>
								<dd className="mt-1 text-muted-foreground">{def}</dd>
							</div>
						))}
					</dl>
					<h3 className="mt-2 font-semibold">Failure reasons</h3>
					<ul>
						{Object.values(FAILURE_REASON_INFO).map((r) => (
							<li key={r.label}>
								<strong>{r.label}.</strong> {r.description}
							</li>
						))}
					</ul>
				</Section>

				<Section id="reproducibility" title="Reproducibility">
					<p>
						The same experiment, seed and engine version produce the same event
						trace, byte for byte. Random numbers come from a seeded SFC32
						generator with a separate stream for arrivals and for each server’s
						service times, so adding a server does not change the random numbers
						another component sees.
					</p>
					<p>
						Every result carries the input digest (SHA-256 of the canonical
						experiment, without canvas layout) and a fingerprint of the full
						trace. The Checks tab can re-run an experiment and compare both.
					</p>
					<p>
						A single seed is a deterministic demonstration, not statistical
						evidence. When an experiment uses random arrivals or service times,
						the Compare page can repeat both sides with ten paired seeds.
					</p>
				</Section>

				<Section id="checks" title="Correctness checks">
					<p>
						After every run, the event stream is checked independently of the
						engine’s own bookkeeping:
					</p>
					<ul>
						<li>
							every request is accounted for (offered = succeeded + failed + in
							flight);
						</li>
						<li>
							each request ends exactly once, and late responses only follow a
							timeout;
						</li>
						<li>busy slots never exceed concurrency;</li>
						<li>queues stay between zero and their size;</li>
						<li>simulated time never goes backwards.</li>
					</ul>
					<p>
						The engine itself is covered by reference cases with hand-computed
						answers and by property-based tests over a few hundred freshly
						generated random experiments on every test run.
					</p>
				</Section>

				<Section id="limits" title="Limits and what is not modeled">
					<ul>
						<li>
							No TCP, TLS, packets, connection pooling, keep-alive or network
							latency.
						</li>
						<li>
							No retries, circuit breakers, caches, databases or queues between
							services.
						</li>
						<li>
							No CPU, memory, garbage collection or operating-system scheduling.
						</li>
						<li>
							No claim of parity with NGINX, HAProxy, Envoy or any cloud load
							balancer.
						</li>
						<li>
							Runs are limited to {LIMITS.maxHorizonMs / 60_000} minutes of
							simulated time and about {formatCount(LIMITS.maxOfferedRequests)}{" "}
							offered requests, so a browser tab never locks up.
						</li>
					</ul>
					<p>
						Use the results to understand and discuss failure dynamics. Do not
						use them as capacity plans, SLA estimates or predictions of
						production behavior.
					</p>
					<p>
						<Link to="/" className="underline underline-offset-4">
							Back to experiments
						</Link>
					</p>
				</Section>
			</article>
		</div>
	);
}

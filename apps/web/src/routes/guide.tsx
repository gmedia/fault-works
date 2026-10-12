import { ENGINE_VERSION, FAILURE_REASONS } from "@faultworks/engine";
import { LIMITS, SCHEMA_VERSION } from "@faultworks/experiment";
import { METRIC_DEFINITIONS_VERSION } from "@faultworks/metrics";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatCount } from "#/lib/format.ts";
import { useDocumentTitle } from "#/lib/use-document-title.ts";

export const Route = createFileRoute("/guide")({ component: GuidePage });

const SECTIONS = [
	"what",
	"components",
	"contention",
	"lifecycle",
	"faults",
	"resilience",
	"metrics",
	"reproducibility",
	"checks",
	"limits",
] as const;
const COMPONENTS = [
	"client",
	"load-balancer",
	"service",
	"database",
	"pooler",
	"db-cluster",
	"rate-limiter",
	"cache",
	"queue",
] as const;
const FAULT_KINDS = [
	"node-failure",
	"slowdown",
	"error-rate",
	"capacity",
	"link-latency",
	"link-loss",
	"cache-flush",
] as const;
const METRIC_TERMS = [
	"offered",
	"succeeded",
	"failed",
	"inFlight",
	"latency",
	"percentiles",
	"endedLatency",
	"failedWait",
	"calls",
	"detection",
	"queue",
] as const;

function Section({
	id,
	children,
}: {
	id: (typeof SECTIONS)[number];
	children: React.ReactNode;
}) {
	const { t } = useTranslation();
	return (
		<section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20">
			<h2 id={`${id}-h`} className="font-semibold text-xl tracking-tight">
				{t(`guide.sections.${id}`)}
			</h2>
			<div className="mt-3 grid gap-3 text-[15px] leading-relaxed [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5">
				{children}
			</div>
		</section>
	);
}

function Paragraphs({ k }: { k: string }) {
	const { t } = useTranslation();
	const items = t(k, { returnObjects: true }) as string[] | string;
	return (
		<>
			{(Array.isArray(items) ? items : [items]).map((p) => (
				<p key={p}>{p}</p>
			))}
		</>
	);
}

function GuidePage() {
	const { t } = useTranslation();
	useDocumentTitle(t("nav.guide"));
	return (
		<div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 sm:py-12 lg:grid-cols-[14rem_minmax(0,1fr)]">
			<nav
				aria-label={t("guide.onThisPage")}
				className="lg:sticky lg:top-20 lg:self-start"
			>
				<details className="group lg:hidden" open={false}>
					<summary className="cursor-pointer list-none font-medium text-sm marker:hidden [&::-webkit-details-marker]:hidden">
						<span className="inline-flex items-center gap-1">
							{t("guide.onThisPage")}
							<ChevronDown
								className="size-4 transition-transform group-open:rotate-180"
								aria-hidden="true"
							/>
						</span>
					</summary>
					<ul className="mt-2 grid gap-1 text-muted-foreground text-sm">
						{SECTIONS.map((s) => (
							<li key={s}>
								<a
									href={`#${s}`}
									className="hover:text-foreground hover:underline"
								>
									{t(`guide.sections.${s}`)}
								</a>
							</li>
						))}
					</ul>
				</details>
				<p className="hidden font-medium text-sm lg:block">
					{t("guide.onThisPage")}
				</p>
				<ul className="mt-2 hidden gap-1 text-muted-foreground text-sm lg:grid">
					{SECTIONS.map((s) => (
						<li key={s}>
							<a
								href={`#${s}`}
								className="hover:text-foreground hover:underline"
							>
								{t(`guide.sections.${s}`)}
							</a>
						</li>
					))}
				</ul>
				<p className="mt-4 font-mono text-muted-foreground text-xs leading-5 lg:mt-6">
					engine {ENGINE_VERSION}
					<br />
					schema {SCHEMA_VERSION}
					<br />
					metrics {METRIC_DEFINITIONS_VERSION}
				</p>
			</nav>

			<article className="grid max-w-[72ch] gap-12">
				<header>
					<h1 className="font-semibold text-3xl tracking-tight">
						{t("guide.title")}
					</h1>
					<p className="mt-3 text-lg text-muted-foreground">
						{t("guide.lead")}
					</p>
				</header>
				<Section id="what">
					<Paragraphs k="guide.what" />
				</Section>
				<Section id="components">
					<dl className="grid gap-3">
						{COMPONENTS.map((c) => (
							<div key={c} className="rounded-md border p-3">
								<dt className="font-medium">{t(`kinds.${c}`)}</dt>
								<dd className="mt-1 text-muted-foreground">
									{t(`guide.components.${c}`)}
								</dd>
							</div>
						))}
					</dl>
					<Paragraphs k="guide.catalog" />
				</Section>
				<Section id="contention">
					<Paragraphs k="guide.contention" />
				</Section>
				<Section id="lifecycle">
					<ol>
						{(
							t("guide.lifecycle.steps", { returnObjects: true }) as string[]
						).map((s) => (
							<li key={s}>{s}</li>
						))}
					</ol>
					<Paragraphs k="guide.lifecycle.note" />
				</Section>
				<Section id="faults">
					<Paragraphs k="guide.faults.intro" />
					<dl className="grid gap-3">
						{FAULT_KINDS.map((k) => (
							<div key={k} className="rounded-md border p-3">
								<dt className="font-medium">{t(`faultKinds.${k}.label`)}</dt>
								<dd className="mt-1 text-muted-foreground">
									{t(`faultKinds.${k}.help`)}
								</dd>
							</div>
						))}
					</dl>
					<Paragraphs k="guide.faults.health" />
				</Section>
				<Section id="resilience">
					<Paragraphs k="guide.resilience" />
				</Section>
				<Section id="metrics">
					<dl className="grid gap-3">
						{METRIC_TERMS.map((m) => (
							<div key={m} className="rounded-md border p-3">
								<dt className="font-medium">{t(`guide.metrics.${m}.term`)}</dt>
								<dd className="mt-1 text-muted-foreground">
									{t(`guide.metrics.${m}.def`)}
								</dd>
							</div>
						))}
					</dl>
					<h3 className="mt-2 font-semibold">{t("guide.reasonsTitle")}</h3>
					<ul>
						{FAILURE_REASONS.map((r) => (
							<li key={r}>
								<strong>{t(`reasons.${r}.label`)}.</strong>{" "}
								{t(`reasons.${r}.description`)}
							</li>
						))}
					</ul>
				</Section>
				<Section id="reproducibility">
					<Paragraphs k="guide.reproducibility" />
				</Section>
				<Section id="checks">
					<Paragraphs k="guide.checks.intro" />
					<ul>
						{(t("guide.checks.items", { returnObjects: true }) as string[]).map(
							(s) => (
								<li key={s}>{s}</li>
							),
						)}
					</ul>
					<Paragraphs k="guide.checks.note" />
				</Section>
				<Section id="limits">
					<ul>
						{(t("guide.limits.items", { returnObjects: true }) as string[]).map(
							(s) => (
								<li key={s}>{s}</li>
							),
						)}
						<li>
							{t("guide.limits.budget", {
								minutes: LIMITS.maxHorizonMs / 60_000,
								requests: formatCount(LIMITS.maxOfferedRequests),
								nodes: LIMITS.maxNodes,
							})}
						</li>
					</ul>
					<Paragraphs k="guide.limits.note" />
					<p>
						<Link to="/" className="underline underline-offset-4">
							{t("missing.back")}
						</Link>
					</p>
				</Section>
			</article>
		</div>
	);
}

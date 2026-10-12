import { Link } from "@tanstack/react-router";
import { Keyboard, Languages, Monitor, Moon, Sun } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { type Language, setLanguage } from "#/i18n/index.ts";
import { type ThemePreference, useTheme } from "#/state/theme.ts";
import { LogoMark } from "./logo.tsx";

export function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
		target.closest("[role='dialog'],[role='menu'],[role='listbox']") !== null
	);
}

export function AppShell({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const nav = [
		{
			to: "/",
			label: t("nav.experiments"),
			short: t("nav.experimentsShort"),
			exact: true,
		},
		{
			to: "/compare",
			label: t("nav.compare"),
			short: t("nav.compareShort"),
			exact: false,
		},
		{
			to: "/guide",
			label: t("nav.guide"),
			short: t("nav.guideShort"),
			exact: false,
		},
	] as const;

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "?" && !isTypingTarget(e.target)) {
				e.preventDefault();
				setShortcutsOpen(true);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<div className="flex min-h-dvh flex-col">
			<a
				href="#main"
				className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow"
			>
				{t("nav.skip")}
			</a>
			<header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
				<div className="mx-auto flex h-13 max-w-[1600px] items-center gap-1 px-3 sm:gap-6 sm:px-4">
					<Link
						to="/"
						className="flex items-center gap-2 rounded-md font-semibold tracking-tight"
						aria-label={t("nav.home")}
					>
						<LogoMark className="size-7 text-foreground" />
						<span className="hidden sm:inline">FaultWorks</span>
					</Link>
					<nav
						aria-label={t("nav.main")}
						className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
					>
						{nav.map((item) => (
							<Link
								key={item.to}
								to={item.to}
								activeOptions={{ exact: item.exact, includeSearch: false }}
								className="shrink-0 rounded-md px-2 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground sm:px-3"
							>
								<span className="sm:hidden">{item.short}</span>
								<span className="hidden sm:inline">{item.label}</span>
							</Link>
						))}
					</nav>
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setShortcutsOpen(true)}
							aria-label={t("shortcuts.title")}
							title={`${t("shortcuts.title")} (?)`}
							className="hidden sm:inline-flex"
						>
							<Keyboard />
						</Button>
						<LanguageMenu />
						<ThemeMenu />
					</div>
				</div>
			</header>
			<main id="main" tabIndex={-1} className="flex-1 outline-none">
				{children}
			</main>
			<footer className="border-t">
				<div className="mx-auto flex max-w-[1600px] flex-col gap-1 px-4 py-4 text-muted-foreground text-xs sm:flex-row sm:justify-between">
					<p>{t("footer.local")}</p>
					<p>
						{t("footer.model")}{" "}
						<a
							href="https://github.com/gmedia/fault-works"
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-4 hover:text-foreground"
						>
							{t("footer.source")}
						</a>
						.
					</p>
				</div>
			</footer>
			<ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
		</div>
	);
}

function LanguageMenu() {
	const { t, i18n } = useTranslation();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" aria-label={t("language.label")}>
					<Languages />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>{t("language.label")}</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={i18n.language}
					onValueChange={(v) => setLanguage(v as Language)}
				>
					<DropdownMenuRadioItem value="id">
						Bahasa Indonesia
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ThemeMenu() {
	const { t } = useTranslation();
	const { preference, setPreference } = useTheme();
	const Icon =
		preference === "dark" ? Moon : preference === "light" ? Sun : Monitor;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" aria-label={t("theme.label")}>
					<Icon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={preference}
					onValueChange={(v) => setPreference(v as ThemePreference)}
				>
					<DropdownMenuRadioItem value="light">
						{t("theme.light")}
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="dark">
						{t("theme.dark")}
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="system">
						{t("theme.system")}
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ShortcutsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { t } = useTranslation();
	const shortcuts: Array<[string, string]> = [
		["Ctrl / ⌘ + Enter", t("shortcuts.run")],
		[t("shortcuts.space"), t("shortcuts.play")],
		["← / →", t("shortcuts.step")],
		["Shift + ← / →", t("shortcuts.jump")],
		["Ctrl / ⌘ + Z", t("shortcuts.undo")],
		["Ctrl / ⌘ + Shift + Z", t("shortcuts.redo")],
		["Delete", t("shortcuts.delete")],
		["?", t("shortcuts.list")],
	];
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("shortcuts.title")}</DialogTitle>
					<DialogDescription>{t("shortcuts.description")}</DialogDescription>
				</DialogHeader>
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
					{shortcuts.map(([keys, action]) => (
						<div key={keys} className="contents">
							<dt>
								<kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
									{keys}
								</kbd>
							</dt>
							<dd className="text-muted-foreground">{action}</dd>
						</div>
					))}
				</dl>
			</DialogContent>
		</Dialog>
	);
}

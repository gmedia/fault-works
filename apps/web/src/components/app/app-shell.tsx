import { Link } from "@tanstack/react-router";
import { Keyboard, Monitor, Moon, Sun } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
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
import { type ThemePreference, useTheme } from "#/state/theme.ts";
import { LogoMark } from "./logo.tsx";

const NAV = [
	{ to: "/", label: "Experiments", exact: true },
	{ to: "/compare", label: "Compare", exact: false },
	{ to: "/guide", label: "Model guide", exact: false },
] as const;

export function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
		target.closest("[role='dialog'],[role='menu'],[role='listbox']") !== null
	);
}

export function AppShell({ children }: { children: ReactNode }) {
	const [shortcutsOpen, setShortcutsOpen] = useState(false);

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
				Skip to content
			</a>
			<header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
				<div className="mx-auto flex h-13 max-w-[1600px] items-center gap-1 px-3 sm:gap-6 sm:px-4">
					<Link
						to="/"
						className="flex items-center gap-2 rounded-md font-semibold tracking-tight"
						aria-label="FaultWorks home"
					>
						<LogoMark className="size-7 text-foreground" />
						<span className="hidden sm:inline">FaultWorks</span>
					</Link>
					<nav
						aria-label="Main"
						className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
					>
						{NAV.map((item) => (
							<Link
								key={item.to}
								to={item.to}
								activeOptions={{ exact: item.exact, includeSearch: false }}
								className="shrink-0 rounded-md px-2 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground sm:px-3"
							>
								{item.label}
							</Link>
						))}
					</nav>
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setShortcutsOpen(true)}
							aria-label="Keyboard shortcuts"
							title="Keyboard shortcuts (?)"
							className="hidden sm:inline-flex"
						>
							<Keyboard />
						</Button>
						<ThemeMenu />
					</div>
				</div>
			</header>
			<main id="main" tabIndex={-1} className="flex-1 outline-none">
				{children}
			</main>
			<footer className="border-t">
				<div className="mx-auto flex max-w-[1600px] flex-col gap-1 px-4 py-4 text-muted-foreground text-xs sm:flex-row sm:justify-between">
					<p>
						FaultWorks v0.1 runs entirely in your browser. Nothing is sent
						anywhere; experiments are saved in this browser only.
					</p>
					<p>
						Results are outputs of an abstract model, not measurements of real
						systems. Open source under Apache-2.0:{" "}
						<a
							href="https://github.com/gmedia/fault-works"
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-4 hover:text-foreground"
						>
							source on GitHub
						</a>
						.
					</p>
				</div>
			</footer>
			<ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
		</div>
	);
}

function ThemeMenu() {
	const { preference, setPreference } = useTheme();
	const Icon =
		preference === "dark" ? Moon : preference === "light" ? Sun : Monitor;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" aria-label={`Theme: ${preference}`}>
					<Icon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>Theme</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={preference}
					onValueChange={(v) => setPreference(v as ThemePreference)}
				>
					<DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="system">
						Match system
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const SHORTCUTS: Array<[string, string]> = [
	["Ctrl / ⌘ + Enter", "Run the experiment"],
	["Space", "Play or pause the replay"],
	["← / →", "Step the replay back or forward one window"],
	["Shift + ← / →", "Jump to the previous or next state change"],
	["Ctrl / ⌘ + Z", "Undo an edit"],
	["Ctrl / ⌘ + Shift + Z", "Redo"],
	["Delete", "Remove the selected server"],
	["?", "Show this list"],
];

function ShortcutsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription>
						These work in the experiment workbench when you are not typing in a
						field.
					</DialogDescription>
				</DialogHeader>
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
					{SHORTCUTS.map(([keys, action]) => (
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

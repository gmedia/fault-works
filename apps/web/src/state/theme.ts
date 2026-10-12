import { useCallback, useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
const KEY = "faultworks.theme";
const listeners = new Set<() => void>();

function read(): ThemePreference {
	try {
		const v = window.localStorage.getItem(KEY);
		return v === "light" || v === "dark" ? v : "system";
	} catch {
		return "system";
	}
}

/** Mirrors the inline script in index.html, which applies the theme before first paint. */
export function applyTheme(pref: ThemePreference) {
	const root = document.documentElement;
	if (pref === "system") root.removeAttribute("data-theme");
	else root.setAttribute("data-theme", pref);
}

export function useTheme() {
	const preference = useSyncExternalStore(
		(cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		read,
		() => "system" as const,
	);
	const setPreference = useCallback((pref: ThemePreference) => {
		try {
			if (pref === "system") window.localStorage.removeItem(KEY);
			else window.localStorage.setItem(KEY, pref);
		} catch {
			// Storage blocked: the theme still applies for this page view.
		}
		applyTheme(pref);
		for (const l of listeners) l();
	}, []);
	return { preference, setPreference };
}

/** The theme actually showing, for components (like the toaster) that need a concrete value. */
export function useResolvedTheme(): "light" | "dark" {
	const { preference } = useTheme();
	const systemDark = useSyncExternalStore(
		(cb) => {
			const mq = window.matchMedia("(prefers-color-scheme: dark)");
			mq.addEventListener("change", cb);
			return () => mq.removeEventListener("change", cb);
		},
		() => window.matchMedia("(prefers-color-scheme: dark)").matches,
		() => false,
	);
	if (preference === "system") return systemDark ? "dark" : "light";
	return preference;
}

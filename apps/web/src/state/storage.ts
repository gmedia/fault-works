import type { StateStorage } from "zustand/middleware";

/** localStorage can throw (private mode, blocked storage); the app must still work in memory. */
export const safeStorage: StateStorage & {
	getItem(name: string): string | null;
} = {
	getItem: (name) => {
		try {
			return window.localStorage.getItem(name);
		} catch {
			return null;
		}
	},
	setItem: (name, value) => {
		try {
			window.localStorage.setItem(name, value);
		} catch {
			// Quota or blocked storage: keep working in memory.
		}
	},
	removeItem: (name) => {
		try {
			window.localStorage.removeItem(name);
		} catch {
			// ignore
		}
	},
};

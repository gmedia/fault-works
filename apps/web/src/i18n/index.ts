import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { safeStorage } from "#/state/storage.ts";
import en from "./locales/en.json";
import id from "./locales/id.json";

export const LANGUAGES = ["id", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
const KEY = "faultworks.language";

/** Saved choice first, then the browser's language; Indonesian is the default everywhere else. */
export function detectLanguage(): Language {
	const saved = safeStorage.getItem(KEY);
	if (saved === "id" || saved === "en") return saved;
	const nav =
		typeof navigator === "undefined" ? "" : navigator.language.toLowerCase();
	return nav.startsWith("en") ? "en" : "id";
}

export function setLanguage(language: Language) {
	safeStorage.setItem(KEY, language);
	void i18next.changeLanguage(language);
	document.documentElement.lang = language;
}

i18next.use(initReactI18next).init({
	resources: { id: { translation: id }, en: { translation: en } },
	lng: detectLanguage(),
	fallbackLng: "en",
	interpolation: { escapeValue: false },
	returnNull: false,
	saveMissing: import.meta.env.DEV,
	missingKeyHandler: (_lng, _ns, key) => {
		if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
	},
});

if (typeof document !== "undefined")
	document.documentElement.lang = i18next.language;

export { i18next };

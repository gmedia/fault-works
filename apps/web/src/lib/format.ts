import { i18next } from "#/i18n/index.ts";

const locale = () => (i18next.language === "id" ? "id-ID" : "en-US");

export function formatCount(value: number): string {
	return new Intl.NumberFormat(locale()).format(Math.round(value));
}

export function formatNumber(value: number, digits = 1): string {
	return new Intl.NumberFormat(locale(), {
		maximumFractionDigits: digits,
	}).format(value);
}

export function formatPercent(part: number, whole: number, digits = 1): string {
	if (whole === 0) return "0%";
	const v = (part / whole) * 100;
	return `${formatNumber(v, v > 0 && v < 0.1 ? 2 : digits)}%`;
}

/** Simulated time: "12,5 dtk" / "12.5 s" or "850 ms". */
export function formatMs(ms: number): string {
	const s = i18next.t("units.s");
	if (ms >= 1000)
		return `${formatNumber(ms / 1000, ms >= 10_000 ? 1 : 3)} ${s}`;
	return `${formatNumber(ms, 1)} ms`;
}

export function formatSeconds(ms: number): string {
	return `${formatNumber(ms / 1000, ms < 10_000 ? 2 : 1)} ${i18next.t("units.s")}`;
}

/** Event-log timestamps with fixed millisecond precision. */
export function formatClock(ms: number): string {
	return `${new Intl.NumberFormat(locale(), { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(ms / 1000)} ${i18next.t("units.s")}`;
}

export function formatLatency(ms: number | null | undefined): string {
	if (ms === null || ms === undefined) return "–";
	if (ms >= 1000)
		return `${formatNumber(ms / 1000, 2)} ${i18next.t("units.s")}`;
	return `${formatNumber(ms, ms < 10 ? 2 : 0)} ms`;
}

export function formatRelative(timestamp: number, now = Date.now()): string {
	const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
	const seconds = Math.round((timestamp - now) / 1000);
	if (Math.abs(seconds) < 45) return i18next.t("time.justNow");
	const minutes = Math.round(seconds / 60);
	if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
	const hours = Math.round(minutes / 60);
	if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
	return new Date(timestamp).toLocaleDateString(locale(), {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

/** A setting value with its unit, in the user's language. */
export function formatUnitValue(value: unknown, unit: string | null): string {
	if (value === null || value === undefined) return "–";
	if (typeof value === "boolean")
		return i18next.t(value ? "common.on" : "common.off");
	if (typeof value === "number") {
		if (unit === "%") return `${formatNumber(value * 100, 1)}%`;
		if (unit === "ms") return formatMs(value);
		if (unit === "x") return `${formatNumber(value, 2)}×`;
		const n = formatNumber(value, 3);
		return unit
			? `${n} ${i18next.t(`units.${unit}`, { defaultValue: unit })}`
			: n;
	}
	return String(value);
}

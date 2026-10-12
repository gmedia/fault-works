export { formatMs } from "@faultworks/metrics";

const numberFormat = new Intl.NumberFormat("en-US");

export function formatCount(value: number): string {
	return numberFormat.format(Math.round(value));
}

export function formatPercent(part: number, whole: number, digits = 1): string {
	if (whole === 0) return "0%";
	const v = (part / whole) * 100;
	return `${v.toLocaleString("en-US", { maximumFractionDigits: v > 0 && v < 0.1 ? 2 : digits })}%`;
}

/** Axis/tick seconds: "0 s", "12.5 s". */
export function formatSeconds(ms: number): string {
	const s = ms / 1000;
	return `${s.toLocaleString("en-US", { maximumFractionDigits: s < 10 ? 2 : 1 })} s`;
}

/** Event-log timestamps with fixed millisecond precision: "20.010 s". */
export function formatClock(ms: number): string {
	return `${(ms / 1000).toFixed(3)} s`;
}

export function formatLatency(ms: number | null | undefined): string {
	if (ms === null || ms === undefined) return "–";
	if (ms >= 1000)
		return `${(ms / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} s`;
	return `${ms.toLocaleString("en-US", { maximumFractionDigits: ms < 10 ? 2 : 0 })} ms`;
}

export function formatRelative(timestamp: number, now = Date.now()): string {
	const seconds = Math.round((now - timestamp) / 1000);
	if (seconds < 45) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return new Date(timestamp).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function shortDigest(digest: string): string {
	return digest.slice(0, 12);
}

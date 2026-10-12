import type { LatencyStats } from "./types.ts";

/**
 * Nearest-rank percentile on an ascending array: the smallest sample such that at least p% of
 * samples are less than or equal to it. Always returns an observed value, never an interpolation.
 */
export function nearestRank(sorted: ArrayLike<number>, p: number): number {
	if (sorted.length === 0) throw new Error("No samples");
	const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
	return sorted[Math.min(rank, sorted.length) - 1] as number;
}

export function latencyStats(samplesUs: Float64Array): LatencyStats | null {
	if (samplesUs.length === 0) return null;
	const sorted = Float64Array.from(samplesUs).sort();
	let sum = 0;
	for (const v of sorted) sum += v;
	return {
		n: sorted.length,
		p50Ms: nearestRank(sorted, 50) / 1000,
		p95Ms: nearestRank(sorted, 95) / 1000,
		p99Ms: nearestRank(sorted, 99) / 1000,
		meanMs: sum / sorted.length / 1000,
		maxMs: (sorted[sorted.length - 1] as number) / 1000,
	};
}

/** Growable Float64 buffer for latency samples. */
export class SampleBuffer {
	private data = new Float64Array(1024);
	length = 0;

	push(v: number) {
		if (this.length === this.data.length) {
			const next = new Float64Array(this.data.length * 2);
			next.set(this.data);
			this.data = next;
		}
		this.data[this.length++] = v;
	}

	view(): Float64Array {
		return this.data.subarray(0, this.length);
	}
}

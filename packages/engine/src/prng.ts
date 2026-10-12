/**
 * Seeded pseudo-random numbers.
 *
 * Algorithm (part of the reproducibility contract, changing it is an engine major change):
 * - Seeds and stream names are mixed with SplitMix32 into four 32-bit words.
 * - Numbers are drawn with SFC32 (Small Fast Counter, Chris Doty-Humphrey), 12 warm-up rounds.
 * - `next()` returns `sfc32() / 2^32`, a float in [0, 1).
 *
 * Each concern draws from its own named stream (arrivals, service time per server id) so that
 * adding a server or toggling a fault does not shift the random numbers another component sees.
 */

export interface Rng {
	/** Uniform float in [0, 1). */
	next(): number;
	/** Exponentially distributed value with the given mean. */
	exponential(mean: number): number;
}

/** FNV-1a 32-bit hash, used to turn stream names into seed material. */
export function fnv1a32(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function splitmix32(state: number): () => number {
	let s = state >>> 0;
	return () => {
		s = (s + 0x9e3779b9) | 0;
		let z = s;
		z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
		z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
		return (z ^ (z >>> 16)) >>> 0;
	};
}

export function createRng(seed: number, stream: string): Rng {
	const mix = splitmix32((seed >>> 0) ^ fnv1a32(stream));
	let a = mix();
	let b = mix();
	let c = mix();
	let d = mix();

	const sfc32 = () => {
		a >>>= 0;
		b >>>= 0;
		c >>>= 0;
		d >>>= 0;
		let t = (a + b) | 0;
		a = b ^ (b >>> 9);
		b = (c + (c << 3)) | 0;
		c = (c << 21) | (c >>> 11);
		d = (d + 1) | 0;
		t = (t + d) | 0;
		c = (c + t) | 0;
		return t >>> 0;
	};

	for (let i = 0; i < 12; i++) sfc32();

	const next = () => sfc32() / 4294967296;

	return {
		next,
		exponential(mean) {
			// 1 - u is in (0, 1], so the logarithm is always finite.
			return -mean * Math.log(1 - next());
		},
	};
}

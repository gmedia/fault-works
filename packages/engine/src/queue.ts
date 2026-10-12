/**
 * Binary min-heap ordered by `(t, priority, seq)`. `seq` is a monotonically increasing insertion
 * counter, so two entries with the same time and priority always pop in scheduling order and the
 * trace never depends on heap internals.
 */
export interface Scheduled {
	t: number;
	priority: number;
	seq: number;
}

function before(a: Scheduled, b: Scheduled): boolean {
	if (a.t !== b.t) return a.t < b.t;
	if (a.priority !== b.priority) return a.priority < b.priority;
	return a.seq < b.seq;
}

export class EventQueue<T extends Scheduled> {
	private items: T[] = [];

	get size(): number {
		return this.items.length;
	}

	peek(): T | undefined {
		return this.items[0];
	}

	push(item: T): void {
		const items = this.items;
		items.push(item);
		let i = items.length - 1;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			const p = items[parent] as T;
			if (!before(item, p)) break;
			items[i] = p;
			i = parent;
		}
		items[i] = item;
	}

	pop(): T | undefined {
		const items = this.items;
		const top = items[0];
		const last = items.pop();
		if (top === undefined || last === undefined || items.length === 0)
			return top;

		let i = 0;
		const n = items.length;
		for (;;) {
			const left = 2 * i + 1;
			if (left >= n) break;
			const right = left + 1;
			let child = left;
			if (right < n && before(items[right] as T, items[left] as T))
				child = right;
			const c = items[child] as T;
			if (!before(c, last)) break;
			items[i] = c;
			i = child;
		}
		items[i] = last;
		return top;
	}
}

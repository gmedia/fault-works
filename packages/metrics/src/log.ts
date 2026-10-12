import {
	EVENT_KINDS,
	FAILURE_REASONS,
	type FailureReason,
	type SimEvent,
	type SimEventKind,
} from "@faultworks/engine";

export const EVENT_KIND_INDEX = Object.fromEntries(
	EVENT_KINDS.map((kind, i) => [kind, i]),
) as Record<SimEventKind, number>;

/** Plain buffers, transferable from a worker without copying. */
export interface EventLogData {
	length: number;
	/** Events after this many were not recorded (the run itself was complete). */
	truncated: boolean;
	t: Float64Array;
	kind: Uint8Array;
	req: Int32Array;
	server: Int16Array;
	/** Kind-specific small integer: reason, fault index, queue depth, ok/healthy flag, from. */
	a: Int32Array;
	/** Kind-specific duration in µs: latency or queued time. */
	b: Float64Array;
}

export interface EventRow {
	index: number;
	tMs: number;
	kind: SimEventKind;
	req: number | null;
	server: number | null;
	reason: FailureReason | null;
	fault: number | null;
	depth: number | null;
	flag: boolean | null;
	from: "queue" | "service" | null;
	durationMs: number | null;
}

/**
 * Columnar recorder for the event table. Request-level events past `maxRows` are dropped, but
 * state changes (faults, probes, health) are always kept so the timeline stays complete.
 */
export class EventLogRecorder {
	private capacity = 4096;
	private data: EventLogData;
	private requestRows = 0;

	constructor(private readonly maxRequestRows = 400_000) {
		this.data = this.allocate(this.capacity);
	}

	private allocate(capacity: number): EventLogData {
		return {
			length: 0,
			truncated: false,
			t: new Float64Array(capacity),
			kind: new Uint8Array(capacity),
			req: new Int32Array(capacity),
			server: new Int16Array(capacity),
			a: new Int32Array(capacity),
			b: new Float64Array(capacity),
		};
	}

	private grow() {
		const next = this.allocate(this.capacity * 2);
		const d = this.data;
		next.t.set(d.t);
		next.kind.set(d.kind);
		next.req.set(d.req);
		next.server.set(d.server);
		next.a.set(d.a);
		next.b.set(d.b);
		next.length = d.length;
		next.truncated = d.truncated;
		this.capacity *= 2;
		this.data = next;
	}

	push(e: SimEvent) {
		const isRequestLevel = "req" in e;
		if (isRequestLevel) {
			if (this.requestRows >= this.maxRequestRows) {
				this.data.truncated = true;
				return;
			}
			this.requestRows++;
		}
		if (this.data.length === this.capacity) this.grow();
		const d = this.data;
		const i = d.length++;
		d.t[i] = e.t;
		d.kind[i] = EVENT_KIND_INDEX[e.kind];
		d.req[i] = "req" in e ? e.req : -1;
		d.server[i] = "server" in e ? e.server : -1;
		let a = 0;
		let b = 0;
		switch (e.kind) {
			case "enqueued":
				a = e.depth;
				break;
			case "service-start":
				b = e.queuedUs;
				break;
			case "evicted":
				a = e.from === "queue" ? 0 : 1;
				break;
			case "succeeded":
				b = e.latencyUs;
				break;
			case "failed":
				a = FAILURE_REASONS.indexOf(e.reason);
				b = e.latencyUs;
				break;
			case "node-down":
			case "node-up":
				a = e.fault;
				break;
			case "probe":
				a = e.ok ? 1 : 0;
				break;
			case "health-changed":
				a = e.healthy ? 1 : 0;
				b = e.fault;
				break;
			default:
				break;
		}
		d.a[i] = a;
		d.b[i] = b;
	}

	/** Trimmed buffers. The recorder must not be used afterwards. */
	finish(): EventLogData {
		const d = this.data;
		const n = d.length;
		return {
			length: n,
			truncated: d.truncated,
			t: d.t.slice(0, n),
			kind: d.kind.slice(0, n),
			req: d.req.slice(0, n),
			server: d.server.slice(0, n),
			a: d.a.slice(0, n),
			b: d.b.slice(0, n),
		};
	}
}

export function readEventRow(log: EventLogData, index: number): EventRow {
	const kind = EVENT_KINDS[log.kind[index] as number] as SimEventKind;
	const req = log.req[index] as number;
	const server = log.server[index] as number;
	const a = log.a[index] as number;
	const b = log.b[index] as number;
	const row: EventRow = {
		index,
		tMs: (log.t[index] as number) / 1000,
		kind,
		req: req === -1 ? null : req,
		server: server === -1 ? null : server,
		reason: null,
		fault: null,
		depth: null,
		flag: null,
		from: null,
		durationMs: null,
	};
	switch (kind) {
		case "enqueued":
			row.depth = a;
			break;
		case "service-start":
			row.durationMs = b / 1000;
			break;
		case "evicted":
			row.from = a === 0 ? "queue" : "service";
			break;
		case "succeeded":
			row.durationMs = b / 1000;
			break;
		case "failed":
			row.reason = FAILURE_REASONS[a] ?? null;
			row.durationMs = b / 1000;
			break;
		case "node-down":
		case "node-up":
			row.fault = a;
			break;
		case "probe":
			row.flag = a === 1;
			break;
		case "health-changed":
			row.flag = a === 1;
			row.fault = b === -1 ? null : b;
			break;
		default:
			break;
	}
	return row;
}

/** Index of the first event at or after `tMs` (binary search on the sorted time column). */
export function firstEventAtOrAfter(log: EventLogData, tMs: number): number {
	const target = tMs * 1000;
	let lo = 0;
	let hi = log.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((log.t[mid] as number) < target) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

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
	/** Request-level events after this many were not recorded (the run itself was complete). */
	truncated: boolean;
	t: Float64Array;
	kind: Uint8Array;
	req: Int32Array;
	/** Node the event is about, or -1. */
	node: Int16Array;
	/** Edge (for call events and breaker changes), or -1. */
	edge: Int16Array;
	/** Kind-specific small integer: reason, fault index, queue depth, flag, attempt, from. */
	a: Int32Array;
	/** Kind-specific duration in µs: latency or queued time. */
	b: Float64Array;
}

export interface EventRow {
	index: number;
	tMs: number;
	kind: SimEventKind;
	req: number | null;
	node: number | null;
	edge: number | null;
	reason: FailureReason | null;
	fault: number | null;
	depth: number | null;
	flag: boolean | null;
	attempt: number | null;
	from: "queue" | "service" | null;
	breakerState: "open" | "half-open" | "closed" | null;
	durationMs: number | null;
	/** Balancer index for probe and health events; chosen backend for routing; new primary. */
	via: number | null;
	/** Service starts: own work after slowdowns and contention. */
	workMs: number | null;
	/** Promotions: the old primary. */
	fromNode: number | null;
}

const BREAKER_STATES = ["open", "half-open", "closed"] as const;

/**
 * Columnar recorder for the event table. Request-level events past `maxRows` are dropped, but
 * state changes (faults, probes, health, breakers) are always kept so the timeline stays complete.
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
			node: new Int16Array(capacity),
			edge: new Int16Array(capacity),
			a: new Int32Array(capacity),
			b: new Float64Array(capacity),
		};
	}

	private grow() {
		const next = this.allocate(this.capacity * 2);
		const d = this.data;
		for (const key of ["t", "kind", "req", "node", "edge", "a", "b"] as const)
			(next[key] as { set(a: ArrayLike<number>): void }).set(d[key]);
		next.length = d.length;
		next.truncated = d.truncated;
		this.capacity *= 2;
		this.data = next;
	}

	push(e: SimEvent) {
		if ("req" in e) {
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
		d.node[i] = "node" in e ? e.node : -1;
		d.edge[i] = "edge" in e ? e.edge : -1;
		let a = 0;
		let b = 0;
		switch (e.kind) {
			case "failed":
				a = FAILURE_REASONS.indexOf(e.reason);
				b = e.latencyUs;
				break;
			case "succeeded":
				b = e.latencyUs;
				break;
			case "call-start":
				a = e.attempt;
				break;
			case "call-end":
				a = e.ok ? -1 : FAILURE_REASONS.indexOf(e.reason as FailureReason);
				b = e.latencyUs;
				break;
			case "routed":
				a = e.to;
				break;
			case "enqueued":
				a = e.depth;
				break;
			case "service-start":
				a = Math.min(2_147_483_647, e.workUs);
				b = e.queuedUs;
				break;
			case "abandoned":
				a = e.reason === "deadline" ? 1 : 0;
				break;
			case "promoted":
				a = e.to;
				b = e.from;
				break;
			case "evicted":
				a = e.from === "queue" ? 0 : 1;
				break;
			case "cache-hit":
				a = e.hit ? 1 : 0;
				break;
			case "job-start":
				b = e.waitedUs;
				break;
			case "job-done":
				a = e.ok ? 1 : 0;
				b = e.job;
				break;
			case "node-down":
			case "node-up":
			case "fault-start":
			case "fault-end":
				a = e.fault;
				break;
			case "probe":
				a = e.ok ? 1 : 0;
				b = e.from;
				break;
			case "health-changed":
				a = e.healthy ? 1 : 0;
				b = e.fault * 1000 + e.from;
				break;
			case "breaker":
				a = BREAKER_STATES.indexOf(e.state);
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
			node: d.node.slice(0, n),
			edge: d.edge.slice(0, n),
			a: d.a.slice(0, n),
			b: d.b.slice(0, n),
		};
	}
}

export function readEventRow(log: EventLogData, index: number): EventRow {
	const kind = EVENT_KINDS[log.kind[index] as number] as SimEventKind;
	const req = log.req[index] as number;
	const node = log.node[index] as number;
	const edge = log.edge[index] as number;
	const a = log.a[index] as number;
	const b = log.b[index] as number;
	const row: EventRow = {
		index,
		tMs: (log.t[index] as number) / 1000,
		kind,
		req: req === -1 ? null : req,
		node: node === -1 ? null : node,
		edge: edge === -1 ? null : edge,
		reason: null,
		fault: null,
		depth: null,
		flag: null,
		attempt: null,
		from: null,
		breakerState: null,
		durationMs: null,
		via: null,
		workMs: null,
		fromNode: null,
	};
	switch (kind) {
		case "failed":
			row.reason = FAILURE_REASONS[a] ?? null;
			row.durationMs = b / 1000;
			break;
		case "succeeded":
			row.durationMs = b / 1000;
			break;
		case "call-start":
			row.attempt = a;
			break;
		case "call-end":
			row.flag = a === -1;
			row.reason = a === -1 ? null : (FAILURE_REASONS[a] ?? null);
			row.durationMs = b / 1000;
			break;
		case "routed":
			row.via = a; // the chosen backend
			break;
		case "enqueued":
			row.depth = a;
			break;
		case "service-start":
			row.durationMs = b / 1000;
			row.workMs = a / 1000;
			break;
		case "abandoned":
			row.reason = a === 1 ? "timeout" : "queue-timeout";
			break;
		case "promoted":
			row.via = a;
			row.fromNode = b;
			break;
		case "evicted":
			row.from = a === 0 ? "queue" : "service";
			break;
		case "cache-hit":
		case "job-done":
			row.flag = a === 1;
			break;
		case "job-start":
			row.durationMs = b / 1000;
			break;
		case "node-down":
		case "node-up":
		case "fault-start":
		case "fault-end":
			row.fault = a;
			break;
		case "probe":
			row.flag = a === 1;
			row.via = b;
			break;
		case "health-changed": {
			row.flag = a === 1;
			const fault = Math.floor(b / 1000);
			row.fault = fault === -1 ? null : fault;
			row.via = ((b % 1000) + 1000) % 1000;
			break;
		}
		case "breaker":
			row.breakerState = BREAKER_STATES[a] ?? null;
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

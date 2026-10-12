import type { Experiment } from "@faultworks/experiment";
import {
	handleRequest,
	type RunResult,
	type SweepPoint,
	type WorkerRequest,
	type WorkerResponse,
} from "./protocol.ts";

type Pending = {
	resolve: (r: WorkerResponse) => void;
	reject: (e: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
	if (worker) return worker;
	if (typeof Worker === "undefined") return null;
	worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), {
		type: "module",
	});
	worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
		const entry = pending.get(event.data.id);
		if (!entry) return;
		pending.delete(event.data.id);
		entry.resolve(event.data);
	};
	worker.onerror = (event) => {
		const error = new Error(event.message || "The simulation worker crashed.");
		for (const entry of pending.values()) entry.reject(error);
		pending.clear();
		worker?.terminate();
		worker = null;
	};
	return worker;
}

type RequestBody = WorkerRequest extends infer R
	? R extends WorkerRequest
		? Omit<R, "id">
		: never
	: never;

function send(request: RequestBody): Promise<WorkerResponse> {
	const id = nextId++;
	const full = { ...request, id } as WorkerRequest;
	const target = getWorker();
	// Environments without workers (tests) run the same code inline.
	if (!target) return Promise.resolve(handleRequest(full));
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		target.postMessage(full);
	});
}

export async function runInWorker(
	experiment: Experiment,
	recordLog = true,
): Promise<RunResult> {
	const response = await send({ type: "run", experiment, recordLog });
	if (!response.ok) throw new Error(response.error);
	if (response.type !== "run") throw new Error("Unexpected worker response");
	return response.result;
}

export async function sweepInWorker(
	experiment: Experiment,
	seeds: number[],
): Promise<SweepPoint[]> {
	const response = await send({ type: "sweep", experiment, seeds });
	if (!response.ok) throw new Error(response.error);
	if (response.type !== "sweep") throw new Error("Unexpected worker response");
	return response.points;
}

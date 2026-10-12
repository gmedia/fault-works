/// <reference lib="webworker" />
import {
	handleRequest,
	transferablesOf,
	type WorkerRequest,
} from "./protocol.ts";

// The simulation runs here so a long run never blocks input, scrolling or the playback clock.
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const response = handleRequest(event.data);
	(self as unknown as DedicatedWorkerGlobalScope).postMessage(
		response,
		transferablesOf(response),
	);
};

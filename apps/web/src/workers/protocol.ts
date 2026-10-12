import { ENGINE_VERSION } from "@faultworks/engine";
import {
	compileExperiment,
	type Experiment,
	inputDigest,
	parseExperiment,
	runKey,
	type TopologyInfo,
} from "@faultworks/experiment";
import {
	type EventLogData,
	METRIC_DEFINITIONS_VERSION,
	type RunMetrics,
	type RunSummary,
	runSimulation,
} from "@faultworks/metrics";

export interface RunResult {
	experiment: Experiment;
	topology: TopologyInfo;
	horizonMs: number;
	metrics: RunMetrics;
	log: EventLogData | null;
	engineVersion: string;
	metricDefinitionsVersion: string;
	inputDigest: string;
	runKey: string;
	/** Wall-clock time the simulation took in the worker. Never part of the result itself. */
	durationMs: number;
	finishedAt: number;
}

export interface SweepPoint {
	seed: number;
	summary: RunSummary;
	traceDigest: string;
}

export type WorkerRequest =
	| { id: number; type: "run"; experiment: Experiment; recordLog: boolean }
	| { id: number; type: "sweep"; experiment: Experiment; seeds: number[] };

export type WorkerResponse =
	| { id: number; ok: true; type: "run"; result: RunResult }
	| { id: number; ok: true; type: "sweep"; points: SweepPoint[] }
	| { id: number; ok: false; error: string };

/** Validates again on the worker side: the worker never trusts what the page hands it. */
function prepare(experiment: Experiment) {
	const parsed = parseExperiment(experiment);
	if (!parsed.ok)
		throw new Error(
			`invalid experiment: ${parsed.issues.map((i) => `${i.path} ${i.message.key}`).join(", ")}`,
		);
	return {
		experiment: parsed.experiment,
		compiled: compileExperiment(parsed.experiment),
	};
}

export function executeRun(input: Experiment, recordLog: boolean): RunResult {
	const { experiment, compiled } = prepare(input);
	const output = runSimulation(compiled.engine, {
		labels: compiled.topology.nodeLabels,
		windowMs: compiled.sampleWindowMs,
		recordLog,
	});
	return {
		experiment,
		topology: compiled.topology,
		horizonMs: compiled.horizonMs,
		metrics: output.metrics,
		log: output.log,
		engineVersion: ENGINE_VERSION,
		metricDefinitionsVersion: METRIC_DEFINITIONS_VERSION,
		inputDigest: inputDigest(experiment),
		runKey: runKey(experiment),
		durationMs: output.durationMs,
		finishedAt: Date.now(),
	};
}

export function executeSweep(input: Experiment, seeds: number[]): SweepPoint[] {
	const { compiled } = prepare(input);
	return seeds.map((seed) => {
		const output = runSimulation(
			{ ...compiled.engine, seed },
			{
				labels: compiled.topology.nodeLabels,
				windowMs: compiled.sampleWindowMs,
				recordLog: false,
			},
		);
		return {
			seed,
			summary: output.metrics.summary,
			traceDigest: output.metrics.traceDigest,
		};
	});
}

export function handleRequest(request: WorkerRequest): WorkerResponse {
	try {
		if (request.type === "run")
			return {
				id: request.id,
				ok: true,
				type: "run",
				result: executeRun(request.experiment, request.recordLog),
			};
		return {
			id: request.id,
			ok: true,
			type: "sweep",
			points: executeSweep(request.experiment, request.seeds),
		};
	} catch (error) {
		return {
			id: request.id,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function transferablesOf(response: WorkerResponse): Transferable[] {
	if (!response.ok || response.type !== "run" || !response.result.log)
		return [];
	const log = response.result.log;
	return [
		log.t.buffer,
		log.kind.buffer,
		log.req.buffer,
		log.node.buffer,
		log.edge.buffer,
		log.a.buffer,
		log.b.buffer,
	];
}

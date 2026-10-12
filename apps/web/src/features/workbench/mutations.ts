import type {
	Experiment,
	ExperimentNode,
	Fault,
	HealthCheck,
	LoadBalancerNode,
	ServerNode,
} from "@faultworks/experiment";

/** Small immutable updaters used by the inspector. */

export function nodeIndex(experiment: Experiment, id: string): number {
	return experiment.model.nodes.findIndex((n) => n.id === id);
}

export function updateNode<N extends ExperimentNode>(
	experiment: Experiment,
	id: string,
	fn: (node: N) => N,
): Experiment {
	return {
		...experiment,
		model: {
			...experiment.model,
			nodes: experiment.model.nodes.map((n) => (n.id === id ? fn(n as N) : n)),
		},
	};
}

export function updateServerConfig(
	experiment: Experiment,
	id: string,
	patch: Partial<ServerNode["config"]>,
): Experiment {
	return updateNode<ServerNode>(experiment, id, (n) => ({
		...n,
		config: { ...n.config, ...patch },
	}));
}

export function updateHealthCheck(
	experiment: Experiment,
	patch: Partial<HealthCheck>,
): Experiment {
	return {
		...experiment,
		model: {
			...experiment.model,
			nodes: experiment.model.nodes.map((n) =>
				n.kind === "load-balancer"
					? ({
							...n,
							config: {
								...n.config,
								healthCheck: { ...n.config.healthCheck, ...patch },
							},
						} satisfies LoadBalancerNode)
					: n,
			),
		},
	};
}

export function updateFault(
	experiment: Experiment,
	index: number,
	patch: Partial<Fault>,
): Experiment {
	return {
		...experiment,
		faults: experiment.faults.map((f, i) =>
			i === index ? { ...f, ...patch } : f,
		),
	};
}

export function setLabel(
	experiment: Experiment,
	id: string,
	label: string,
): Experiment {
	return updateNode(experiment, id, (n) => {
		const trimmed = label.slice(0, 40);
		const next = { ...n };
		if (trimmed.trim() === "") delete next.label;
		else next.label = trimmed;
		return next;
	});
}

export function loadBalancer(
	experiment: Experiment,
): LoadBalancerNode | undefined {
	return experiment.model.nodes.find(
		(n): n is LoadBalancerNode => n.kind === "load-balancer",
	);
}

# Local Sandbox Architecture and Security (Future)

**Not in MVP.** This document prevents an attractive future capability from dictating current browser-only architecture.

## Desired capability

Run one allowlisted real proxy scenario locally: proxy → dummy backend A/B; create isolated network; generate bounded traffic; stop/restart a backend; collect timestamps/errors; tear everything down; compare only semantically aligned metrics to the browser model.

## Why a separate agent?

A static browser cannot securely manage arbitrary host containers, network namespaces, cgroups or packet impairments. These operations require operating-system privileges and therefore a **distinct trusted execution component**.

## Proposed boundary

```text
Browser UI (unprivileged)
  | structured experiment request, loopback-only
Local agent (Go; explicit user action; policy validator)
  | approved scenarios / known OCI digests / resource limits
Container runtime, dedicated isolated network
  | metrics / stdout / timed observations
Local agent -> normalized observation artifact -> browser compare
```

## Minimum safety requirements before ANY release

- Bind agent to loopback only with explicit origin/token protection; never expose Docker socket or unauthenticated execution API.
- Allowlist known scenario templates and pinned images/digests; prohibit arbitrary host mounts, privileged mode, Docker socket mounts, host networking, device passthrough and uncontrolled `CAP_NET_ADMIN`.
- Restrict network egress, ingress, namespace, CPU, memory, PIDs, storage, run duration, user IDs, and cleanup policies.
- Define exact effects of `kill`, `restart`, and network fault injection; require explicit approval for destructive actions.
- Use fixed disposable namespaces, labels, generated unique IDs, and idempotent cleanup; avoid affecting existing Docker workloads.
- Protect against SSRF, path traversal, command injection, OCI image supply-chain risk, runaway requests and zip bombs.
- Log execution results without secrets; provide reliable emergency stop and audit trail.
- Container isolation is **not** equivalent to a hardened multi-tenant security boundary. Hosted arbitrary code would require much stronger isolation (possibly per-user VMs) and independent threat modeling.

## Measurement parity challenge

Synthetic `100 RPS` differs from a load generator aiming for 100 RPS under saturation. 'Health check every 5 sec' may not match real product semantics. Report the difference in terminology, time axis, semantics, scheduling jitter, backend processing behavior and sample size, rather than reporting one unexplained accuracy score.

## Decision gate

Do not start sandbox implementation until v0.1 is useful to real pilot users, experiment contracts are stable, and a written threat model + local cleanup plan have been reviewed. Prefer **one safe demo topology** before general orchestration.

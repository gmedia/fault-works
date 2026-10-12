# Simulated Pilot (October 2026)

**This is not the pilot in [docs/10](10-VALIDATION-PLAN.md).** Four AI agents played the pilot personas and used the running app through a headless browser, without access to the source code or docs. They are good at finding confusing wording, dead ends and bugs. They cannot show whether real engineers or students understand the results, because the agents already know how load balancers behave. The go/no-go decision for v0.2 still needs three to five real people.

## Setup

All four received the task from docs/10: *"A two-backend service loses one backend while receiving constant traffic. Show how failure detection changes unsuccessful requests and latency, then export enough evidence for someone else to reproduce it."*

| Persona | Device | Extra task |
|---|---|---|
| SRE, skeptical of simulators | desktop | none |
| Backend developer, skims and experiments | desktop | try one change of their own |
| Intern, English as a second language | phone (390 px) | explain the result to a classmate |
| Lecturer | desktop | author a lab, re-import it as a student and check reproducibility |

## What went well

Every persona finished the core task and explained the 1,005 versus 255 failed requests correctly, with the right mechanism: half the traffic goes to the dead server until two probes fail. All four reached their first run within four steps. The lecturer's student copy reproduced the teacher's run byte for byte, including the exported files. The parts they named most often as worth keeping were the "What changed from A to B" check, the plain-language explanation built from events, the inline detection-delay hint, and the paired seed check.

## Problems found, and what changed

| Problem | Reported by | Fix |
|---|---|---|
| Importing a `.result.json` failed with a message blaming the export | all four | Import now accepts result and comparison files, re-runs the embedded experiment and shows whether the behavior digest, trace fingerprint and counts match. |
| No way to export a comparison | all four | Compare exports one `.comparison.json` (importable, recreates both sides) and a Markdown report. |
| Latency "no change" everywhere, even when a hanging backend made clients wait three times longer | all four | Compare adds timed-out count, mean latency of all ended requests, total client time spent on failed requests, a p95 chart that includes failures, and a sentence explaining when percentiles hide the difference. |
| Success latency marked "better" when it improved only because fewer requests succeeded | lecturer | Such rows carry a caution note and are not colored as better or worse. |
| Results gone after a reload | all four | Experiments this browser has run before are re-run on open (results are reproducible, so nothing is stored). |
| Compare opened from an experiment made it the baseline | SRE, developer, lecturer | The open experiment becomes B; a variant's original is filled in as A. |
| A detection delay of 5 s read as typical, although the crash landed exactly on a probe | SRE, developer, intern | Results state the possible range for the settings and say when the crash hit a probe; the home page says "5 to 10 seconds". |
| Variants inherited the original's description and expected observations | SRE | Variants start with a prompt to describe the change and no hypotheses. |
| The input digest changed after a renamed import, so copies looked different | intern, developer | The UI and exports lead with the behavior digest, which ignores ids, titles and notes; the file digest is labeled as covering them. |
| New experiments were stuck with the id `untitled-experiment`; re-importing created look-alike duplicates | lecturer | New experiments ask for a title that names the file; the id can be changed in Notes; importing an identical experiment reuses it, and clashing ids are marked "(imported)". |
| On a phone: canvas unreadable, results far below Run, icon-only toolbar, small targets | intern | Phones get a stacked component list, Run and component taps scroll to the relevant section, toolbar buttons keep their labels, touch targets are at least 44 px. |
| "p95" and "Checks" were unclear | intern | p95 is explained next to the figures and in the guide; the tab is now "Engine checks". |
| Probes looked free, so shorter intervals seemed to have no cost | developer | Results show the probe count and say that probe cost is not modeled. |

A render loop introduced while fixing these broke the home page; the existing E2E suite caught it before commit.

## Not done yet

- Assignment support for courses: a "task for students" field, locking all settings but one, and grading helpers.
- Modeling probe cost, retries and passive health checks.
- Sweeping the crash time across the probe cycle automatically.

These are candidates for v0.2, to be prioritized by the real pilot.

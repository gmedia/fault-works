# Security Policy

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**, or go to <https://github.com/gmedia/fault-works/security/advisories/new>. Do not open a public issue, discussion or pull request for a suspected vulnerability.

Include what you found, how to reproduce it (an experiment or result file is ideal), and what an attacker could do with it. We will acknowledge the report as soon as we can, aim to do so within 7 days, and keep you informed until it is resolved. If you would like to be credited in the advisory, tell us the name to use.

## Supported versions

FaultWorks is pre-1.0. Only the latest version on the `main` branch receives security fixes.

## What is in scope

FaultWorks runs entirely in the browser. There is no server, account or telemetry, and experiments are stored in the browser's local storage. The parts that handle untrusted input are the most relevant:

- importing experiment, result and comparison files (JSON parsing, validation, size limits);
- rendering names, notes and other text taken from imported files;
- the simulation worker, which must not be driven into unbounded memory or CPU use by a crafted file;
- exported files, which must not carry anything beyond the experiment and its results.

Reports about the build and CI pipeline, and about dependencies with a demonstrated impact on FaultWorks, are also welcome.

## Out of scope

- The accuracy of simulation results compared with real systems. That is a modeling question; please open a regular issue.
- Problems that need an attacker who already controls the user's browser or device.
- Automated scanner output without a demonstrated impact.

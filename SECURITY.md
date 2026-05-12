# Security Policy

## Reporting a vulnerability

Report security or privacy issues privately to the EVNSolution maintainers. If GitHub private vulnerability reporting is enabled for this repository, use that channel. Otherwise, contact the repository owner or the project maintainer through the existing EVNSolution coordination channel before opening a public issue.

Do not post real driver phone numbers, customer addresses, route data, access tokens, proof media, signing files, or production secrets in public issues, pull requests, logs, or screenshots.

## Scope

Security review for this app includes:

- route context + phone access boundary
- tenant/company and assigned-driver authorization assumptions
- SecureStore driver access token handling
- location permission and foreground/background tracking behavior
- proof photo, signature, and barcode capture flows
- offline queue retry metadata and retention behavior
- environment variables, mobile signing files, and release artifacts

## Current supported branches

- `main`: deploy branch
- `dev`: integration branch
- active issue-linked `cc-<change-control>-<scope>` branches under review

## Data-handling expectations

- Driver access tokens must remain in native secure storage.
- `.env*` files, signing artifacts, generated binaries, and local runtime state must remain ignored.
- AsyncStorage queue payloads are not encrypted and must not become a secret store.
- Production proof-media storage, queue retention/discard thresholds, and store privacy disclosures remain release-gating work tracked in `docs/release-readiness.md`.

## Evidence handling

When sharing reproduction evidence, use synthetic route contexts, synthetic phone numbers, synthetic proof media, and redacted logs. If real production data is unavoidable for diagnosis, coordinate privately and keep the evidence out of git.

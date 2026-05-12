# Contributing to clever-driver-app

This repository is the driver-facing native mobile app for Clever/Tomatono delivery operations. Keep product scope in `docs/project-brief.md` and agent workflow rules in `AGENTS.md`.

## Branch and issue flow

1. Work from `dev` through a target issue in `EVNSolution/clever-driver-app`.
2. Link the target issue to the related `EVNSolution/clever-change-control` issue.
3. Use an issue-linked branch named `cc-<change-control-issue-number>-<short-scope>`.
4. Open PRs against `dev`; do not push directly to `main` or `dev` after branch protection is active.
5. Fill `.github/PULL_REQUEST_TEMPLATE.md`, including concurrent-work gate, validation evidence, and context/wiki completion.

## Local setup

```bash
nvm use
npm install
npm run start
```

Optional live API mode uses only public Expo runtime configuration:

```bash
EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL=https://delivery.example.com npm run start
```

Do not commit `.env*` files other than `.env.example`.

## Required checks before PR

```bash
npm run check:workspace
npm run lint
npm run typecheck
npm run test
npm run build
npm audit --audit-level=moderate
npx expo install --check
git diff --check
```

`npm run build` exports JavaScript bundles into ignored `dist/` folders. It is not an App Store or Play Store binary build.

## Privacy and safety review points

- Do not treat phone number alone as a global driver identity; route/company context is part of the access boundary.
- Do not display route, stop, customer, or proof data before the server-confirmed tenant/company and assigned-driver boundary is known.
- Keep driver access tokens in SecureStore-backed storage only; do not move secrets into AsyncStorage or logs.
- Treat AsyncStorage offline queue data as non-secret retry metadata plus file URI references.
- Any change to background location, proof media capture, storage, or retention must update `docs/release-readiness.md` and the PR context/wiki decision.

## Generated and sensitive files

Generated Expo/native outputs, signing artifacts, local env files, local runtime state, dependency folders, and build/test artifacts must stay untracked. Review `.gitignore` before adding native build tooling or release signing files.

## License

No public license has been selected for this repository yet. Do not add reuse or redistribution terms without an explicit owner decision.

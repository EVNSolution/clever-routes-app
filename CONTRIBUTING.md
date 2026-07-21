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

Live API mode uses only public Expo runtime configuration:

```bash
EXPO_PUBLIC_DRIVER_RUNTIME_MODE=live EXPO_PUBLIC_DELIVERY_SERVER_BASE_URL=https://delivery.example.com npm run start
```

Use `EXPO_PUBLIC_DRIVER_RUNTIME_MODE=mock` only for deliberate local fixture testing. Missing runtime configuration now stops startup instead of silently loading mock routes.

Do not commit `.env*` files other than `.env.example`. Keep source/docs/config files UTF-8/LF with final newlines as defined by `.editorconfig` and `.gitattributes`.

## Required checks before PR

```bash
npm run check:workspace
npm run lint
npm run typecheck
npm run test
npm run check:native-release
npm run build
npm audit --audit-level=moderate
npx expo install --check
git diff --check
```

`npm run build` exports JavaScript bundles into ignored `dist/` folders. It is not an App Store or Play Store binary build. `npm run check:native-release` is a local config preflight; it does not prove owner-controlled EAS project values, signing authority, store approval, privacy copy, or license decisions.

GitHub Actions CI runs the source-controlled PR/push validation subset from `.github/workflows/ci.yml`. A green CI run still does not replace EAS binary builds, store/private distribution approvals, privacy/legal review, or physical-device smoke evidence.

For release evidence approval, run `npm run release:evidence:verify -- <external-manifest-path>` against a local copy of the completed external manifest. Keep the completed manifest and binary evidence outside git.

## Privacy and safety review points

- Do not treat phone number alone as a global driver identity; route/company context is part of the access boundary.
- Do not display route, stop, customer, or proof data before the server-confirmed tenant/company and assigned-driver boundary is known.
- Keep driver access tokens in SecureStore-backed storage only; do not move secrets into AsyncStorage or logs.
- Treat AsyncStorage offline queue data as non-secret retry metadata plus file URI references.
- Any change to background location, proof media capture, storage, or retention must update `docs/release-readiness.md` and the PR context/wiki decision.
- Any change to `app.json`, `eas.json`, `.env.example`, native permission copy, bundle/package identity, or native build-profile settings must keep `npm run check:native-release` current.

## Generated and sensitive files

Generated Expo/native outputs, signing artifacts, local env files, local runtime state, dependency folders, and build/test artifacts must stay untracked. Review `.gitignore`, `.dockerignore`, `.gitattributes`, and `.editorconfig` before adding native build tooling, release signing files, or evidence workflows.

## License

No public license has been selected for this repository yet. Do not add reuse or redistribution terms without an explicit owner decision.

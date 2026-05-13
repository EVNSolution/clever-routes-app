# Driver App Structure Refactor Execution Record

## Goal

Move `clever-driver-app` from a flat `src/` layout into the documented folder-role index, remove non-product work folders, and keep behavior unchanged.

## Completed scope

- Root `App.tsx` is now a bootstrap-only re-export of `src/app/AppRoot.tsx`.
- Source files were moved from flat `src/` into `src/app`, `src/api`, `src/domain`, `src/platform`, `src/release`, and `src/ui` role folders.
- Module-level tests moved with their source files.
- Release scripts now point at `src/release/preflight/*` and `src/release/evidence/*`.
- The toast behavior helper and component were separated under `src/ui/components/` without changing the two-second, transparent Android-safe overlay behavior.
- The temporary `docs/superpowers/` work folder was removed; this execution record is stored in normal project docs under `docs/refactor/`.
- `src/release/preflight/sourceLayoutPreflight*` now guards against new production files being added directly under flat `src/`.

## Validation commands

Run before PR/merge:

```bash
npm run check:workspace
npm run lint
npm run typecheck
npm run build
git diff --check
```

Additional release-sensitive checks:

```bash
npm run check:native-release
npm run release:evidence:seed
```

## Non-goals

- No new driver workflow, API, or mobile-platform behavior is introduced by this refactor.
- Empty reserved folders such as `src/features/`, `src/shared/`, and `tests/integration/` are not committed until they contain real code or tests.

# clever-driver-app

Dedicated native mobile app repository for Clever delivery drivers.

## MVP direction

1. Driver accesses the app with route context plus phone number.
2. Driver confirms the company/shop/route guidance for the assigned work.
3. Driver accepts location-information and personal-information consent.
4. Driver views the route assigned for the current delivery day.

## Platform direction

- iOS and Android native mobile app.
- Expo/React Native is the selected bootstrap stack for the first implementation slice.
- PWA/web is not the primary driver MVP platform because location permissions, foreground/background services, security, and controlled distribution matter for this app.

## Repository boundaries

- `clever-delivery-server` is the source of truth for companies/shops, drivers, routes, orders, assignments, consent records, and location/compliance logs.
- This repository owns the driver-facing mobile UX, runtime, local verification, and mobile release evidence.
- Phone number alone must not be treated as a global driver identity; route/company context is part of the access boundary.

## Local setup

Recommended Node baseline is recorded in `.nvmrc` and matches the Expo SDK 54 minimum Node floor used by this bootstrap.

```bash
nvm use
npm install
npm run start
```

Native launch helpers:

```bash
npm run ios
npm run android
```

## Verification commands

```bash
npm run check:workspace
npm run lint
npm run typecheck
npm run test
npm run build
```

`npm run build` exports Android and iOS JavaScript bundles into ignored `dist/` folders. It is not an App Store/Play Store binary build.

## Documentation map

- `docs/project-brief.md` — product role, MVP scenarios, platform decision, and implementation sequencing.
- `docs/repository-setup.md` — repo baseline, scripts, ignore policy, and follow-up setup notes.
- `AGENTS.md` — agent workflow, issue/branch/PR rules, and verification requirements.

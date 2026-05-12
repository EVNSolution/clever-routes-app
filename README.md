# clever-driver-app

Dedicated mobile app repository for Clever delivery drivers.

Initial MVP direction:

1. Driver accesses with route context plus phone number.
2. Driver confirms the company/shop/route guidance for the assigned work.
3. Driver accepts location-information and personal-information consent.
4. Driver views the route assigned for the current delivery day.

Platform direction:

- iOS and Android native mobile app.
- Expo/React Native is the preferred framework candidate for the first bootstrap issue.
- PWA/web is not the primary driver MVP platform because location permissions, foreground/background services, security, and controlled distribution matter for this app.

Repository boundaries:

- `clever-delivery-server` is the source of truth for companies/shops, drivers, routes, orders, assignments, consent records, and location/compliance logs.
- This repository owns the driver-facing mobile UX, runtime, local verification, and mobile release evidence.
- Phone number alone must not be treated as a global driver identity; route/company context is part of the access boundary.

See `docs/project-brief.md` for product context and `AGENTS.md` for agent workflow rules.

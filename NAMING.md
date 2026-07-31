# Naming

This repository is the Shopify delivery mobile app.

Canonical values:

- Product/display name: `CLEVER Routes`
- GitHub repository/service/package name: `clever-routes-app`
- Expo slug: `clever-routes-app`
- iOS bundle identifier: `com.evnsolution.clever.routes`
- Android application ID: `com.evnsolution.clever.routes`
- URL scheme: `clever-routes`
- Target domain: Shopify delivery

Android releases before `1.0.5` used the legacy
`com.evns.cleverdriverapp` application ID. Because Android treats the canonical
ID as a different app, the `1.0.5` direct release requires users to install the
new app, sign in again, verify their routes, and then remove the legacy app.

Do not use future DSV app identifiers in this repository. The future DSV mobile app is reserved for:

- Product/display name: `CLEVER Driver`
- GitHub repository/service/package name: `clever-driver-app`
- App identifier: `com.evnsolution.clever.driver`
- Target domain: DSV delivery

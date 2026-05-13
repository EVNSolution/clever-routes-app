# Country-aware phone entry and SMS verification plan

## Purpose

This document plans the next driver-app phone entry and SMS verification slice before runtime implementation. The current driver app is phone-first, but not yet SMS-verified: it accepts a phone value in E.164 format, shows a verification-code field, and calls route access by phone. The next slice should separate the driver-facing national phone input from the app/server-owned E.164 identity and then add SMS OTP only through the backend.

## Current app state

- `src/app/AppRoot.tsx` owns the current login screen state: `phoneE164`, `verificationCode`, `driverName`, privacy consent, and location consent.
- `LoginScreen` currently renders one `Phone Number` input and one `Verification Code` input. `Send Code` is visible in the UI, but the current phone lookup path does not depend on SMS verification.
- `handleLoginAndLoadRoutes()` calls `submitRouteAccess({ phoneE164 }, routeAccessService)` after driver name and consent checks.
- `src/domain/driverFlow/driverFlow.ts` validates only E.164 with `E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/`.
- `src/domain/routeAccess/routeAccess.ts` sends `phoneE164` and `routeContext: null` to `POST /driver/route-access/lookup` in live mode.
- Successful route lookup returns route choices, company guidance, and a short-lived driver bearer token. SMS must not be implemented in the app with provider credentials.

## Target UX

### 1. Country selector

Add a country selector before the phone input.

Driver-facing behavior:

1. The app shows a selected country row with country name, ISO code, and dialing prefix, for example `South Korea · KR · +82`.
2. Tapping the country row opens a searchable country list.
3. Search matches country name, ISO code, and calling code.
4. The default country should be server/config-driven. Use Canada (`CA`, `+1`) for Canadian production routes unless an environment or server profile says otherwise. Device locale can be a hint, not the authority.
5. Store the selected country as data, not display text.

Planned state shape:

```ts
type SelectedPhoneCountry = {
  iso2: string;          // example: "KR"
  callingCode: string;   // example: "+82"
  displayName: string;   // localized display label
};
```

Initial supported countries should be allowlisted rather than global-by-default. For the current product, start with `CA` and add `KR` for operator/test workflows. A global list can be enabled after SMS cost controls and compliance checks are in place.

### 2. Country-aware phone input

Split phone entry into two values:

- `nationalPhoneInput`: what the driver types and sees.
- `phoneE164`: normalized identity sent to route access and SMS verification APIs.

Example for South Korea:

- selected country: `KR +82`
- typed digits: `01089216198`
- displayed national format: `010-8921-6198`
- normalized E.164: `+821089216198`

Example for Canada:

- selected country: `CA +1`
- typed digits: `4165550123`
- displayed national format: `(416) 555-0123` or `416-555-0123`
- normalized E.164: `+14165550123`

Implementation recommendation:

- Use a maintained phone-number library with country metadata, such as `libphonenumber-js`, for parsing, country-specific formatting, and E.164 normalization.
- Keep the current app/server contract as E.164. The UI may format per country, but API payloads should continue to send `phoneE164`.
- Do not rely on manual regex per country except as a fallback or smoke-test fixture. Country numbering plans change, and trunk-prefix rules differ by country.

Planned domain boundary:

```ts
type PhoneEntryDraft = {
  countryIso2: string;
  callingCode: string;
  nationalPhoneInput: string;
};

type PhoneEntryNormalizationResult =
  | {
      ok: true;
      displayNational: string;
      phoneE164: string;
    }
  | {
      ok: false;
      reason: 'country_required' | 'phone_required' | 'phone_invalid';
    };
```

Validation should happen before enabling `Send Code` or `Continue`. Error copy should avoid technical E.164 wording; use driver-facing text such as `Enter a valid mobile phone number for the selected country.`

### 3. SMS verification and OTP autofill

SMS sending must be server-side only.

Recommended server endpoints:

```http
POST /driver/auth/otp/start
Content-Type: application/json
```

```json
{
  "phoneE164": "+821089216198",
  "countryIso2": "KR",
  "purpose": "route_access"
}
```

```http
POST /driver/auth/otp/verify
Content-Type: application/json
```

```json
{
  "phoneE164": "+821089216198",
  "verificationId": "server-verification-id",
  "code": "123456",
  "purpose": "route_access"
}
```

The app should receive only safe verification state, never SMS provider credentials. The backend should own provider keys, OTP TTL, retry limits, fraud controls, audit logs, and provider-specific response mapping.

Client UX states:

1. Select country.
2. Enter national phone number.
3. Normalize and validate to E.164.
4. Enable `Send Code` only when valid.
5. Show resend cooldown after request.
6. Enable `Continue` after OTP verification succeeds, or use verified OTP to trigger phone route lookup.
7. If OTP is unavailable, show dispatch-support guidance without exposing route data.

OTP autofill plan:

- iOS: mark the code field as one-time-code compatible so the OS can suggest codes from SMS.
- Android: use React Native `TextInput` autocomplete values such as `sms-otp` / `one-time-code` where supported.
- Full Android SMS Retriever automation can be a later native slice because it requires an app hash in the SMS body and Google Play services integration. Do not request broad SMS-read permissions for this app.

## Cost and provider plan

Pricing changes frequently, so the values below are planning snapshots checked on 2026-05-13. Final launch cost must be rechecked from provider dashboards before production enablement.

### Option A: Twilio Verify

Use when speed, managed verification, built-in rate limiting, localization, managed number pool, and verification analytics are more important than the lowest raw SMS cost.

Planning cost model:

```text
monthly cost ≈ successful verifications × $0.05
             + SMS segments sent × destination SMS price
             + carrier fees / number fees / compliance fees where applicable
```

Current reference points:

- Twilio Verify: `$0.05` per successful verification plus channel fees.
- Twilio Canada SMS: long code outbound `$0.0083` per segment, with additional carrier fees currently shown around `$0.0064` to `$0.0087` per outbound segment depending on carrier.
- Twilio South Korea SMS: international outbound SMS shown as `$0.0524` per segment.
- Twilio South Korea compliance note: two-way SMS is not supported, long messages can be split, and messages may be marked as web/international-originated according to local rules.

Rough one-SMS successful verification examples:

| Destination | Approximate cost per successful OTP |
| --- | ---: |
| Canada via long code | about `$0.0647` to `$0.0670` plus number/compliance fees |
| South Korea | about `$0.1024` plus any applicable provider/compliance fees |

### Option B: AWS End User Messaging OTP

Use when AWS integration, lower per-OTP pricing in supported countries, and AWS-side carrier lookup are attractive.

Planning cost model:

```text
monthly cost ≈ successful OTP verifications × $0.045
             + SMS messages sent × destination SMS price
             + optional phone-number validation requests × $0.006
             + origination identity / compliance fees where applicable
```

Current reference points:

- AWS OTP: `$0.045` per successful OTP verification in addition to SMS message price.
- AWS Phone Number Validate: `$0.006` per request, optional for pre-send carrier/type checks.
- AWS official SMS price CSV currently lists Canada long code `$0.007` plus Canada long-code carrier fee `$0.00767`; South Korea all number types `$0.02414`.

Rough one-SMS successful OTP examples:

| Destination | Approximate cost per successful OTP |
| --- | ---: |
| Canada | about `$0.05967` before optional validation and other fees |
| South Korea | about `$0.06914` before optional validation and other fees |

### Option C: Raw SMS + self-managed OTP

Use only if the team needs lower direct provider fees and is ready to own security and abuse prevention.

Benefits:

- No managed verification fee.
- Full control over OTP text, TTL, resend, and verification workflow.

Costs/risks:

- Server must generate codes securely, hash/store them, expire them, limit attempts, prevent SMS pumping, protect against enumeration, provide audit logs, and map provider delivery errors safely.
- More engineering and security review are required before production.

Recommendation: do not use raw SMS for the first production OTP slice. Start with a managed OTP product, then revisit raw SMS only after real traffic and abuse patterns are understood.

## Recommended phased plan

### Phase 1: Phone UX foundation, no SMS provider

- Add country selector/search UI.
- Add phone normalization domain module and tests.
- Convert national input + country to E.164 before calling existing route access.
- Keep current phone-only route lookup behavior.
- Add UI tests for KR and CA formatting examples.

### Phase 2: Server-owned OTP verification

- Add delivery-server OTP start/verify endpoints.
- Add provider abstraction on the server.
- Start with Twilio Verify or AWS OTP behind a server feature flag.
- Add rate limits: per phone, per device, per IP, and per company/tenant.
- Add budget controls: country allowlist, daily send cap, and admin-visible send counts.
- Add driver-facing resend cooldown and verification error states.

### Phase 3: OTP autofill and production hardening

- Add `TextInput` OTP autofill hints for iOS and Android.
- Evaluate Android SMS Retriever only after native build implications are confirmed.
- Add provider delivery metrics, fraud/pumping alerts, and country-level disable switches.
- Finalize privacy disclosure copy for phone verification SMS.

## Open decisions

- Default country source: deployment config, server profile, or device locale fallback.
- Initial supported countries: likely `CA` for production and `KR` for operator/testing.
- OTP provider: Twilio Verify for fastest integration, AWS OTP for AWS consolidation and lower estimated KR cost, or another provider after procurement review.
- Whether OTP gates every route lookup or only first device/session verification.
- Whether the backend should return route choices immediately after OTP verification or require a separate route lookup call.

## Source references checked on 2026-05-13

- Twilio Verify pricing: https://www.twilio.com/en-us/verify/pricing
- Twilio Canada SMS pricing: https://www.twilio.com/en-us/sms/pricing/ca
- Twilio South Korea SMS pricing: https://www.twilio.com/en-us/sms/pricing/kr
- Twilio South Korea SMS guidelines: https://www.twilio.com/en-us/guidelines/kr/sms
- AWS End User Messaging pricing: https://aws.amazon.com/end-user-messaging/pricing/
- AWS SMS pricing CSV linked from the AWS pricing page: https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/business-applications/approved/documents/AWS_SMS_Prices.25fbab66d26aebe1e3d94f29d981f4b3f6008726.csv
- React Native TextInput docs: https://reactnative.dev/docs/textinput
- Android SMS Retriever overview: https://developers.google.com/identity/sms-retriever/overview
- Apple one-time-code text content type: https://developer.apple.com/documentation/uikit/uitextcontenttypeonetimecode

# Build a Play AAB with GitHub Actions

The `Android Release AAB` workflow builds the committed Android project on a
GitHub runner. It uses the existing Routes Play upload key, without an Expo token
or an EAS build request. It does not submit to Play or publish to Drive.

## Source and version

Use `dev` or `main`. The workflow must also exist on the default branch (`main`)
for manual dispatch. Registering workflow files on `main` does not promote the
app changes from `dev`; select the intended source explicitly.

Before each run, inspect the latest Play/EAS/Actions build numbers and any active
builds. Reserve an unused, greater `versionCode` in EAS with
`eas build:version:set -p android --profile production`, then pass that same value
to Actions. Verify the remote value with `eas build:version:get`. EAS and Actions
do not share an automatic allocator. Do not allocate concurrently or reuse a
number already submitted to Play. A failed build keeps its reservation until
the operator determines whether retrying the same number is safe.

```bash
gh workflow run android-release-aab.yml \
  --repo EVNSolution/clever-routes-app --ref dev \
  -f version_code=<reserved-number> -f profile=production-kfood-on
```

`versionName` comes from the selected source. The workflow verifies it against
`app.json`. Only this Gradle invocation overrides the native versionCode and
release signing configuration. Existing APK signing and source version files
remain unchanged.

## Runtime and native settings

Select `production-kfood-on` to preserve the K-food completion flag used by the
latest release candidate, or `production` for that flag off. Both profiles use
live mode and `https://clever-route.cleversystem.ai`. Dotenv loading is disabled,
and Metro gets a fresh temporary directory for each run.

The committed `android/` directory is built without Expo prebuild. ARMv7 and
ARM64 are included. Minification, resource shrinking, legacy packaging, Hermes,
SQLCipher and ProGuard rules keep their committed EAS production settings;
the separate direct-install APK optimization flags are not copied into AAB builds.
Gradle uses two workers, a 3 GiB JVM heap and a 1 GiB metaspace limit. These limits
are not a total runner memory limit. Gradle caches are reused.

## Signing configuration

Environment `android-release` contains:

- `GOOGLE_SERVICES_JSON_B64`
- `ANDROID_UPLOAD_KEYSTORE_B64`
- `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
- `ANDROID_UPLOAD_KEY_ALIAS`
- `ANDROID_UPLOAD_KEY_PASSWORD`

Download the existing key using the official
[EAS credentials sync procedure](https://docs.expo.dev/app-signing/syncing-credentials/).
Use the credentials.json download action. Never generate a replacement key for
this migration, commit credentials, or print passwords. The expected upload
certificate SHA-256 is
`55c14543e167a55efe4f0153c9fee0e52d2fd3ae567a255356c40aee8893ee48`.
This differs from both the Play app-signing certificate and the direct-install
APK debug certificate. Temporary signing and Firebase files are removed even
when the job fails.

## Evidence and completion

Before uploading an artifact, the workflow checks bundletool validation, JAR
signature integrity, the upload certificate, the AAB's actual package/version,
non-debuggable application, both ARM ABIs, and the embedded production endpoint.
Bundletool 1.18.3 is pinned by its published SHA-256. Verification failures prevent
the AAB upload. The checks do not prove physical-device behavior or Play acceptance.

The AAB and non-secret verification JSON files are separate Actions artifacts,
retained for seven days. The job summary records source SHA, profile, version,
certificate and AAB SHA-256. Download required release evidence before expiry.
Play submission and device checks remain separate release steps. Existing EAS
profiles remain available as a fallback; check the shared version reservation
before returning to EAS.

Local verifier regression check: `python3 scripts/test-verify-play-aab.py`.

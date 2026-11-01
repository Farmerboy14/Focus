# Focus (Android)

Caleb's schedule launcher for his Pixel 10 Pro: day blocks anchored to wake time, presets that allow/block apps,
an accessibility service that shows "Not now", Time with God, a KJV Bible, and an encrypted prayer journal.

## Build
- No Gradle or AndroidX (Google's Maven is unreachable from the cloud). Plain Java 8 syntax, **no lambdas**,
  framework APIs only. Tools: `apt-get install aapt apksigner zipalign dalvik-exchange`.
- `./build.sh` builds `build/Focus.apk`. It downloads `tools/android.jar` (API 34) if missing.
- Signing key: `tools/focus.keystore` (gitignored). The base64 copy lives in the claude.ai Project doc
  `claude/focus-signing-key.txt`. Every release MUST use this key or it won't install over the existing app.

## Release (the phone updates itself)
- `./release.sh <versionCode> <versionName> "<note>"` writes `release/Focus.apk` and `release/version.json`.
  Commit and push to `main`; Focus checks `release/version.json` and offers an Update banner.
- Always bump versionCode.

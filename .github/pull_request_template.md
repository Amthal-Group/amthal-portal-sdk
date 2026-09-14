## What this changes

<!-- What it does and what it fixes. Link the issue if there is one. -->

## How it was verified

<!--
Which platform, which portal version, what you actually exercised.
"iOS 18 simulator against a 1.8 portal — submit and cancel both round-trip" beats
"tested locally".
-->

- [ ] `npm run build && npm run typecheck` pass
- [ ] iOS SDK still builds (`xcodebuild -scheme AmthalPortal -destination 'generic/platform=iOS' build`), if touched
- [ ] Android SDK still builds (`cd android && ./gradlew :portal-sdk:assembleRelease`), if touched

## Compatibility

- [ ] No breaking change to anything exported from the packages or the native public types
- [ ] `bridge/SPEC.md` updated in this PR, if a message shape changed
- [ ] Existing integrations built against the previous release still work unchanged

# Contributing

Thanks for looking. This SDK is developed by Amthal Group and used in production by our
customers' apps, so the bar for a change is "it keeps every existing integration working".

## Before you open a pull request

**Issues first for anything non-trivial.** A bug report with a reproduction, or a short issue
describing the behaviour you want, saves you writing code we then have to ask you to change.
Typos, docs fixes and obvious one-liners can go straight to a PR.

**The bridge protocol is a contract, not an implementation detail.** `bridge/SPEC.md` is
normative: the portal web app, the iOS SDK, the Android SDK and both wrappers all encode it
independently. A change to a message shape needs the spec updated in the same PR, and needs to
stay backward compatible — hosts and portals are deployed separately and a v1 message must keep
meaning what it meant. New optional fields are fine; renamed or removed ones are not.

**Do not break the public surface.** Anything exported from `bridge/src/index.ts`,
`wrappers/react-native/src/index.ts`, `wrappers/expo/src/index.ts`, the `AmthalPortal*` Swift
types or the `com.amthalgroup.portal` Kotlin types is API. Additive changes only, unless we have
agreed a major version with you on the issue.

## Layout

| Path | What it is |
|---|---|
| `bridge/` | `@amthal-group/portal-bridge` — the protocol types, message builders and the mock host |
| `ios/` | The Swift SDK (SwiftPM package, also consumed as an XCFramework) |
| `android/` | The Kotlin SDK (Gradle library module) |
| `wrappers/react-native/` | `@amthal-group/portal-react-native` — inline WebView component |
| `wrappers/expo/` | `@amthal-group/portal-expo` — native modal sheet via the iOS SDK |
| `demos/react-native-example/` | A runnable integration you can point at your own portal |
| `docs/` | The documentation site |

## Working on it

```bash
npm install            # root, npm workspaces
npm run build          # bridge, then both wrappers
npm run typecheck      # all three packages
```

The wrappers depend on the bridge through the workspace, so build the bridge before building an
app that consumes them.

Both native SDKs must compile on their own — they are shipped to customers who use neither
wrapper.

```bash
# iOS. NOT `swift build`: the package imports UIKit, so it has to be built for an iOS
# destination, and swift build targets the host (macOS) and fails on "no such module 'UIKit'".
xcodebuild -scheme AmthalPortal -destination 'generic/platform=iOS' build

# Android. Needs JDK 17 (AGP 8.7 refuses to run on 11) and an Android SDK, via ANDROID_HOME
# or sdk.dir in android/local.properties.
cd android && ./gradlew :portal-sdk:assembleRelease
```

## Style

- Match the file you are editing. There is no formatter to appease and no house style beyond
  that.
- Comments explain what the code cannot say itself — a protocol rule, a platform quirk, a
  deliberate-looking-wrong line. Not a narration of the next statement.
- TypeScript: no `any` on anything exported. Swift and Kotlin: keep the public API documented,
  since it shows up in customers' IDEs.

## What a PR should say

What the change does, what it fixes, and how you verified it — on which platform, against which
portal version. "Tested on the iOS simulator against a 1.4 portal, form submit and cancel both
round-trip" tells us more than a description of the diff.

## Licence

Contributions are accepted under the MIT licence in `LICENSE`.

# @amthal-group/portal-bridge

The wire contract between the Amthal Client Portal running in a WebView and whatever native host
is embedding it. Shared by the iOS SDK, the Android SDK, both React Native wrappers and the
portal's own web runtime — four independent implementations of one protocol, which is why the
protocol has a spec rather than a reference implementation.

**[`SPEC.md`](SPEC.md) is normative.** This package is its TypeScript expression; where the two
disagree, the spec wins.

You generally do not install this directly — `@amthal-group/portal-react-native` and
`@amthal-group/portal-expo` depend on it. Install it yourself when you are writing a host of
your own, or testing against one.

```bash
npm install @amthal-group/portal-bridge
```

## What is in it

| Export | Use |
|---|---|
| `BRIDGE_PROTOCOL_VERSION`, `MANIFEST_PATH`, `TIMINGS` | The constants the handshake is built from |
| Message and payload types | `InitPayload`, `AuthPayload`, `FormSubmittedPayload`, `PortalErrorInfo`, … |
| Envelope helpers | Build and parse the `{v, type, id, payload}` frames both sides exchange |
| `MockNativeHost` | A scriptable host for driving the web side in tests |
| Web-side helpers | For a page that needs to speak the protocol without the portal's own runtime |

Everything is exported from the package root; there are no subpath entry points.

## Versioning

`BRIDGE_PROTOCOL_VERSION` is `1`. Additive changes — a new optional payload field, a new message type —
stay within version 1, because both sides ignore what they do not recognise. A change to the
meaning or shape of an existing field bumps the version, and portal and SDKs each support
`{N, N−1}` for one release cycle so they can be deployed independently.

The package version tracks the SDK release, not the protocol version.

## Conformance

An implementation is conformant when it passes the scripted sequences described in `SPEC.md` §7:
the handshake happy path, hello-retry, auth-expiry round-trip, both back-press answers, both
dismiss-guard answers, destroy teardown, unknown-type ignore, wrong-`v` ignore, and
origin-violation drop.

MIT — see the [repository](https://github.com/Amthal-Group/amthal-portal-sdk).

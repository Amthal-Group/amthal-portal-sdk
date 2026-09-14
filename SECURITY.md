# Security policy

## Reporting a vulnerability

Please report security issues privately. Do **not** open a public GitHub issue.

Email **security@amthalgroup.com** with:

- what you found and where (file, endpoint, or message type),
- how to reproduce it,
- what an attacker could achieve,
- the SDK version and platform you tested.

We aim to acknowledge within two business days and to agree a disclosure timeline with you
before anything is published.

## Scope

In scope: this repository — the bridge protocol, the iOS and Android SDKs, and the React
Native and Expo wrappers.

Out of scope: the Amthal Client Portal deployment itself and the Optimum API behind it. Those
are operated per tenant; report issues with them through your usual Amthal support contact,
which will reach the same team.

## What this SDK does with credentials

Worth knowing when assessing it:

- The host app supplies a bearer token. It travels to the web layer **only** over the bridge
  (`init` / `auth` messages) and is never placed in a URL, a query string, or a navigation.
- Main-frame navigation is confined to the configured origin plus the portal's `/embed`
  subtree. Anything else is cancelled and handed back to the host.
- Every inbound bridge message and every native-to-web evaluation checks the WebView's current
  origin against the allowlist.
- Bridge diagnostics are dropped entirely in release builds.
- `destroy()` asks the web layer to clear its persisted auth, then clears WebView storage and
  cookies on a best-effort basis.

## Supported versions

Security fixes land on the latest minor release. If you are pinned to an older one, tell us in
your report and we will advise on the upgrade path.

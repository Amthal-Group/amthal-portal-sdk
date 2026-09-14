# Support

## Which door to knock on

**Something in this SDK is wrong** — a crash, a message that never arrives, an API that does not
do what the README says, a build that fails: [open an issue](../../issues). Include the SDK
version, the platform and version you are on, which wrapper (or none), and what you saw versus
what you expected. A snippet of your `config` object with the token removed is usually the
fastest thing you can give us.

**Your portal is not set up yet** — `/embed` returns 404, `GET <portalBaseUrl>/embed/manifest.json`
does not answer JSON, your branch shows no forms, or you do not have a portal URL at all: that
is a deployment question, not an SDK one. Contact Amthal Group through your account manager or
**support@amthalgroup.com**. Nothing in this repository can fix it, and the SDK will keep
reporting `portal_unreachable` or `version_mismatch` until it is done.

**A security issue**: see [SECURITY.md](SECURITY.md). Do not open a public issue.

## Before you file

Two checks answer most reports:

```bash
# 1. Is the portal there, and is it the embed build?
curl -i "<portalBaseUrl>/embed/manifest.json"
# → 200, content-type: application/json, {"portalVersion":…,"bridgeProtocolVersion":1,…}

# 2. Is the URL the one the SDK wants?
# It is the portal's ORIGIN plus its base path — the path the portal is deployed under,
# not the /embed route itself. See "Configure your portal URL" in the README.
```

If the first returns HTML, you are pointed at the portal's shell rather than its embed runtime.
If it 404s, the portal has not been built with embed support and Amthal needs to deploy it.

The README's [Troubleshooting](README.md#-troubleshooting) table covers the rest of the common
ones — blank WebView, `ready` never fires, downloads that do nothing, forms that submit but
whose callback never runs.

## What we answer

Issues about the SDK itself, the bridge protocol, and the documented integration paths.

We cannot debug your app's own architecture, your token-issuing backend, or your portal's form
definitions through this repository — those go to your Amthal support contact, who has access to
your tenant.

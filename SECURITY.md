# Security policy

## The live-code trust boundary

p5js live evaluates JavaScript with `new Function`. This is intentional and makes live
replacement possible, but it means p5js live is not a sandbox:

- evaluated code can access browser globals and same-origin data;
- an infinite loop can freeze the tab;
- a patch can allocate excessive memory or GPU resources;
- imported projects have the same privileges as locally written code.

Run projects and patches only when you trust their source. Review imported source
before evaluating it. Do not use p5js live to execute untrusted code from a public room
or automated feed.

## AI API keys

The optional AI source editor uses a performer-supplied OpenAI API key. Requests go
directly from the browser to OpenAI; the p5js.live Worker does not proxy or store the
key. Session-only storage is the default. Enabling **remember on this device** stores
the key in browser storage, where anyone with access to that browser profile—and code
running in the page—may be able to read it. Use a restricted, revocable key and do not
enable persistent storage on a shared computer.

AI-generated source is untrusted code. Review the staged diff before accepting it.
Keys are not included in project saves, exports, or diagnostic messages.

## Supported version

Security fixes target the current `main` branch. Older snapshots may not receive
updates.

## Networked visual streams

Networking shares rendered video, not project source. Publication is explicit and the
included signaling service validates room membership before routing messages. A
deployment may set `P5JS_LIVE_NETWORK_TOKEN` for a shared room credential; public or
multi-tenant deployments should add stronger identity, authorization, rate limiting,
and monitoring at their edge. A `StreamRoom` token lives in editable project source
and exports, so it must be a disposable room invite rather than a durable secret.
WebRTC media is peer-to-peer when possible but may pass
through a configured TURN relay. See [docs/NETWORKING.md](docs/NETWORKING.md) for the
full trust and deployment boundary.

## Reporting a vulnerability

Use GitHub's private vulnerability-reporting or Security Advisory feature for this
repository. Include reproduction steps, affected browser/version, expected impact,
and any suggested mitigation. Do not include exploit details in a public issue before
a fix or disclosure plan is available.

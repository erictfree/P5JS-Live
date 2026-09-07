# Documentation

p5js live uses JavaScript patches, arrays for composition, and array methods for
effects. A named array's `.draw()` command selects the scene the host renders every
frame.

## Learn and perform

| Start here | What you will learn |
| --- | --- |
| [Quickstart](GUIDE.md) | Run the starter, edit a patch, combine two sketches, save, and recover. |
| [Data model](DATA-MODEL.md) | What patches, arrays, effects, and the active scene mean. |
| [Composition cookbook](COMPOSITION.md) | Group and nest sketches, chain shaders, pass configuration, and try Layer Lab. |
| [User manual](USER-MANUAL.md) | A progressive course through audio, JavaScript, controls, MIDI, and performance. |
| [API reference](API.md) | Exact context fields, lifecycle, commands, and shader operators. |
| [Community patches](../community-patches/README.md) | Package and contribute a patch. |

The quickstart and the cookbook's first example are complete programs: they run in
a fresh project without sound or Library installs. Later cookbook examples replace
the indicated cell and reuse those definitions. Reference snippets illustrate a
specific operation and may require patches defined earlier or installed from the
Library; they are not additional complete programs to paste into one buffer.

## Develop the instrument

| Document | Purpose |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | Setup, tests, and contribution expectations. |
| [Architecture](ARCHITECTURE.md) | Evaluation, rendering, identity, persistence, and UI boundaries. |
| [Render groups](NESTED-RENDER-GROUPS.md) | Offscreen targets, nesting, and occurrence state. |
| [Product](PRODUCT.md) | Purpose, scope, and design principles. |
| [Networking beta](NETWORKING.md) | Experimental source API and local two-browser test; the Network tab is unavailable. |
| [Security](../SECURITY.md) | Trusted-code boundary and vulnerability reporting. |

## Proposed work

- [Tempo, detected hits, and visual motion](TEMPO-BEAT-PLAN.md) — a reactive-first
  plan for optional tap tempo, automatic tracking, and visual signal helpers: LFOs,
  envelopes, ramps, sequences, range mapping, and seeded variation; not implemented.

## Review records

These record decisions and checks at a point in time. Use the guides and API above
for current behavior.

- [Code health review, September 2026](CODE-HEALTH.md)
- [Interface usability plan](INTERFACE-USABILITY-PLAN.md)
- [Tools implementation review](TOOLS-IMPLEMENTATION.md)
- [Visual design history](DESIGN_HISTORY.md)
- [Deferred library ideas](DEFERRED_LIBRARY_IDEAS.md)

## Keeping docs current

When changing an authoring API, update the data model, API reference, starter, and
affected cookbook examples together. When changing the interface, check the manual's
panel names, keyboard reference, and step-by-step instructions against the interface.
Keep detailed contracts in the API reference and link to them from shorter guides.
The browser documentation tests read the runnable examples directly from Markdown.

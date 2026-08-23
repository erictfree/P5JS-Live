# p5js live architecture

The host owns p5 `setup()` and `draw()`. Live code supplies functions and objects for
the host to call. Replacing a patch does not recreate the canvas, clock, audio graph,
network manager, or unrelated state.

## Modules

```text
src/main.js                 p5 setup/draw and application wiring
src/app/controller.js       snapshots and actions between runtime and views
src/host/registry.js        patch values, instances, scenes, and history
src/host/stateStore.js      per-instance state and restoration
src/host/liveApi.js         live commands and validation
src/host/evaluator.js       binding capture and atomic staging
src/host/hostLoop.js        lifecycle calls, frame boundaries, and rollback
src/shaders/shaderChain.js  single-input GPU operator compiler and patch
src/language/sourceBlocks.js statement and // %% cell discovery
src/audio/                  audio graph and feature processing
src/network/                StreamRoom objects and WebRTC client manager
src/ui/                     editors, read-only views, and projection
src/persistence/            schema-versioned source and settings storage
starter/                    starter project and built-in patch library
community-patches/          one source file per community patch
src/generated/              generated community catalog
scripts/signaling-server.mjs discovery and WebRTC signaling
```

Host and audio feature modules do not depend on DOM or p5, so identity, rollback,
state, and analysis run in Node unit tests.

`scripts/build-patch-library.mjs` validates metadata in `community-patches/*.js` and
generates a browser module containing metadata and source text. It does not execute
patches. Do not edit the generated catalog directly.

The Library groups patches by metadata. Its states are independent: **Available** is
in the catalog, **Installed** has source in the project, **Active** is in the current
scene, and **Running** completed a draw.

## Frame execution

```js
window.draw = function draw() {
  const snapshot = audio.readFrame();
  const drawInputs = host.beginFrame(snapshot);

  for (const patch of registry.activeStrategies()) {
    host.drawStrategy(patch, drawInputs);
  }

  host.commitPendingChanges();
};
```

Each scene entry is a stable registry instance. Lifecycle delegates resolve the
current implementation on every call. Object methods use
`method.apply(implementation, args)`; functions are called directly. Therefore:

- the original function, object, or class instance is retained;
- `this`, prototypes, getters, and private fields work normally;
- replacing code does not replace the scene slot;
- scene copies share code but keep separate state.

## Binding discovery

The evaluator scans top-level statements or explicit `// %%` cells, executes them in
a staging environment, and captures declarations.

- An object with `draw()` is a patch.
- A function becomes a patch when a scene uses it.
- An inline value receives an identity such as `scene[1]`.
- An array containing only patch values is a scene.
- Other functions, classes, arrays, and values remain ordinary bindings.
- `activate`, `reset`, and `param` are the injected live commands.

Bindings persist between evaluations, so a later array contains the actual values
declared earlier. `activate(scene)` receives the array itself; no string registry is
exposed to live code.

A `// %%` cell updates its class or factory and constructed patch together. Before a
full-buffer evaluation, duplicate named patch cells are collapsed to the newest
source at the original position. This avoids duplicate `class` or `const`
declarations after accidental installation.

## Atomic replacement

Evaluation is transactional:

| Phase | Work | Failure result |
| --- | --- | --- |
| Compile | Build a function from selected source | No change |
| Execute | Capture declarations and commands in staging | No change |
| Validate | Check patches, scenes, and command targets | No change |
| Snapshot | Clone affected instance state | Warn if unclonable |
| Queue | Wait for the frame boundary | No mid-frame change |
| Candidate | Draw every active copy once | Roll back on error |
| Confirm | Record the successful version | Candidate becomes live |

A replacement queued during frame N is installed after N, first draws in N+1, and is
confirmed after N+1. A shared implementation is confirmed only after every active
copy succeeds.

Rollback restores the implementation, JavaScript binding or inline slot, version
record, and clone-compatible state. If a new scene fails its first draw, the previous
scene and order remain active.

After confirmation, the host calls `dispose()` on the replaced implementation. After
rollback, it disposes the rejected implementation. Reset and import dispose current
implementations before clearing the registry.

## Identity, copies, and state

A named binding is a stable patch identity. An anonymous entry uses its zero-based
scene position. Moving an anonymous entry gives it a new identity.

| Shared by copies | Per copy |
| --- | --- |
| implementation, version, source, history | instance id, state, lifecycle membership |

The first copy uses the base identity; later copies use `name#2`, `name#3`, and so on.
`stateStore` maps each instance ID to its state object. `state()` runs once per
instance. Re-evaluation keeps state; `reset(patch)` recreates it.

Configuration stays in JavaScript: closures for functions, properties for objects,
and constructor arguments for classes. There is no second scene-configuration
language.

Evaluating a scene array is the only write path for membership and order. The scene
strip is read-only. Library actions edit visible source; the performer evaluates that
source before it changes the runtime.

## Runtime, controller, and views

The registry, evaluator, host loop, audio engine, network manager, and diagnostics are
the runtime model. `src/app/controller.js` exposes data-only snapshots and named
actions. `src/ui` receives the controller, not the registry or evaluator. `main.js`
adapts browser events, p5 callbacks, source insertion, import/export, and transport.

The patch reference drawer reads property descriptors through the controller. It does
not pass live patch objects to the DOM or invoke getters. **Jump to source** navigates
the editor; it does not change runtime state.

## Audio

`audioEngine` owns one `p5.Amplitude` and one `p5.FFT`. It computes one snapshot per
frame for all patches. Normalized values use decaying-peak auto-gain with headroom.
Spectral bands share a ceiling so their relative balance remains visible. Onset
detection uses raw band energy.

Audio starts only after a user gesture. With no source, the host supplies silence.

## Persistence and Safe State

Project schema 6 stores source, the safe-scene preference, and live parameter values.
Portable exports additionally include every named performance, each with its own
source, parameters, audio-analysis settings, and view settings. Import evaluates the
working source first, then merges valid performances by identity without deleting
unrelated browser-local saves. Project files do not store compiled functions, audio
files, or derived scene membership. Reload evaluates source through the normal
validation path. Older registration-model schemas are not read.

Safe State also captures installed implementations, version history, evaluator
bindings, active scene and order, parameters, and clone-compatible instance state.
The first successful starter or saved scene becomes the initial checkpoint. **Set
safe** replaces it only after success. Restore reports state it could not clone.

## Networking

The host-level `networkManager` owns WebSocket discovery, WebRTC peers, canvas capture
tracks, remote media, and reconnect. Publisher and receiver patches hold lightweight
handles, so patch evaluation does not restart unrelated streams.

The signaling service carries room presence, stream advertisements, offers, answers,
and ICE candidates. Video is peer-to-peer when possible and uses a configured TURN
relay otherwise. Network handles are not cloneable state; projects and Safe State
store only source configuration.

The included server supports small peer meshes. It does not carry video. See
[NETWORKING.md](NETWORKING.md) for the API, deployment, and limits.

## Trust and performance

`new Function` is not a sandbox. Evaluated code can access browser globals, exhaust
resources, or freeze the tab. p5js live is for trusted source.

The draw path reuses its input object, FPS ring, and analyzer snapshot. Diagnostics
and history are bounded. Panels update on model changes or a slow timer rather than
every frame. `pixelDensity(1)` avoids high-DPI fill costs.

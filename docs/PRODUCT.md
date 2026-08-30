# Product direction

p5js live is a browser-based instrument for live-coding audio-reactive graphics with
JavaScript and p5.js. It was created by Eric Freeman at the
[Department of Arts and Entertainment Technologies](https://aet.utexas.edu/) at The
University of Texas at Austin.

## Promise

A performer can replace visual logic without restarting the canvas, audio, clock, or
unrelated patches. Failed code does not replace the last working composition.

## Principles

### Keep the host alive

p5js live keeps the canvas, clock, audio analysis, and performance infrastructure
running. Live code supplies replaceable patches and scene arrays.

### Keep composition in source

The scene is a visible JavaScript array. Nested arrays express isolated effect groups.
Interface actions edit that source instead of maintaining a hidden graph.

### Replace small units

Functions, objects, class instances, and scenes evaluate independently.

### Confirm before replacing

Candidate code must compile, validate, and complete its first draw. Failure restores
the previous implementation and compatible state.

### Give state an identity

Code can change while patch-instance state persists. Repeated scene entries have
independent state.

### Share one audio analysis

One analyzer produces the snapshot used by every patch.

### Use JavaScript and p5 directly

p5js live adds lifecycle and live context without replacing familiar drawing commands
with a proprietary language.

### Separate performer and audience views

Tools and diagnostics stay with the performer. The audience sees the canvas and,
optionally, selected code.

### Share pixels, not editors

Performers keep independent code and publish selected rendered output. A remote stream
can be drawn, composited, fed back, or used as a shader texture.

## Current scope

- File, microphone, and line-input audio analysis
- Function, object, class-instance, factory, closure, and inline patches
- Recursive ordered scenes with isolated effect groups and independent state per occurrence
- Transactional evaluation, version history, first-frame rollback, and Safe State
- Built-in and community patch catalogs that install editable source
- Standard `ShaderChain` GPU effects with wet/dry mix, blend modes, feedback, and
  custom WebGL patches
- Beta small-room WebRTC publisher and receiver objects with room discovery
- Folded and complete editors, projected code, named performances, and project files
- Local operation with vendored p5.js and p5.sound

## Limits

- Evaluated JavaScript is trusted code, not a sandbox.
- Local use needs no account and does not start networking.
- Peer-mesh networking is for small rooms. Production use needs STUN/TURN; larger
  audiences need an SFU.
- OSC, recording/replay, isolated worker execution, and fluent multi-source shader
  routing are not implemented. Direct Web MIDI control is available in supporting
  browsers through declared live controls.

See [NETWORKING.md](NETWORKING.md) for network deployment and security boundaries.

## Release criteria

A release must:

- keep audio and rendering alive through repeated patch and scene replacement;
- recover from syntax, evaluation, and first-frame failures;
- start locally without runtime network dependencies after installation;
- remain usable at a 1280×720 performance viewport.

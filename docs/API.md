# p5js live API

p5js live code is JavaScript. The host owns p5 `setup()` and `draw()`; live code
provides patches and scene arrays.

## Patch states

- **Available:** listed in the Library.
- **Installed:** source is in the project.
- **Active:** an evaluated scene contains the patch.
- **Running:** the active patch rendered successfully.

**Install source** does not activate a patch. **Add to scene** edits the scene array;
evaluate that scene to activate the change.

## Patch forms

### Function

```js
const waveScope = ({ audio }) => {
  beginShape();
  audio.waveform.forEach((sample, index) => vertex(index, sample * 100));
  endShape();
};
```

### Object

```js
const laserFan = {
  beams: 13,

  addBeams(amount) {
    this.beams += amount;
  },

  draw({ audio }) {
    for (let i = 0; i < this.beams; i += 1) {
      line(width / 2, height, i * 50, audio.treble * height);
    }
  },
};

laserFan.addBeams(2);
```

### Class instance

```js
// %% patch neonTunnel
class NeonTunnel {
  constructor({ rings = 16, sides = 6 } = {}) {
    this.rings = rings;
    this.sides = sides;
  }

  draw({ audio, time }) {
    // draw with this.rings and this.sides
  }
}

const neonTunnel = new NeonTunnel({ rings: 20, sides: 8 });
```

p5js live retains the exact value. Prototypes, private fields, getters, helper methods,
and `this` behave normally. Object methods are called as
`patch.draw(drawInputs)`. Do not use an arrow method when it needs `this`.

## Draw inputs

`draw({ audio, time })` is a normal parameter using object destructuring. p5js live
supplies the object on each frame.

| Field | Meaning |
| --- | --- |
| `audio` | Shared audio analysis for this draw |
| `canvas` | Main p5 renderer; usable as a shader texture source |
| `state` | Persistent data for this scene occurrence |
| `dt` | Seconds since the previous draw, bounded after stalls |
| `time` | Seconds since the host started |
| `sceneTime` | Seconds since the active scene changed |
| `params` | Values declared with `param()` |
| `controls` | Read-only keyboard state |

A patch may ignore the input:

```js
const dot = {
  draw() {
    circle(100, 100, 20);
  },
};
```

p5 globals such as `fill`, `circle`, `noise`, `map`, `width`, and `height` remain
available. Each patch is wrapped in `push()`/`pop()`, and common drawing defaults are
reset between patches.

## Configuration

Use normal JavaScript configuration: properties, constructors, closures, factories,
or object spread.

```js
function makeKaleido(segments, hue) {
  return {
    segments,
    hue,
    draw({ audio, time }) {
      // draw with this.segments and this.hue
    },
  };
}

const kaleido = makeKaleido(12, 285);
const pinkLasers = { ...laserFan, hue: 330, direction: -1 };
```

p5js live supplies changing context values. The patch owns its configuration and
state. Do not rewrite shared context values such as `audio` or `time`.

## Scenes

```js
const scene = [
  checkerZoom,
  neonTunnel,
  laserFan,
  plasma,
];

activate(scene);
```

Earlier entries draw first. `activate()` accepts the array, not its name as a string.
Re-evaluating a scene changes its order without replacing unchanged patch
implementations or their state.

Functions, objects, instances, and factory results may appear inline:

```js
const scene = [
  laserFan,

  ({ time, audio }) => {
    const size = 30 + audio.bass * 100;
    circle(
      width / 2 + cos(time) * 180,
      height / 2 + sin(time) * 180,
      size,
    );
  },

  new ShaderChain().rotate(({ time }) => time * 0.1),
  plasma,
];
```

Inline values are created when the scene cell evaluates. p5js live calls functions as
`patch(context)` and objects as `patch.draw(context)`. Return values are ignored.

### Identity and copies

A named binding such as `laserFan` is a stable identity. An anonymous entry uses its
zero-based scene position, such as `scene[1]`; moving it creates a new identity and
fresh state.

The same patch may occur more than once:

```js
const echoes = [laserFan, laserFan, laserFan, plasma];
```

The copies share one implementation but have separate state. They appear as
`laserFan`, `laserFan#2`, and `laserFan#3`.

## Live commands

```js
activate(scene);     // activate at the next frame boundary
reset(laserFan);     // recreate state for every active copy
param("trail", 0.08, { min: 0, max: 0.3 });
```

Commands take JavaScript values, not string names. Edit arrays to add, remove,
duplicate, or reorder patches. The scene strip is read-only.

Ordinary calls such as `laserFan.addBeams(2)` run immediately and do not create a
new patch version.

## Cells and editor commands

`Cmd/Ctrl+Enter` evaluates the statement or cell under the cursor. A `// %%` marker
groups related statements into one atomic cell:

```js
// %% patch plasma
class Plasma {
  // ...
}

const plasma = new Plasma();
```

Evaluating this cell updates the class and instance together. Without a marker, each
complete top-level statement is its own block. `Cmd/Ctrl+Shift+Enter` evaluates the
complete buffer.

Editor behavior:

- Enter preserves indentation and indents inside matching delimiters.
- Tab and Shift+Tab adjust selected lines.
- `Cmd/Ctrl+/` adds or removes one comment layer. Nested comments are preserved.
- `Cmd/Ctrl+Option/Alt+T` tidies the current cell without evaluating it.
- `Option/Alt+Up/Down` moves the current line or selected consecutive lines.
- `Cmd/Ctrl+Alt+[` folds all; `Cmd/Ctrl+Alt+]` unfolds all.
- `Cmd/Ctrl+Alt+/` opens the command sheet.
- `Cmd/Ctrl+Option/Alt+A` opens the AI source editor.
- The Project panel's **code size** setting also changes folded and projected code.

Named performances keep stable insertion-order slots: new saves appear at the
bottom, while updates remain in place. `Cmd/Ctrl+Option/Alt+1…9` recalls the
corresponding numbered performance, including while the editor has focus. An empty
number slot leaves the current performance unchanged.
`Cmd/Ctrl+Option/Alt+S` appends a timestamped quick save and reports its stable slot
in the runtime status message.

Project export includes the current source and parameters plus every named
performance and the distinct patch source stored inside it. Import runs the working
source first, then merges valid performance records by identity. It never removes
unrelated performances already saved in the browser. Audio files are not embedded.

In the structured editor, hover a boundary in the far-left gutter to reveal
**+ New patch**. It inserts an object-patch cell, opens it, and places the cursor in
`draw()`. It does not evaluate or activate the patch.

### AI staging

The AI source editor replaces the visible source buffer but does not evaluate or save
the proposal immediately. Changed lines remain marked until one of two operations:

- `Cmd/Ctrl+Enter` accepts, evaluates, and saves the complete proposed buffer.
- `Cmd/Ctrl+Z` cancels and restores the exact buffer from before the first AI request.

Follow-up prompts replace the current proposal within the same transaction. Failed
evaluation leaves the proposal staged and the last successful runtime intact.

## Lifecycle and state

Only `draw()` is required. Objects and class instances may implement:

```js
const pixelRain = {
  state() {
    return { drops: [] };
  },

  enter({ state }) {},
  beat({ state, audio }) {},
  draw({ state, audio, dt }) {},
  exit({ state }) {},

  dispose() {
    // release resources owned by this implementation
  },
};
```

`state()` runs once per scene occurrence. Re-evaluating the patch retains that state;
`reset(pixelRain)` recreates it. State should contain structured-clone-compatible
data: numbers, strings, booleans, arrays, and plain objects.

Lifecycle methods receive the patch as `this`. `dispose()` runs when an
implementation is replaced, rolled back, or removed during project reset. Use it for
WebGL buffers, shaders, cameras, and similar resources.

## Audio

The shared `audio` object contains:

```js
audio.level
audio.bass
audio.mid
audio.treble
audio.beat
audio.spectrum
audio.waveform
audio.sampleRate
audio.nyquist
audio.raw
```

Normalized scalar features are generally `0..1`. `spectrum` contains FFT magnitudes
from `0..255`; `waveform` contains samples from `-1..1`. Both are immutable ordinary
JavaScript arrays, so `map`, `filter`, `reduce`, `some`, and `every` work directly.
`sampleRate` and `nyquist` identify the frequency range. `raw` contains the original
p5 scalar values and the same waveform and spectrum arrays. With no source, patches
continue with a silent snapshot.

```js
const strongBins = audio.spectrum.filter((magnitude) => magnitude > 180);
const average = audio.waveform.reduce((sum, sample) => sum + abs(sample), 0)
  / max(1, audio.waveform.length);
```

## Live parameters

```js
param("checkerSpeed", 0.08, { min: -0.4, max: 0.4, step: 0.01 });

const checkerZoom = ({ time, params }) => {
  rotate(time * params.checkerSpeed);
};
```

Re-evaluating `param()` keeps the performer's current value instead of restoring the
source default.

## ShaderChain

`ShaderChain` is a patch that transforms the pixels drawn by earlier scene entries.
It implements `draw()` and `dispose()`.

```js
const clubLens = new ShaderChain()
  .noiseWarp(({ audio }) => 0.005 + audio.bass * 0.03, 5, 0.1)
  .bloom(({ audio }) => 0.3 + audio.bass, 4, 0.5)
  .rgbSplit(({ audio }) => 1 + audio.treble * 12, 0)
  .vignette(0.3, 0.4)
  .blend("screen")
  .mix(0.75);
```

Every argument may be a number or a function receiving the live context. Functions
are evaluated each frame. One generated fragment shader applies the operators in
as one GPU pass. Coordinate mappings run before pixel and color stages.

Every effect chain also supports:

- `.mix(amount)` for wet/dry control; `amount` may be a live function.
- `.blend(mode)` with `alpha`, `add`, `multiply`, `screen`, `overlay`, `difference`,
  `subtract`, `lighten`, or `darken`.
- `.bypass()` and `.bypass(false)` for temporary effect bypass.

Transform operators:

| Method | Arguments |
| --- | --- |
| `transform(x, y, scaleX, scaleY, angle, anchorX, anchorY)` | Complete normalized stage transform |
| `mirror(horizontal, vertical)` | Reflection amounts from 0 to 1 |
| `crop(left, right, top, bottom)` | Normalized visible bounds |
| `noiseWarp(amount, scale, speed)` | Animated value-noise displacement |
| `rotate(angle, speed)` | Radians and optional radians per second |
| `scale(amount, xMult, yMult, offsetX, offsetY)` | Zoom, axis multipliers, and center |
| `pixelate(pixelX, pixelY)` | Horizontal and vertical cell counts |
| `repeat(x, y, offsetX, offsetY)` | Tiled copies and alternating offsets |
| `repeatX(reps, offset)` / `repeatY(reps, offset)` | One-axis tiling |
| `kaleid(sides)` | Radial mirror count |
| `scroll(x, y, speedX, speedY)` | Offset and speed on both axes |
| `scrollX(x, speed)` / `scrollY(y, speed)` | One-axis offset and speed |

Sampling and temporal operators:

`blur`, `sharpen`, `edgeDetect`, `bloom`, `vignette`, `rgbSplit`, `feedback`, and
`lumaMask`.

Color operators:

`posterize`, `shift`, `invert`, `contrast`, `brightness`, `luma`, `thresh`, `color`,
`saturate`, `hue`, `colorama`, `sum`, and `rgba`.

These operate on the current scene. `feedback` also samples the chain's previous
output frame. Use a custom WebGL patch for arbitrary multiple textures.
The starter `Plasma` class shows how to own an offscreen WebGL buffer, pass `canvas`
to a sampler, update uniforms, and release resources.

## StreamRoom (beta)

`StreamRoom` is a beta API for sharing rendered canvas video. `publish()` and
`receive()` return normal
lifecycle patches.

```js
const room = new StreamRoom({
  name: "warehouse-stage",
  performer: "Eric",
});

const mayaParticles = room.receive({
  stream: "Maya/particles",
  fit: "cover",
  opacity: 1,
});

const publishMain = room.publish({
  name: "main-output",
  fps: 30,
});
```

The publisher uses the main canvas unless `source` returns another canvas or render
surface. `fps` is clamped to 1–60.

Receiver `fit` is `cover`, `contain`, or `stretch`; `opacity` is 0–1. Its read-only
`texture` becomes a stable p5 media source after the remote track arrives. Status
moves through `waiting`, `connecting`, `live`, and `stalled` without throwing when a
peer leaves.

Publishing is explicit and video-only. The Network panel can join for discovery and
add a configured receiver. An editable `networkReceiver` template is under
**Library → Utilities**. See [NETWORKING.md](NETWORKING.md).

## Evaluation and recovery

- Compile, execution, or validation failure changes nothing.
- Replacements are queued for a frame boundary.
- Active copies must survive their first draw before a replacement is confirmed.
- First-draw failure restores the previous implementation, binding, version, and
  clone-compatible state.
- Successful versions appear in History.
- Duplicate named patch cells are collapsed to the newest source before full-buffer
  evaluation.
- **Set safe** captures source, implementations, versions, scene, parameters, and
  clone-compatible state.
- **Restore safe state** reports any state it could not restore.

p5js live evaluates trusted code with `new Function`. It catches exceptions but cannot
stop an infinite loop or prevent access to browser globals. See
[SECURITY.md](../SECURITY.md).

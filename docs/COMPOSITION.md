# Composition cookbook

An array describes a layer. Its patches draw in order; a nested array isolates
its image. p5js live's array methods add effects to the pixels already drawn in
that layer. See the [data model](DATA-MODEL.md) for the underlying rules.

## Two sketches, one layer

This complete example runs in a fresh project with **Start silent**. Replace the
editor contents and run all with `Cmd/Ctrl+Shift+Enter`:

<!-- example: together -->
```js
// %% patch backdrop
const backdrop = () => background(20, 22, 27);

// %% patch bars
const bars = {
  draw({ time }) {
    noStroke();
    fill("#57dbc8");
    rectMode(CENTER);
    for (let i = -2; i <= 2; i += 1) {
      const size = 100 + sin(time * 2 + i) * 60;
      rect(width / 2 + i * 45, height / 2, 24, size);
    }
  },
};

// %% patch rings
const rings = {
  draw({ time }) {
    noFill();
    stroke("#ffb45b");
    strokeWeight(3);
    for (let i = 1; i <= 4; i += 1) {
      circle(width / 2, height / 2, i * 70 + sin(time) * 20);
    }
  },
};

// %% scene scene
const scene = [
  backdrop,
  [bars, rings].rotate(0, 0.2).opacity(0.85),
];
scene.draw();
```

The inner array combines the two sketches before rotating and fading their image.
The background is outside that group. Later examples reuse `backdrop`, `bars`, and
`rings` from this program; replace the existing scene cell instead of appending
another `const scene` declaration.

## Make your code part of the picture

After the first example, replace the scene cell with this code:

<!-- example: code-image -->
```js
// %% patch liveCode
const liveCode = codeView({ patch: 'bars', fontSize: 22 });

// %% scene scene
const scene = [
  backdrop,
  [bars, rings].opacity(0.3),
  [liveCode].rotate(0, 0.03),
];
scene.draw();
```

The bars' source becomes transparent text pixels, with its own effects. Editing
that source changes the text immediately; Run changes the bars' behavior. Use
`codeView()` to follow the visible editor instead, or `codeView({source:'lastRun'})`
to show the latest accepted evaluation. Press Esc, then E to hide the editor while
keeping the code image in the scene. You can also use `[liveCode]` as a
`.modulate()` input. See the [code image reference](API.md#codeview).

## Separate effects

Replace and run the scene cell:

<!-- example: separate -->
```js
// %% scene scene
const scene = [
  backdrop,
  [bars].rotate(0, 0.2),
  [rings].opacity(0.6),
];
scene.draw();
```

Now rotation affects only the bars, and opacity affects only the rings.

## Nest another level

Replace and run the scene cell:

<!-- example: nested -->
```js
// %% scene scene
const scene = [
  backdrop,
  [
    [bars].rotate(0, 0.2),
    rings,
  ].blur(2).opacity(0.8),
];
scene.draw();
```

Bars rotate first. Their image joins the rings, then blur and opacity process both.
The backdrop stays sharp. To process the backdrop too, put the effect on the outer
scene array: `[backdrop, [bars, rings]].blur(2)`.

## Append patches and explicit shaders

These expressions illustrate the order; `bars` and `rings` are the patches above:

```js
const before = [bars].blur(3).add(rings);
const after = [bars].add(rings).blur(3);
```

In `before`, the rings draw after the blur. In `after`, the blur sees both sketches.
Neither expression adds an extra group. `.add([rings])` would append a nested group;
`.add(rings)` appends the patch directly.

**`.fx()` and `.add()` perform the same append operation.** The spelling `fx` says
that you intend to append effects. It does not turn a drawing patch into a shader
or isolate it. You can also place the effect directly in an array.

Use an explicit `ShaderChain` for chain-wide wet/dry mix, blend, bypass, or a reusable
effect patch. Replace the scene cell with this effect definition and scene:

<!-- example: explicit-shader -->
```js
// %% patch softFocus
const softFocus = new ShaderChain().blur(3).mix(0.4);

// %% scene scene
const scene = [backdrop, [bars, rings, softFocus]];
scene.draw();
```

`[bars, rings, softFocus]`, `[bars, rings].add(softFocus)`, and
`[bars, rings].fx(softFocus)` have the same scope and order. The chain processes the
preceding image and mixes 40% of its blurred result with that input. Its explicit
configuration remains separate from any subsequent chained array effects.

## Use one layer to distort another

Reuse the `backdrop`, `bars`, and `rings` patches from the first example. Replace
and run the scene cell:

<!-- example: modulation -->
```js
// %% scene scene
const scene = [
  backdrop,
  [bars].modulate([rings].blur(4), 0.12),
];
scene.draw();
```

The rings render privately and distort the bars. They are not a visible sibling.
Red and green in the input control horizontal and vertical sampling offsets,
centered at 0.5; alpha weights the distortion, so transparent regions are neutral.
The amount defaults to 0.1 (up to 5% displacement per axis), and can be a context
callback. Both arrays may contain nested layers or additional effects:

```js
const scene = [
  backdrop,
  [bars, rings].modulate([rings].rotate(0, 0.2).blur(5), 0.08),
];
scene.draw();
```

Tools → Scene lists the private patches under **Image input**. Open **Let one
image distort another → Run Image Modulation** there for a lettering-and-rings
demo with a depth control, smoothed bass response, and hold-H comparison.
See the [API reference](API.md) for displacement direction and lifecycle details.

## Pass configuration to patches

Use a factory, constructor, or ordinary object properties. The host supplies one
live context argument each frame; the factory receives your configuration once
when its code is evaluated. Add this cell before the scene, then replace the scene:

<!-- example: configured -->
```js
// %% patch makeDisk
function makeDisk({ x = 0.5, size = 80, color = "#57dbc8" } = {}) {
  return {
    draw({ time }) {
      noStroke();
      fill(color);
      circle(width * x, height / 2, size + sin(time * 2) * 20);
    },
  };
}

// %% scene scene
const scene = [
  backdrop,
  [
    makeDisk({ x: 0.35, color: "#57dbc8" }),
    makeDisk({ x: 0.65, size: 120, color: "#ffb45b" }),
  ].opacity(0.8),
];
scene.draw();
```

For a live effect value, use a context function, for example
`[bars, rings].opacity(({ audio }) => 0.4 + audio.bass * 0.6)`.
Controls created with `control()` are available through the same context.

## Method behavior

| Method | Behavior |
| --- | --- |
| `.add(...patches)` / `.fx(...patches)` | Append entries without flattening or changing effect scope. |
| `.draw()` | Select this named array as the active scene at the next frame boundary; return the array. |
| `.rotate(angle = 0, speed = 0)` | Rotate pixels in radians; speed is radians per second. |
| `.scale(amount = 1)` | Scale pixels around the center. |
| `.translate(x = 0, y = 0)` | Move pixels in normalized canvas units; positive X goes right and positive Y goes down. |
| `.opacity(amount = 1)` | Multiply alpha, normally by a value between 0 and 1. |
| `.mute(enabled = true)` | Pause this group's draw/onset calls while retaining state; reevaluate with `.mute(false)` to resume. |

Numeric effect arguments accept numbers or live context functions. Mute takes a
boolean. Array `.rotate()` and `.opacity()` use GPU shaders. p5's global `rotate()`
inside a patch changes that patch's drawing coordinates instead. Transforms and
styles do not carry into the next sibling patch. Pixel transforms use ShaderChain's
wrapping behavior.

See the [API reference](API.md#shaderchain) for the full operator vocabulary.
The shader's `shift()` is spelled `colorShift()` on arrays to preserve JavaScript's
existing `shift()` method.

Effect, append, and mute methods return new frozen arrays. They do not freeze or
mutate their input array or clone its patch objects. Build them outside patch
`draw()` methods. Replacing a named sketch updates its existing occurrences;
changing a group's structure requires rerunning the scene expression that uses it.
A shared patch object still shares its own properties and resources; only host
`state` is independent per occurrence. Use separate objects or `ShaderChain.clone()`
for independent object-owned resources or feedback.

## Inspect and edit

Open **Tools → Scene** to inspect the live sources, groups, effects, and shader pass
counts. Select a patch, group binding, or operator to open its code.

The up/down arrows edit top-level array expressions in source. The change is
undoable and does not execute automatically. **Review scene & run** opens the edited
scene; use Run or `Cmd/Ctrl+Enter` to apply it. Until then, the inspector shows the
live tree. Arrows are unavailable for pending edits or expressions that cannot be
reliably matched to rows, such as spread and generated root structure.

Edit nested order, mute, and shader bypass in source. Live controls and MIDI remain
in **Tools → Controls**.

## Try Layer Lab

Import [layer-lab.json](../starter/layer-lab.json) through **Tools → Performances →
Project files**. Save your current performance first. Choose **Start silent** if
asked; it includes every patch and animates without audio. The source is
[layer-lab.js](../starter/layer-lab.js).

1. In **Controls**, lower `labOpacity` to zero: the grid and caption remain sharp.
2. Adjust `labZoom`, `labHue`, and `labBlur`: both p5 sketches change together.
3. In **Scene**, select `labRings`, change a stroke color, and run that patch.
4. Change `.mute(false)` to `.mute(true)` in `layerLab`, then run the scene. Only
   that group disappears. Change it back and run to resume.
5. Recall **Layer Lab — effect order** and lower `labPixels` to around 30. One image
   has rotated pixel blocks; the other has screen-aligned blocks. The sketches and
   values are the same, with `pixelate` and `rotate` reversed.
6. Recall **Layer Lab** to return, including its saved control values.

## Shader order and resources

Every operator processes its predecessor's output, including coordinate operations.
Compatible operations share a pass. Neighborhood filters materialize their input
when needed, using at most two reusable WebGL targets per chain. Consecutive array
effect helpers may share a generated ShaderChain; an explicit chain keeps its own
configuration boundary.

Feedback storage exists only for chains containing `.feedback()` and records the
preceding frame's final chain output. Wet/dry mix and blend apply once at the end,
against the original input. Texture orientation and premultiplied alpha are handled
at pass boundaries so transparent groups composite correctly. Every nested group
also needs a render target; use the inspector and FPS readings to assess cost.

### Flash on the beat

Install **beatStrobe** from the Library and put it last in your scene:

```js
const scene = [myPatch, beatStrobe];
scene.draw();
```

A running Manual or Auto rhythm clock triggers each flash. With rhythm off or no
reliable clock, the patch falls back to detected audio onsets (hits, not an estimated
beat grid). Silence produces no flashes. Adjust `beatStrobe.opacity` (0–1) and
`beatStrobe.duration` (seconds) in its source; the defaults are 0.4 and 0.06 seconds.

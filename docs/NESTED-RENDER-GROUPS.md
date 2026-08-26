# Design note: recursive render groups

Status: implemented.

## Core syntax

A nested array inside a scene represents an isolated transparent render group:

```js
const scene = [
  solidBackground,
  [
    asciiNoise,
    plasma,
  ],
  vignette,
];

activate(scene);
```

The inner group renders independently. `plasma` affects only `asciiNoise`; the
completed group is then composited over `solidBackground`; `vignette` affects the
combined outer scene.

That isolation can make this particular example much darker than the flat scene. The
default `solidBackground` is nearly black, ASCII is sparse, and Plasma transforms its
input instead of supplying an opaque background. Plasma no longer sees the parent
background when it is inside the group. A brighter parent or richer group source makes
the separation easier to see.

Groups are recursive:

```js
const scene = [
  solidBackground,
  [
    localVideo,
    [asciiNoise, plasma],
    bloom,
  ],
  vignette,
];
```

Every array encountered inside a scene starts a transparent offscreen scope, processes
its contents from first to last, and returns one composited image to its parent.

## Evaluation timing

A bare function in a scene remains an ordinary function patch and runs every frame.
A called function runs during JavaScript evaluation. If it returns an array, that
array becomes a retained render group:

```js
function makeNoiseLayer() {
  return [asciiNoise, plasma];
}

const scene = [
  solidBackground,
  makeNoiseLayer(), // called once when this scene cell is evaluated
  vignette,
];
```

Changing a patch implementation requires reevaluating that patch cell. Changing the
factory's returned structure requires reevaluating the scene cell so the factory runs
again.

```text
Bare function in scene        -> patch; called every frame
Called function returns patch -> factory; called during evaluation
Called function returns array -> group factory; called during evaluation
Nested array                  -> isolated rendering scope
Spread array                  -> members inserted into the parent scope
```

## Higher-order composition patterns

Functions can accept a patch and return a processed group:

```js
const withGlow = (patch) => [patch, bloom];

const process = (source, ...effects) => [source, ...effects];

const scene = [
  solidBackground,
  withGlow(asciiNoise),
  process(localVideo, pixelDrift, bloom),
  vignette,
];
```

Patch factories can produce independently configured objects:

```js
const makeCircle = (size, colour) => ({
  draw() {
    fill(...colour);
    circle(width / 2, height / 2, size);
  },
});
```

Ordinary array operations can generate compositions:

```js
const circles = colours.map((colour, index) =>
  makeCircle(80 + index * 60, colour)
);
```

Nesting versus spreading has deliberate visual meaning:

```js
const isolated = [
  circles, // one isolated group
  plasma,
];

const ungrouped = [
  ...circles, // sibling patches in the parent scope
  plasma,
];
```

Conditional structure is also ordinary JavaScript and changes only when the scene is
reevaluated:

```js
const maybe = (condition, patch) => condition ? [patch] : [];

const scene = [
  solidBackground,
  ...maybe(useVideo, localVideo),
  asciiNoise,
];
```

## Recursive model

```text
Scene item = Patch | Group
Group      = Array<Scene item>
```

Each nested occurrence has its own rendering scope. Patch identity, state, and
lifecycle remain independent per occurrence even when the same patch appears more
than once.

## Engine behavior

- The evaluator recursively validates and normalizes the scene tree.
- Each active group occurrence owns a transparent `p5.Graphics` target.
- Ordinary p5 global drawing calls are routed to the current target, so patches do not
  need a special canvas API.
- A shader receives the current group canvas, never an ancestor canvas.
- The completed group is composited into its parent at its written position.
- Patch state and lifecycle remain per occurrence; named duplicates retain the usual
  `name`, `name#2`, … identities, while anonymous nested entries use paths such as
  `scene[1][0]`.
- Targets are reused while their group path remains active, resized with the stage,
  and released when the group leaves the scene.
- Safe State snapshots preserve the recursive scene configuration as well as patch
  versions, controls, MIDI mappings, and compatible instance state.

## Product and teaching value

The syntax keeps complexity in the engine and gives students one compositional rule.
It makes closures, factories, first-class functions, higher-order functions, recursive
data, `map`, spread, state identity, evaluation timing and visual scope observable
through immediate graphics.

No `layer()` wrapper is necessary. Nested arrays provide the intended syntactic sugar
while remaining ordinary JavaScript values.

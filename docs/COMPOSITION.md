# Compose sketches and effects

Sketches and shaders share the same scene model. A patch is an ordinary function or
object with `draw()`. An array describes a layer; a nested array isolates a group.
Native array methods apply effects while the host owns each patch's state and lifecycle.

For a short conceptual overview and the method protection rules, see
[Arrays, layers, and the draw loop](DATA-MODEL.md).

## Try Layer Lab

Import [layer-lab.json](../starter/layer-lab.json) from **Tools → Performances →
Project files → import**. Save your current performance first. Choose **Start
silent** if asked; the example animates without audio and includes all its patches.
The import also adds **Layer Lab** and **Layer Lab — effect order** recall slots.
The editable source is [layer-lab.js](../starter/layer-lab.js).

1. In **Controls**, lower `labOpacity` to zero: the grid and caption remain sharp.
2. Adjust `labZoom`, `labHue`, and `labBlur`: both p5 sketches change together.
3. In **Scene**, select `labRings`, change a stroke colour, and run just that patch.
4. Edit `.mute(false)` to `.mute(true)` in `layerLab`, then run that scene. Only the
   group disappears. Change it back to resume.
5. Recall **Layer Lab — effect order** and lower `labPixels` to around 30. The left
   image has rotated pixel blocks; the right image has screen-aligned blocks.
   Both use the same sketch and values, with `pixelate` and `rotate` reversed.
6. Recall **Layer Lab** to return. Recall restores the saved parameter values too.

## Start with an installed sketch

```js
// %% scene scene
const scene = [
  solidBackground,
  [waveScope]
    .kaleid(6)
    .hue(0.1)
    .opacity(({ audio }) => 0.4 + audio.bass * 0.6),
];
scene.draw();
```

Install `solidBackground` and `waveScope` first. Evaluate the scene cell to activate
the composition. The effects see only `waveScope`; the completed layer is composited
over `solidBackground`. Combine two sketches in one array to process them together:

```js
const scene = [
  solidBackground,
  [waveScope, laserFan]
    .rotate(({ time }) => time * 0.1)
    .scale(1.1)
    .bloom(0.4, 3, 0.6),
];
scene.draw();
```

Ordinary arrays still work: `[waveScope, effect]` is an isolated group when nested
inside a scene. Factories can still return patches or arrays. There is no separate
composition graph to maintain.

## Native array methods

```js
const pair = [waveScope, laserFan].rotate(0, 0.2);
const scene = [solidBackground, pair].opacity(0.8);
scene.draw();
```

Rotation affects the pair; opacity affects the whole scene. The expression is
built when the code runs, and the host renders it each frame. `scene.draw()` stages
activation through the current evaluation transaction. Use a named array and call
it from evaluated code. It never replaces p5's `window.draw()` callback.

All direct ShaderChain operators are supported on arrays, except the shader's
`shift()` is named `colorShift()`; native `.shift()` still removes the first entry.
For example, `[waveScope].hue(0.2).blur(3)` processes hue before blur. Use an explicit
ShaderChain through `.fx()` for wet/dry mix, blend mode, and bypass settings.

```js
const softFocus = new ShaderChain().blur(3).mix(0.4);
const scene = [solidBackground, [waveScope].fx(softFocus)];
scene.draw();
```

These methods live on `Array.prototype`. They are non-enumerable and protected:
reassigning an installed method throws even in non-strict code, and its prototype
property cannot be redefined. Installation refuses occupied names and never
replaces native methods. No source translation is used. `layer(sketch)` and
`activate(scene)` remain supported for existing performances.

## Composition methods

| Method | Behavior |
| --- | --- |
| `[patch1, patch2]` | Describe one layer; nest the array to isolate its image from its parent. |
| `.add(...patches)` | Append patches or nested arrays without flattening or changing effect scope. |
| `.draw()` | Select this named scene for the ongoing draw loop, at the next frame boundary. |
| `.fx(...effects)` | Append patches that process the layer's current image, in order. |
| `.rotate(angle = 0, speed = 0)` | Rotate the rendered image in radians; speed is radians per second. |
| `.scale(amount = 1)` | Scale the rendered image around its center. |
| `.translate(x = 0, y = 0)` | Move the rendered image in normalized canvas units. Positive X moves right; positive Y moves down. |
| `.opacity(amount = 1)` | Multiply the layer's alpha, normally with an amount between 0 and 1. |
| `.mute(enabled = true)` | Pause this group's draw/beat calls while retaining instance state. Use `.mute(false)` to resume. |

Numeric arguments can be numbers or functions of the live context, including
`audio`, `time`, and `controls`. Mute takes a boolean. Transforms operate on pixels,
using ShaderChain's wrapping behavior; they do not change the sketch's p5 drawing
coordinates. Put p5 `translate`, `rotate`, or styles inside the sketch when you want
draw-time changes. Drawing state does not carry from one patch to its next sibling.

Effect and composition methods return new frozen arrays, so branching a builder does not change its
parent. Consecutive shader helpers share a generated ShaderChain.
Explicit `.fx()` chains retain their own mix, blend, bypass, and feedback boundaries.
Child patch objects remain ordinary references; use separate patch objects or
`ShaderChain.clone()` when you need independent object-owned resources/feedback.

Build layer arrays outside patch `draw()` methods, not once per frame. Named
compositions become active when you run `scene.draw()` or `activate(scene)`. Changing
a layer's structure requires reevaluating the scene that uses it. Replacing a named sketch's
implementation updates its existing instances without rebuilding the layer. The
host preserves occurrence state and handles failed first-frame replacement.

## Inspect and edit

Open **Tools → Scene** to see the live scene's sources, groups, and effects. Group
borders show isolated scope. Shader operations appear in written order, with their
pass count underneath. Select a patch, group binding, or operator to open its code.

The up/down arrows reorder top-level array expressions in the editor. Formatting
and surrounding comments stay in place. The change is undoable and does not execute
automatically. **Review scene & run** opens the edited scene; select its Run button
or press Cmd/Ctrl+Enter. Until then, the inspector continues showing the live tree.

Reorder buttons are unavailable while scene edits are pending, or when spread,
appended root effects, or generated root structure prevents a reliable source-to-row match. Edit nested group
order, mute, and shader bypass in source. The inspector displays muted groups and
bypassed ShaderChains. MIDI mapping and live controls remain in **Tools → Controls**.

## Shader order and resource use

Each ShaderChain operator processes its predecessor's output. For example,
`.hue(0.3).blur(3)` blurs the hue-adjusted pixels, while `.blur(3).hue(0.3)` changes
the hue after blurring. Coordinate operations also keep their written position.

Compatible operations share a pass. Neighborhood filters materialize their input
when needed, using at most two reusable WebGL targets per chain. This prevents
repeated blur/bloom from expanding into exponentially more texture samples.
Feedback storage is created only for chains containing `.feedback()` and records
the preceding frame's final chain output. Wet/dry and blend apply once at the end,
against the original input. Texture orientation and premultiplied alpha are handled
at pass boundaries so transparent sketch layers composite correctly.

The corrected order and alpha handling can change the appearance of saved chains
that depended on the previous coordinate regrouping, discarded color operations,
vertical flips, or forced opaque output. Review such performances before use.

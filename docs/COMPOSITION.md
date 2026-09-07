# Compose sketches and effects

Sketches and shaders share the same scene model. A patch is an ordinary function or
object with `draw()`. A nested array isolates a group. `layer()` adds fluent methods
around that group while the host continues to own every patch's state and lifecycle.

For a short conceptual overview and the proposed fluent API, see
[Sketches, layers, and scenes](DATA-MODEL.md).

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
  layer(waveScope)
    .fx(new ShaderChain().kaleid(6).hue(0.1))
    .opacity(({ audio }) => 0.4 + audio.bass * 0.6),
];
activate(scene);
```

Install `solidBackground` and `waveScope` first. Evaluate the scene cell to activate
the composition. The effects see only `waveScope`; the completed layer is composited
over `solidBackground`. You can also wrap an existing group:

```js
const scene = [
  solidBackground,
  layer([waveScope, laserFan])
    .rotate(({ time }) => time * 0.1)
    .scale(1.1)
    .fx(new ShaderChain().bloom(0.4, 3, 0.6)),
];
activate(scene);
```

Ordinary arrays still work: `[waveScope, effect]` is an isolated group when nested
inside a scene. Factories can still return patches or arrays. There is no separate
composition graph to maintain.

## Layer methods

| Method | Behavior |
| --- | --- |
| `layer(sketchOrGroup)` | Start an isolated transparent group around a patch or array. |
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

Layer methods return new frozen arrays, so branching a builder does not change its
parent. Consecutive transform/opacity conveniences share a generated ShaderChain.
Explicit `.fx()` chains retain their own mix, blend, bypass, and feedback boundaries.
Child patch objects remain ordinary references; use separate patch objects or
`ShaderChain.clone()` when you need independent object-owned resources/feedback.

Build layers outside `draw()`, not once per frame. Named layers are group values,
not automatically activated scenes. As with any array or factory, changing a layer's
structure requires reevaluating the scene that uses it. Replacing a named sketch's
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

Reorder buttons are unavailable while scene edits are pending, or when spread or
generated root structure prevents a reliable source-to-row match. Edit nested group
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

# Arrays, layers, and the draw loop

The authoring model uses ordinary JavaScript arrays with effect methods installed by
p5js live. These extensions are available inside the instrument, not built into
JavaScript itself. An array describes a layer; `.draw()` selects it for the host's frame loop.

## The model

**An array describes a layer.** Entries run in written order. A nested array
describes an isolated transparent layer whose completed image composites into its
parent. A patch is an ordinary function or object with `draw(context)`: it can
draw p5 geometry or process the pixels already drawn in its layer.

The names below stand for patches you have already defined. For a complete runnable
program, use the [composition cookbook](COMPOSITION.md).

```js
const scene = [
  backdrop,
  [patch1, patch2].rotate(0, 0.2),
  patch3,
].opacity(0.6);

scene.draw();
```

Rotation processes patches 1 and 2 together. Opacity processes the entire scene,
including the backdrop and patch 3. The host renders this description every frame;
the expression builds the description when its code is evaluated.

| Concept | Meaning |
| --- | --- |
| Patch definition | A reusable drawing function or object with lifecycle methods. |
| Patch occurrence | A position in a scene, with host-managed state and lifecycle. |
| Array / layer | An ordered sequence of patches and nested layers. |
| ShaderChain | An effect patch containing ordered GPU operations. |
| Scene | A named layer selected for the ongoing draw loop. |

## Array methods, normal JavaScript

Effect methods live on `Array.prototype`; there is no source translator or custom
array syntax. Array literals, variables, factory results, computed method names,
and ordinary JavaScript calls use the same methods.

```js
const pair = [patch1, patch2];
const faint = pair.opacity(0.2);
const bright = pair.opacity(0.9);
const scene = [backdrop, faint, patch3];
scene.draw();
```

Effect, append, and mute methods return new frozen arrays. They do not mutate
`pair`, add an extra nested layer, clone patch definitions, or execute a patch
during construction. The literal `pair` remains mutable; `faint` and `bright` are
frozen. Native reads such as `.map()` still work, but mutating methods such as
`.push()` or `.shift()` throw on a frozen result. Existing patch references retain
their identity. Any of these arrays can be nested inside another array.

`.add(...patches)` and `.fx(...effects)` are the same append operation. They
preserve nested arrays and do not change which layer later methods affect. `fx`
expresses an intention to append effects; it does not convert a patch into a
shader. An explicit ShaderChain can also be placed directly in an array.

```js
const before = [patch1, patch2].blur(3).add(patch3);
const after = [patch1, patch2].add(patch3).blur(3);
```

In `before`, patch 3 draws after the blur. In `after`, all three patches contribute
to the image being blurred. Consecutive shader helpers may share a generated
ShaderChain. An explicit ShaderChain keeps its own shader configuration.
Numeric effect arguments may be constants or functions of the live context.

The direct shader vocabulary follows ShaderChain, with `colorShift()` replacing
its `shift()` spelling because native arrays already use `shift()`. `.translate()`
and `.opacity()` provide convenient transform and alpha operations. Explicit ShaderChain
objects remain available for wet/dry mix, blending, and bypass configuration.
`.mute(boolean)` pauses a group's draw and onset calls while retaining state.

Array `.rotate()` and `.opacity()` process rendered pixels with GPU shaders. p5
global `rotate()` inside a patch changes drawing coordinates for that patch. The
array method and the p5 function belong to different objects.

## Scene activation and namespaces

Only one scene is active at a time. `scene.draw()` selects a named array for
rendering at the next frame boundary, replacing the active scene. Calling
`otherScene.draw()` switches to that scene. If several draw commands are applied
at the same boundary, the last one wins. To render multiple layers together,
include them in one scene array. Defining a new array alone does not switch scenes.
After changing a helper or group variable, reevaluate the scene expression that
uses it to rebuild the structure. Replacing a named patch updates its existing
occurrences without rebuilding the scene.

The command returns that array, so `const scene = [...].draw()` can also capture
the name. A scene must have a named binding. Call `.draw()` while evaluating live
code; the host owns subsequent frames. The array definition
and its `.draw()` command can be evaluated together or in separate blocks.

`Array.prototype.draw`, `patch.draw`, and p5's `window.draw` belong to different
objects. The array command stages activation through the existing evaluation
transaction. It does not replace the p5 callback. Array classification takes
precedence over detection of a patch's `draw()` method.

## Method protection

Installation checks every requested name before installing any method. Existing
native names are never repurposed. Reinstalling the same API is harmless; an
unrelated existing method causes a clear error.

Installed methods are non-enumerable and non-configurable, with setters that throw
on reassignment even in non-strict code. This protects the extensions on
`Array.prototype`. Native methods retain their existing descriptors and behavior;
the installer rejects attempts to register over them. This does not prohibit
deliberate own-property definitions on individual arrays.

## Configuration and state

Pass configuration through a factory, constructor, or object properties. The host
still supplies one context argument per frame. A patch object used twice shares
its own properties and resources; the host gives each occurrence independent
`context.state`. Use separate objects for independent object-owned configuration
or GPU resources.

## Runtime responsibilities

Effect and composition methods return ordinary frozen arrays. ShaderChain
implements their GPU operations. Array methods preserve nested groups and named
patch references. Malformed, sparse, and cyclic patch groups are rejected before
activation. Source is evaluated exactly as written.

Source remains the composition authority. Editing prepares a change; Run applies
it. Projects store source and performer settings. GPU buffers remain runtime
resources, and safe-state recovery retains supported occurrence state.

## Changing visual values

`lfo`, `envelope`, `ramp`, `sequence`, `remap`, and `variation` produce numeric
context callbacks. They can drive ordinary p5 drawing or array/shader parameters;
image composition remains an array. One helper shares one sample and state across
its consumers. The optional `clock` is separate from detected `audio.onset` hits.
See [Timing and visual signals](RHYTHM.md) for examples and lifetime rules.

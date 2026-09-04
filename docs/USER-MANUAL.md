# p5js live

## User manual

p5js live exists to make visual programming something you can *play*. It is a
browser-based instrument for changing JavaScript while its visuals are running. Code
and output share the same stage: listen to music, watch the image respond, change a
number or an algorithm, and apply that change without reloading the page or stopping
the performance.

That ongoing cycle is **live coding**. The code is not only preparation for a finished
piece; editing it is part of playing the piece. A small change can alter color or
motion, a scene edit can rearrange the entire composition, and a MIDI control can turn
a source value into a physical performance gesture.

It is made for the overlapping worlds of live coding and algorave, creative coding
and p5.js, VJ and audiovisual performance, generative art, shader practice, and
computer-science education. A newcomer can begin by changing one number; an expert can
build recursive compositions, stateful simulations, controller mappings, and custom
GPU effects in the same environment.

Its approach is to keep the performance machinery alive while making visual ideas
small and replaceable. Those ideas are **patches**; visible JavaScript arrays compose
them into **scenes**. The interface assists this code-first model instead of hiding it
behind a separate timeline or node graph.

This manual begins with the shortest path to a working visual and gradually builds
toward reusable objects, live controls, MIDI, higher-order functions, nested render
groups, and shaders. You do not need to understand the advanced sections before you
start performing.

For exact method and field definitions, see the [API reference](API.md). For the
implementation model, see [Architecture](ARCHITECTURE.md).

| Document information | |
| --- | --- |
| Manual edition | 1.0 |
| Updated | August 26, 2026 |
| Audience | Students, educators, creative coders, and live visual performers |
| Prerequisites | Current desktop Google Chrome; basic JavaScript is helpful but not required |

### How to use this manual

You can read the manual from beginning to end as a course, or follow the path that
matches your immediate goal:

- **New to p5js live:** complete Chapters 1–5, then make one edit to the starter
  scene.
- **Writing patches:** read Chapters 6–13 for context, audio, objects, arrays,
  higher-order functions, and state.
- **Preparing a performance:** read Chapters 14–24 for controls, MIDI, shaders,
  saving, recovery, and audience output.
- **Understanding the design:** read Chapters 25–27 for the computer-science model,
  identity, transactions, and the reasons behind the architecture.
- **Teaching or reviewing:** use Chapters 28–36 for patterns, complete reference
  tables, troubleshooting, terminology, and links to deeper material.

Each chapter introduces one working idea before adding variations. Code examples are
intended for the p5js live editor unless a block is explicitly marked as a shell
command.

### Contents

- [Part I — Get oriented](#part-i--get-oriented)
  - [1. Why p5js live exists](#1-why-p5js-live-exists)
  - [2. Start p5js live](#2-start-p5js-live)
  - [3. Know the workspace](#3-know-the-workspace)
  - [4. Make the first live edit](#4-make-the-first-live-edit)
  - [5. p5.js inside a patch](#5-p5js-inside-a-patch)
- [Part II — Program patches](#part-ii--program-patches)
  - [6. The injected context](#6-the-injected-context)
  - [7. Read sound and FFT data](#7-read-sound-and-fft-data)
  - [8. Choose a patch form](#8-choose-a-patch-form)
  - [9. Configure and reuse patches](#9-configure-and-reuse-patches)
- [Part III — Compose the instrument](#part-iii--compose-the-instrument)
  - [10. Build and activate scenes](#10-build-and-activate-scenes)
  - [11. Higher-order scene composition](#11-higher-order-scene-composition)
  - [12. Isolate effects with nested arrays](#12-isolate-effects-with-nested-arrays)
  - [13. Keep state across frames](#13-keep-state-across-frames)
  - [14. Create live controls](#14-create-live-controls)
  - [15. Map MIDI hardware](#15-map-midi-hardware)
  - [16. Transform pixels with ShaderChain](#16-transform-pixels-with-shaderchain)
  - [17. Load a local video as a patch](#17-load-a-local-video-as-a-patch)
- [Part IV — Manage and perform](#part-iv--manage-and-perform)
  - [18. Understand the Library lifecycle](#18-understand-the-library-lifecycle)
  - [19. Save work, performances, and projects](#19-save-work-performances-and-projects)
  - [20. Capture and restore Safe State](#20-capture-and-restore-safe-state)
  - [21. Keep the last good image](#21-perform-without-losing-the-last-good-image)
  - [22. Project code for an audience](#22-project-code-for-an-audience)
  - [23. Use the AI source editor carefully](#23-use-the-ai-source-editor-carefully)
  - [24. Follow a reliable live-set workflow](#24-a-reliable-live-set-workflow)
- [Part V — Understand why the model works](#part-v--understand-why-the-model-works)
  - [25. The design goals](#25-the-design-goals)
  - [26. The computer science inside the instrument](#26-the-computer-science-inside-the-instrument)
  - [27. Transactional replacement, identity, and recovery](#27-transactional-replacement-identity-and-recovery)
- [Part VI — Practice and reference](#part-vi--practice-and-reference)
  - [28. Patterns worth practicing](#28-patterns-worth-practicing)
  - [29. Interface reference](#29-interface-reference)
  - [30. Keyboard reference](#30-keyboard-reference)
  - [31. Runtime reference](#31-runtime-reference)
  - [32. Files, sharing, and persistence reference](#32-files-sharing-and-persistence-reference)
  - [33. Product limits and safety](#33-product-limits-and-safety)
  - [34. Troubleshooting](#34-troubleshooting)
  - [35. Glossary](#35-glossary)
  - [36. Where to continue](#36-where-to-continue)

### Conventions

- **Bold text** identifies a control, panel, action, or status shown in the interface.
- `Monospace text` identifies source code, a filename, or a key.
- `Cmd/Ctrl` means use Command on macOS or Control on Windows and Linux.
- A **patch** is executable visual behavior; a **scene** is the array that composes
  patches.

> **Note:** Notes explain behavior that may not be obvious from the interface.

> **Caution:** Evaluate imported code only when you trust its source. p5js live runs
> JavaScript as code; it is not a security sandbox.

---

## Part I — Get oriented

### 1. Why p5js live exists

Visual coding often happens in two separate modes: first you write a program, then
you run the result. That is useful for producing a finished animation, but it puts a
wall between programming and performance. The interesting code disappears at the
moment the artwork begins.

p5js live removes that wall. The program remains visible and changeable while its
image and music continue. Editing a color, replacing an algorithm, rearranging a
composition, or mapping a MIDI pad can all become gestures in the performance.

The goal is not merely faster preview. The goal is to make code a live artistic
material—something that can be rehearsed, improvised, taught, projected, discussed,
and shared.

#### The communities it is for

p5js live sits at the intersection of several communities:

- **Live coders and algorave performers** who treat algorithms as part of electronic
  music and audiovisual performance.
- **Creative coders and the p5.js community** who already use approachable JavaScript
  to explore drawing, animation, interaction, and generative systems.
- **VJs, visualists, and media performers** who need audio-reactive sources, effects,
  projection output, fast recall, and physical controls.
- **Students and educators** who want advanced programming ideas to produce immediate,
  discussable visual consequences.
- **Generative artists and shader authors** who want to combine p5 drawing, procedural
  systems, media, and GPU effects without building the surrounding performance tool
  from scratch.
- **Patch authors and classroom communities** who want a small, readable unit of
  visual behavior that can be exchanged and adapted without replacing someone else's
  whole project.

You do not have to identify as a performer to use it. A first session may simply be
changing a number and noticing what happens. The same environment can later support a
prepared audiovisual set or an advanced study of state, recursion, and shaders.

#### What it is for

p5js live treats code as both a creative material and a performance interface. Use it
to:

- learn creative coding by connecting JavaScript to visible behavior;
- learn computer science through arrays, objects, functions, state, recursion,
  composition, and graphics pipelines;
- build visuals that respond to a music file, microphone, mixer, or audio interface;
- perform source edits and scene changes in front of an audience;
- improvise with onscreen controls, MIDI knobs, faders, switches, and drum pads;
- build, inspect, remix, and share visual patches;
- combine functions, object-oriented programming, functional programming, array
  transformations, and GLSL in one composition.

#### The approach

The interface removes repetitive infrastructure without hiding the program. Four
choices define the approach:

1. **Keep the instrument running.** The canvas, clock, sound analysis, controls,
   state, and audience output continue while one visual behavior changes.
2. **Make visual ideas replaceable.** A patch packages one source, drawing system,
   simulation, diagnostic, or effect so it can be edited independently.
3. **Keep composition in readable code.** A scene is a visible JavaScript array, not
   a second arrangement hidden in the interface.
4. **Apply changes deliberately and safely.** Evaluation is the performer's cue. New
   code is checked before it replaces the last successful version.

This is not a simplified visual language placed on top of JavaScript. Patches are
ordinary JavaScript values. Scenes are ordinary arrays. Controls are declared in
source. Functions, objects, classes, closures, higher-order functions, and shaders
retain their real meanings.

The point is to remove the machinery that interrupts creative iteration while
leaving the important programming ideas exposed.

#### The live-coding loop

In a conventional coding workflow, you often edit, rebuild, reload, and then inspect
the result. p5js live shortens that into a performance loop:

1. Watch and listen to what is running.
2. Edit one useful unit of code.
3. Evaluate it with `Cmd/Ctrl+Enter`.
4. See the running image adopt the successful change.
5. Repeat.

The music and last good visual continue through this loop. If new code contains an
error, p5js live reports it and keeps the previous successful version on stage. This
makes experimentation safer, although it is still important to save known-good work.

#### The small mental model

Four ideas are enough to begin:

- A **patch** is one visual idea: a background, a field of shapes, an audio meter, a
  video source, or a pixel effect.
- A **scene** is an array that says which patches are playing and in what order.
- **Context** is the changing time, sound, controls, and state supplied to patches.
- **Evaluation** applies an edited patch or scene to the running instrument.

```text
 audio · time · controls
           ↓
 [background → visual patch → effect] → stage
           ↑
       evaluate code
```

Do not worry yet about whether a patch is written as a function, object, or class
instance. Those are different ways to package a visual idea, and the manual introduces
them only after you have used the instrument.

#### A first scene

Here is a complete two-layer scene. You do not need to understand every symbol yet:

```js
const dot = ({ audio }) => {
  circle(width / 2, height / 2, 40 + audio.bass * 180);
};

const scene = [
  solidBackground,
  dot,
];

activate(scene);
```

Read the `scene` array from top to bottom. `solidBackground` establishes the first
layer. `dot` adds a circle whose size follows the bass. Earlier entries contribute
pixels first; later entries draw over them or transform what is already there.

`activate(scene)` identifies this array as the composition to run. When the scene cell
is evaluated, p5js live updates the active composition at a frame boundary.

#### Source and the running performance

The editor and the running performance are related but distinct:

- Typing changes the source you can see.
- Evaluating asks p5js live to apply that source.
- A successful evaluation becomes the new running version.
- A failed evaluation leaves the last successful version running.

This distinction is why you can prepare several edits and decide exactly when the
audience sees them. It is also why adding a patch name to a scene does not affect the
image until that scene is evaluated.

> **Start simple:** At first, live coding can mean changing one color, size, speed, or
> scene entry at a time. More advanced JavaScript expands what can be expressed, but
> it does not change this basic performance loop.

#### What it is not

p5js live is not a timeline video editor, a node-based compositor, or a general
purpose JavaScript IDE. It does not turn code into a sandbox, and it does not make
expensive or infinite programs safe. It is deliberately focused on trusted,
browser-based visual code whose structure can be changed while it runs.

That focus produces a useful constraint: creative decisions that affect the scene
belong in readable source. A future reader can see the same composition the runtime
sees.

### 2. Start p5js live

The fastest first session is: open the instrument, choose a sound source, close the
welcome dialog, change one visible value, and evaluate it.

#### Use the hosted instrument

Open [p5js.live](https://p5js.live) in current desktop Google Chrome. Other browsers
may render parts of the instrument, but they are not supported performance targets.

#### Run it locally

Install Node.js 20 or newer, then run these commands in the project folder:

```sh
npm ci
npm run dev
```

Keep the terminal open and visit
[http://localhost:5173/live/](http://localhost:5173/live/). Do not open `index.html`
directly; the instrument must be served over HTTP.

#### Choose sound

At startup, choose one of the following:

- **Audio file** for an MP3, WAV, OGG, M4A, or AAC file supported by the browser.
- **Microphone/input** for a microphone, mixer, or audio interface.
- **Silence** to code without an audio source.

Browsers require a click before they allow sound. If a file takes time to decode,
wait for the loading indication to finish. Press `Space` or use the transport to play
and pause. The loop control repeats a file.

Audio files are deliberately not embedded in project exports. Keep the media file
with the exported project if another performer will need it.

### 3. Know the workspace

The stage is both the visual output and the editor background. The main areas are:

- **Code**: editable patch and scene cells over the stage.
- **Transport**: play, pause, and loop controls.
- **Tools**: Audio, Library, Controllers, Project, Messages, AI, and other settings.
- **Reference**: a compact view of installed patch interfaces.
- **Audience window**: a clean output window for a projector or second display.

Useful view keys work after editor focus is released with `Esc`:

| Key | Action |
| --- | --- |
| `e` | Show or hide code |
| `f` | Enter or leave fullscreen |
| `p` | Open the audience window |
| `r` | Show or hide the installed-patch reference |
| `Cmd/Ctrl+\` | Show or hide tools |
| `?` | Show the command sheet |

The code background is intentionally transparent. Small translucent boxes belong to
the characters and lines, so the visual remains visible while you perform.

### 4. Make the first live edit

Use the starter project for the first edit:

1. Select the disclosure arrow beside `asciiNoise` or `plasma` to unfold that patch.
2. Click inside the patch so the text cursor is visible.
3. Change one number. Good first choices are `cellSize`, `density`, or `hue` in
   `asciiNoise`, and `speed` or `motion` in `plasma`.
4. Press `Cmd/Ctrl+Enter` while the cursor remains inside that patch.
5. Watch the stage and the status message at the bottom.

> **Expected result:** The visual changes immediately, the music continues, and a
> brief success flash confirms the evaluation. You do not need to refresh the page.

Change the value again and repeat. Try a large change so the relationship between
source and image is obvious. Then restore a value you like.

Evaluation is different from typing. Typing prepares the next possibility;
evaluation makes that possibility part of the running performance.

The most important editor commands are:

| Command | Action |
| --- | --- |
| `Cmd/Ctrl+Enter` | Evaluate the current cell or statement |
| `Cmd/Ctrl+Shift+Enter` | Evaluate the complete editor |
| `Cmd/Ctrl+/` | Comment or uncomment the selected lines |
| `Cmd/Ctrl+Option/Alt+T` | Tidy the current cell |
| `Cmd/Ctrl+Shift+Up/Down` | Move the current line or selection |
| `Cmd/Ctrl+Alt+[` | Fold all objects, functions, classes, and scenes |
| `Cmd/Ctrl+Alt+]` | Unfold all while keeping fold controls available |
| `Esc` | Release editor focus for performance keys |

Cell markers such as `// %% patch name` make a large project navigable and let the
evaluator replace one unit safely. Folded source still exists and keeps its original
line numbers.

### 5. p5.js inside a patch

p5 drawing functions and globals remain available: `circle`, `rect`, `line`,
`beginShape`, `vertex`, `fill`, `stroke`, `noise`, `map`, `width`, `height`,
`mouseX`, and many others.

The origin `(0, 0)` is at the upper-left. `x` increases to the right and `y`
increases downward.

```js
const movingLine = ({ time }) => {
  const x = width / 2 + sin(time) * width * 0.35;
  stroke(255);
  strokeWeight(4);
  line(x, 0, width - x, height);
};
```

p5js live wraps each patch in drawing-state protection, so ordinary style and
transform changes do not normally leak into the next patch. A patch that should
clear or establish the canvas belongs first in the scene. Most drawing and diagnostic
patches should remain transparent so they can be layered.

---

## Part II — Program patches

### 6. The injected context

In this method:

```js
draw({ audio, time, state }) {
  // ...
}
```

the braces are JavaScript object destructuring. The complete parameter is an object
called the **context**. p5js live creates and injects it on every frame; the patch
selects only the fields it needs.

| Context field | Meaning |
| --- | --- |
| `audio` | Current level, frequency bands, beat, spectrum, and waveform |
| `time` | Seconds since the host started |
| `sceneTime` | Seconds since this scene was activated |
| `dt` | Seconds since the previous frame, bounded after a stall |
| `state` | Persistent data unique to this occurrence in the scene |
| `canvas` | The main p5 renderer; also usable as a shader texture |
| `controls` | Current values declared with `control()` |
| `keyboard` | Read-only physical keyboard state |

This is dependency injection in a small, practical form: the engine supplies live
dependencies rather than making every student wire up an FFT, clock, keyboard, and
canvas.

The context does not replace ordinary parameters. Configuration is supplied when a
patch is created; context is supplied later, each time it draws:

```js
class PulseRing {
  constructor(radius, speed) {
    this.radius = radius;
    this.speed = speed;
  }

  draw({ time, audio }) {
    const diameter = this.radius + sin(time * this.speed) * 30 + audio.bass * 90;
    circle(width / 2, height / 2, diameter);
  }
}

const slowRing = new PulseRing(180, 0.7);
```

You provide `180` and `0.7` once. The engine provides fresh `time` and `audio` on
every frame.

### 7. Read sound and FFT data

The Web Audio analyser turns sound into useful values:

```js
audio.level       // normalized overall energy, generally 0..1
audio.bass        // normalized low-frequency energy
audio.mid         // normalized middle-frequency energy
audio.treble      // normalized high-frequency energy
audio.beat        // true on a detected beat event
audio.spectrum    // FFT magnitudes, each 0..255
audio.waveform    // time-domain samples, each -1..1
```

Install diagnostic patches such as waveform, frequency bars, and audio meters to see
what the analyser is receiving. Smoothing and auto-gain live in the Audio tools.

#### Draw a waveform

```js
const waveLine = ({ audio }) => {
  noFill();
  stroke(80, 220, 255);
  beginShape();

  audio.waveform.forEach((sample, index) => {
    const x = map(index, 0, audio.waveform.length - 1, 0, width);
    const y = height / 2 + sample * height * 0.3;
    vertex(x, y);
  });

  endShape();
};
```

#### Draw frequency bars

```js
const spectrumBars = ({ audio }) => {
  noStroke();
  const bins = audio.spectrum.slice(0, 96);
  const barWidth = width / bins.length;

  bins.forEach((magnitude, index) => {
    const barHeight = map(magnitude, 0, 255, 0, height * 0.7);
    rect(index * barWidth, height - barHeight, barWidth - 1, barHeight);
  });
};
```

The arrays are immutable ordinary JavaScript arrays. Array methods make audio a
natural way to learn data transformations:

```js
const loudBins = audio.spectrum.filter((value) => value > 180);

const points = audio.waveform.map((sample, index) => ({
  x: index * width / audio.waveform.length,
  y: height / 2 + sample * 120,
}));

const average = audio.waveform.reduce(
  (sum, sample) => sum + abs(sample),
  0,
) / max(1, audio.waveform.length);
```

`forEach` performs an action, `map` creates transformed values, `filter` selects
values, and `reduce` combines many values into one.

### 8. Choose a patch form

All three forms below are first-class JavaScript values and can be placed directly
in a scene.

#### Function patch

Use a normal function for a small stateless idea:

```js
function horizon({ audio }) {
  stroke(255);
  line(0, height / 2, width, height / 2 + audio.mid * 100);
}
```

#### Arrow-function patch

An arrow function is compact and works especially well for an inline patch:

```js
const bassFlash = ({ audio }) => {
  if (audio.bass > 0.72) {
    background(255, 40, 180);
  }
};
```

An arrow function does not create its own `this`. Do not use an arrow as an object
method when the method needs object properties.

#### Object patch

Use an object literal when the patch has named properties and methods:

```js
const rings = {
  count: 6,
  spacing: 32,

  grow(amount) {
    this.spacing += amount;
  },

  draw({ audio }) {
    noFill();
    for (let index = 1; index <= this.count; index += 1) {
      circle(
        width / 2,
        height / 2,
        index * this.spacing + audio.bass * 80,
      );
    }
  },
};

rings.grow(2);
```

The host injects context only into patch lifecycle methods. When you call
`rings.grow(2)`, you supply `2`; there is no reason to pass context.

#### Class-instance patch

Use a class for constructors, private fields, helper methods, inheritance, or many
independent instances:

```js
class Orbiters {
  #phase = 0;

  constructor({ count = 8, radius = 140, hue = 190 } = {}) {
    this.count = count;
    this.radius = radius;
    this.hue = hue;
  }

  update(dt, treble) {
    this.#phase += dt * (0.5 + treble * 3);
  }

  draw({ dt, audio }) {
    this.update(dt, audio.treble);
    for (let index = 0; index < this.count; index += 1) {
      const angle = this.#phase + index * TWO_PI / this.count;
      circle(
        width / 2 + cos(angle) * this.radius,
        height / 2 + sin(angle) * this.radius,
        12 + audio.bass * 28,
      );
    }
  }
}

const smallOrbiters = new Orbiters({ count: 5, radius: 90 });
const largeOrbiters = new Orbiters({ count: 12, radius: 220, hue: 315 });
```

These are real objects. p5js live retains their prototypes, private fields, getters,
helpers, and normal `this` behavior.

### 9. Configure and reuse patches

#### Object spread

Object spread makes a shallow variation without changing the original:

```js
const smallRings = { ...rings, count: 3, spacing: 20 };
const largeRings = { ...rings, count: 8, spacing: 50 };

const scene = [smallRings, largeRings];
```

Because both objects inherit `draw`, the method's `this` points to the variation
being drawn.

#### Factory function and closure

A factory is a function that returns a patch:

```js
const makeSparkles = (count, colour) => ({
  draw({ time, audio }) {
    for (let index = 0; index < count; index += 1) {
      const angle = index * TWO_PI / count + time * 0.2;
      fill(...colour);
      circle(
        width / 2 + cos(angle) * width * 0.3,
        height / 2 + sin(angle) * height * 0.3,
        3 + audio.treble * 15,
      );
    }
  },
});

const pinkSparkles = makeSparkles(30, [255, 70, 180]);
```

`count` and `colour` stay available through a closure. The factory runs when the
definition is evaluated; the returned object's `draw` runs every frame.

#### Inject behavior with a function

A configuration option may itself be a function. This lets a caller decide whether
a property is fixed or changes with context:

```js
const valueOf = (value, context) => (
  typeof value === "function" ? value(context) : value
);

class ReactiveDots {
  constructor({ size = 12, spin = 0.2 } = {}) {
    this.size = size;
    this.spin = spin;
  }

  draw(context) {
    const size = valueOf(this.size, context);
    const spin = valueOf(this.spin, context);
    const angle = context.time * spin;
    circle(
      width / 2 + cos(angle) * 180,
      height / 2 + sin(angle) * 180,
      size,
    );
  }
}

const reactiveDots = new ReactiveDots({
  size: ({ audio }) => 8 + audio.bass * 60,
  spin: ({ controls }) => controls.spin,
});
```

Here the constructor receives behavior. The engine still injects context only into
`draw`; `draw` deliberately passes that context to the injected functions. This is a
useful bridge between object-oriented and functional design.

---

## Part III — Compose the instrument

### 10. Build and activate scenes

A scene is ordinary JavaScript data:

```js
const scene = [
  solidBackground,
  waveLine,
  rings,
  plasma,
];

activate(scene);
```

`activate()` receives the array value, not a string. Use `activate(scene)`, not
`activate("scene")`.

To change the image, add, remove, duplicate, comment, or reorder array entries and
evaluate the scene cell. The Library's **Add to scene** action inserts at the cursor
when it is on a top-level line in the active scene array; otherwise it appends to the
bottom. The source changes first. Evaluate the scene to activate that change.

#### Use a patch twice

```js
const scene = [
  smallOrbiters,
  largeOrbiters,
  plasma,
];
```

The same named patch may also appear repeatedly:

```js
const scene = [rings, rings, rings];
```

Each occurrence receives independent runtime state. The reference identifies them as
`rings`, `rings#2`, and `rings#3`.

#### Inline patch

```js
const scene = [
  solidBackground,
  ({ time, audio }) => {
    circle(width / 2, height / 2, 60 + sin(time) * 20 + audio.bass * 100);
  },
];
```

Moving an anonymous inline patch changes its scene-path identity and starts fresh
state. Name a patch when stable identity matters.

### 11. Higher-order scene composition

A higher-order function receives or returns a function, patch, or group. Because
patches and arrays are ordinary values, scene construction can itself be creative
code.

#### Function returning a patch

```js
const onlyWhen = (test, patch) => ({
  draw(context) {
    if (!test(context)) return;

    if (typeof patch === "function") {
      patch(context);
    } else {
      patch.draw(context);
    }
  },
});

const loudRings = onlyWhen(
  ({ audio }) => audio.level > 0.35,
  rings,
);
```

The wrapper receives behavior and a patch, then returns another patch. This is a
higher-order adapter built from first-class values.

#### Function returning an array

```js
const withGlow = (patch) => [patch, bloom];

const scene = [
  solidBackground,
  withGlow(waveLine),
  vignette,
];
```

`withGlow(waveLine)` runs once when the scene cell evaluates. Its returned array is
an isolated render group. It does not run again on every frame.

A **bare** function in a scene is different: it is a patch and is called every frame.

#### Immediately invoked arrow function

Use an IIFE when a one-time scene decision should stay inline:

```js
const scene = [
  solidBackground,
  (() => {
    const choices = [neonTunnel, asciiNoise];
    return random(choices);
  })(),
  plasma,
];
```

The final `()` calls the arrow immediately. A new choice is made each time that scene
cell is evaluated, not on each frame.

Select two different patches without disturbing a required final effect:

```js
const scene = [
  solidBackground,
  (() => {
    const choices = [neonTunnel, asciiNoise, laserFan];
    return choices
      .map((patch) => ({ patch, order: random() }))
      .sort((a, b) => a.order - b.order)
      .slice(0, 2)
      .map(({ patch }) => patch);
  })(),
  plasma,
];
```

The returned array is a group. If isolation is not wanted, build the selection before
the scene and spread it into the parent:

```js
const selected = chooseTwo();
const scene = [solidBackground, ...selected, plasma];
```

Spread syntax flattens values into the parent scene. Nesting preserves the returned
array as an isolated group.

#### Conditional composition

```js
const useDiagnostics = false;

const scene = [
  solidBackground,
  neonTunnel,
  ...(useDiagnostics ? [waveLine, spectrumBars] : []),
  plasma,
];
```

#### Transform a collection of configurations

```js
const radii = [60, 120, 180];
const orbitFields = radii.map((radius, index) => (
  new Orbiters({ count: 5 + index * 3, radius })
));

const scene = [solidBackground, ...orbitFields];
```

These patterns are evaluated code that constructs the scene. They are not additional
work performed on every animation frame.

### 12. Isolate effects with nested arrays

A nested array is a transparent offscreen render group:

```js
const scene = [
  solidBackground,
  [asciiNoise, plasma],
  vignette,
];
```

The sequence is:

1. Draw `solidBackground` in the outer scene.
2. Draw `asciiNoise` into a new transparent group.
3. Apply `plasma` only to that group's pixels.
4. Composite the completed group onto the outer scene.
5. Apply `vignette` to everything assembled so far.

Groups are recursive:

```js
const scene = [
  solidBackground,
  [
    neonTunnel,
    [asciiNoise, bloom],
    plasma,
  ],
  vignette,
];
```

Nesting is not merely visual punctuation. It changes an effect's input. A sparse
transparent patch inside `[asciiNoise, plasma]` may remain sparse or dark because
Plasma cannot see an outer background. Include a richer source in the group when the
effect needs more pixels:

```js
const scene = [
  solidBackground,
  [neonTunnel, asciiNoise, plasma],
];
```

See [Nested render groups](NESTED-RENDER-GROUPS.md) for the complete rendering and
identity model.

### 13. Keep state across frames

Use `state()` for data that belongs to one occurrence of a patch:

```js
const trails = {
  state() {
    return { points: [] };
  },

  draw({ state, audio }) {
    state.points.push({ x: mouseX, y: mouseY, energy: audio.level });

    if (state.points.length > 120) {
      state.points.shift();
    }

    state.points.forEach((point) => {
      circle(point.x, point.y, 3 + point.energy * 24);
    });
  },
};
```

Keep histories bounded. An array that grows forever will eventually reduce frame
rate or exhaust memory.

Available lifecycle methods are:

| Method | When it runs |
| --- | --- |
| `state()` | Creates plain persistent state for an occurrence |
| `enter(context)` | The occurrence enters an active scene |
| `beat(context)` | A beat event occurs |
| `draw(context)` | Every animation frame |
| `exit(context)` | The occurrence leaves the active scene |
| `dispose()` | Owned resources should be released permanently |

Use `reset(patch)` to recreate state for every active occurrence of a patch.
Re-evaluating a compatible named patch normally preserves its occurrence state, which
is useful during performance.

### 14. Create live controls

Open **Tools → Controllers** and select **+ Live parameter**. Choose a continuous
control, button, or choice. The UI inserts ordinary source into a `// %% controls`
cell.

#### Continuous value

```js
control("ringSpeed", 0.5, {
  type: "continuous",
  min: 0,
  max: 4,
  step: 0.01,
});
```

#### Momentary button

```js
control("flash", false, {
  type: "button",
  mode: "momentary",
});
```

#### Toggle button

```js
control("freeze", false, {
  type: "button",
  mode: "toggle",
});
```

#### Choice

```js
control("shape", "circle", {
  type: "choice",
  choices: ["circle", "square", "line"],
});
```

Read the current values from injected context:

```js
const controlledRings = {
  draw({ controls, audio, time }) {
    if (controls.flash) {
      background(255);
    }

    const angle = controls.freeze ? 0 : time * controls.ringSpeed;
    const size = 80 + audio.bass * 160;
    circle(
      width / 2 + cos(angle) * 100,
      height / 2 + sin(angle) * 100,
      size,
    );
  },
};
```

`controls.flash` is the current Boolean value, not a control-definition object. The
definition stays in source; the context provides its live value. Re-evaluating a
`control()` declaration preserves the performer's current value when possible.

When no controls exist, the panel shows a short empty state and the create action
instead of unused sliders or buttons.

### 15. Map MIDI hardware

Web MIDI lets a physical controller change the same live controls as the onscreen UI.
The patch never needs to know a device name or MIDI message number.

1. Plug in and power on the controller.
2. Open **Tools → Controllers**.
3. Select **Connect MIDI** and permit browser access.
4. Select **Learn MIDI** beside a control.
5. Move a knob or fader, press a switch, or strike a drum pad.

Knobs and faders usually send MIDI CC values and fit continuous controls. Drum pads
and keys usually send Note On/Off messages and fit momentary or toggle buttons.
Choice controls divide the incoming range among their options.

Mappings belong to the project and are captured by safe states and named
performances. Source remains portable: another student can map different hardware to
the same control names. Web MIDI is browser-dependent; an unsupported browser leaves
all onscreen controls working.

### 16. Transform pixels with ShaderChain

Drawing patches create pixels. A `ShaderChain` is a patch that captures pixels drawn
before it and processes them on the GPU:

```js
const pixelDrift = new ShaderChain()
  .pixelate(
    ({ audio }) => 10 + audio.bass * 40,
    ({ audio }) => 10 + audio.mid * 40,
  )
  .repeatX(2, ({ audio }) => audio.treble * 0.18)
  .scrollX(({ time, audio }) => time * 0.015 + audio.treble * 0.05)
  .posterize(({ audio }) => 5 + floor(audio.mid * 5), 0.72)
  .contrast(1.15);
```

Every operator argument may be a fixed value or a function of the current context.
The chain resolves function values every frame. This is behavior injection built
into the shader API.

Use it in scene order:

```js
const scene = [
  solidBackground,
  neonTunnel,
  pixelDrift,
  vignette,
];
```

Common operators include:

- Transform: `rotate`, `scale`, `pixelate`, `repeat`, `repeatX`, `repeatY`,
  `kaleid`, `scroll`, `scrollX`, `scrollY`, `mirror`, and `crop`.
- Sampling: `blur`, `sharpen`, `edgeDetect`, `bloom`, `vignette`, `rgbSplit`,
  `feedback`, and `lumaMask`.
- Color: `posterize`, `shift`, `invert`, `contrast`, `brightness`, `luma`,
  `thresh`, `color`, `saturate`, `hue`, `colorama`, `sum`, and `rgba`.

Most operators also support wet/dry mix, blend modes, or bypass. Blend modes include
alpha, add, multiply, screen, overlay, difference, subtract, lighten, and darken.
Operator order matters because each step receives the previous step's pixels.

Place a chain inside a nested group to limit its input:

```js
const scene = [
  solidBackground,
  [waveLine, pixelDrift],
  laserFan,
];
```

For a custom WebGL class, keep GPU resources on the object, allocate them lazily,
resize as needed, and release them in `dispose()`. Custom fragment shaders commonly
receive resolution, time, audio, and the previous canvas texture as uniforms.

#### Build a custom shader patch

Use a class when the visual needs its own GLSL program or offscreen WebGL target. A
typical implementation has five responsibilities:

1. Store editable configuration on the instance.
2. Keep shader source and GPU handles in private fields.
3. Create or resize the offscreen target lazily.
4. Resolve fixed or function-valued settings and send them as uniforms each frame.
5. Release the target and program in `dispose()`.

The reusable value resolver is small:

```js
#value(setting, context) {
  return typeof setting === "function" ? setting(context) : setting;
}
```

That permits both configurations:

```js
const fixed = new MyShader({ speed: 0.4 });

const reactive = new MyShader({
  speed: ({ audio, controls }) => 0.1 + audio.mid * controls.energy,
});
```

In the patch's frame method, a source shader can render directly into its offscreen
target. A post-processor also sends `context.canvas` to a sampler such as `uScene`,
then replaces the current target with the processed image. Nested groups automatically
change which canvas arrives in `context.canvas`.

#### Adapt a ShaderToy-style fragment

Shader examples from ShaderToy and similar sites usually need a small interface
adapter rather than a conceptual rewrite:

- declare `precision highp float;` for WebGL 1;
- replace `iTime` with a uniform such as `uTime`;
- replace `iResolution.xy` with a `vec2 uResolution` uniform;
- derive pixel coordinates from the texture coordinate supplied by the vertex shader;
- wrap `mainImage(out vec4, in vec2)` in GLSL's `main()`;
- use `texture2D()` rather than APIs that require a newer GLSL version;
- send audio bands as a `vec3` uniform when desired;
- preserve the original license, author, and source URL in patch comments.

```glsl
varying vec2 vTexCoord;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uAudio;

void mainImage(out vec4 color, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * uResolution) / uResolution.y;
  float glow = 0.02 / max(0.001, abs(length(uv) - 0.3));
  color = vec4(glow * vec3(0.2, 0.7, 1.0 + uAudio.x), 1.0);
}

void main() {
  vec4 color;
  mainImage(color, vTexCoord * uResolution);
  gl_FragColor = color;
}
```

If the image is vertically inverted, flip the texture coordinate once in the adapter
with `vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);`. Do not scatter compensating
flips throughout the shader.

Long raymarch loops, supersampling, and nested procedural noise are the first places
to add quality controls. A uniform can change thresholds or distances, but GLSL loop
bounds often need compile-time-friendly limits. Test custom shaders at the intended
projection resolution before using them in a set.

### 17. Load a local video as a patch

Install the `localVideo` patch from the Library and add it to the scene. Evaluate this
ordinary method call when you want to choose or replace its file:

```js
localVideo.choose();
```

The chooser must follow a user action; browsers do not allow a project to reopen an
arbitrary local file silently.

Video patches should:

- keep the video muted;
- use a configurable playback speed;
- loop without becoming the audio source;
- draw transparently or cover the canvas according to their documented mode;
- release their element or texture in `dispose()`.

The local video file is not embedded in a performance or project export. Choose it
again after moving the project to another browser or computer.

---

## Part IV — Manage and perform

### 18. Understand the Library lifecycle

The Library uses four deliberate states:

```text
Available → Installed → Active → Running
```

- **Available**: the patch exists in the library catalog.
- **Installed**: its editable source has been added to this project.
- **Active**: an evaluated scene contains an occurrence of the patch.
- **Running**: the active occurrence evaluated and rendered successfully.

Installing never silently changes the live image. Adding to scene edits source but
also does not run it. Evaluate the scene array to activate the edit.

Use the All, Installed, and Active filters to answer different questions. Categories
separate utilities, sources/drawing patches, effects/shaders, student/community work,
and other groups without changing lifecycle meaning.

To create a new patch, use the subtle `+` in the editor gutter, enter a JavaScript
identifier, and edit the inserted object patch. To share only the current patch:

1. Leave the cursor inside its cell.
2. Open **Library → Share current patch**.
3. Export a human-readable `.p5patch.js` file or copy a link.

Opening a patch link or importing a patch file adds it under Shared patches as
Available. The recipient still chooses whether to install and activate it. This keeps
sharing from disrupting an existing performance.

### 19. Save work, performances, and projects

p5js live automatically stores the working project in the current browser. Reloading
normally restores the last editor source and project settings.

#### Named performances

A named performance is a recallable snapshot of the current window, including source,
the active scene, controls and mappings, audio-analysis settings, and view settings.

Open **Tools → Project**, enter a name, and select **Save current**. Each row can be:

- recalled;
- updated from the current window;
- deleted.

Slots have stable insertion order. New performances appear at the bottom, so adding a
performance does not renumber earlier slots.

| Command | Action |
| --- | --- |
| `Cmd/Ctrl+Option/Alt+1…9` | Recall the corresponding numbered slot |
| `Cmd/Ctrl+Option/Alt+S` | Quick-save to a new numbered slot |
| `Cmd/Ctrl+Alt+N` | Start a new performance from the starter project |
| `s` | Capture the current project as Safe State after leaving the editor |
| `0` | Restore Safe State after leaving the editor |

Quick-save reports the assigned slot in the bottom message area. Starting a new
performance does not delete named performances or stop the current music.

#### Project export and import

**Export project** creates a portable JSON file containing the working project and
all named performances. **Import project** first validates and runs the working source,
then merges valid named performances by identity. It does not delete unrelated
performances already in the browser.

Audio and local video files remain separate. Back them up beside the JSON file.

### 20. Capture and restore Safe State

Safe State is the performance emergency checkpoint. Select **Set safe** when the
current project is known to work. The snapshot records the source, installed patch
versions, active scene, live values and mappings, compatible runtime state, and other
settings required to recover.

The Project panel shows when the snapshot was created and whether the current project
differs from it. Select **Restore**, press `0`, or use the panic control to recover.
Restoration reports success and any parts that could not be restored.

A failed evaluation never replaces Safe State. Set a fresh safe state only after you
have deliberately tested the new version.

### 21. Perform without losing the last good image

Evaluation is transactional where the browser permits it:

- A syntax error leaves the last successful patch or scene running.
- A definition error leaves the last successful version registered.
- A first-frame draw error rolls back the attempted update.
- The editor flashes red and Messages explains the error.
- Re-evaluating an edited class replaces its project registration rather than
  accumulating duplicate top-level class declarations.

Use the error location and message, repair the source, and evaluate again. The failed
source remains visible so it can be fixed.

JavaScript evaluation is not a security sandbox. An infinite loop can monopolize the
browser before the host can recover. Keep loops bounded, avoid unbounded arrays, and
test expensive shaders before a public set.

### 22. Project code for an audience

There are three common performance views:

- Hide code with `e` for clean visuals.
- Keep translucent code over fullscreen output with `f`.
- Open the audience window with `p` and move it to a projector while editing in the
  main window.

The audience selector in Tools controls what the external display receives. Use the
Reference drawer during rehearsal; hide settings and diagnostics when they are not
part of the show.

### 23. Use the AI source editor carefully

The optional AI editor is a staged source assistant, not an automatic performer.
Press `Cmd/Ctrl+Option/Alt+A`, provide your own OpenAI API key, and request a patch,
parameter change, or scene edit.

The proposal appears in the editor with changed lines highlighted. It does not alter
the running visual until **Accept & run** or `Cmd/Ctrl+Enter`. Cancel or undo restores
the exact source from before the proposal. Failed proposals leave the last good visual
running.

Keys are sent directly from the browser to OpenAI. Session-only storage is the
default; remembering a key stores it on that device. Keys are not included in project
exports. A ChatGPT subscription and API billing are separate.

### 24. A reliable live-set workflow

Before rehearsal:

1. Choose and test the browser, audio output, input, and projector.
2. Install only the patches the project needs.
3. Put explicit backgrounds first and post-processing last.
4. Name important inline ideas so their identity and state stay stable.
5. Bound histories and test the heaviest scene at the target resolution.
6. Create controls and map MIDI by semantic name.
7. Save named performances in desired slot order.
8. Export the project and copy media files separately.

Before the audience arrives:

1. Reload and recall each important performance.
2. Confirm audio meters move and sound is audible.
3. Confirm the audience window or fullscreen display.
4. Set Safe State on a tested scene.
5. Keep Messages available on the operator display.

During the set:

1. Make one understandable edit at a time.
2. Evaluate the smallest relevant cell.
3. Watch for the success or error flash.
4. Quick-save discoveries worth recalling.
5. Use `0` if experimentation moves too far from the known-good state.

---

## Part V — Understand why the model works

The beginner-facing model is intentionally small, but it is not simplistic. It is
built from substantial computer-science ideas chosen to keep code expressive while a
performance remains continuous.

### 25. The design goals

p5js live is designed around one promise: **a performer can replace visual logic
without restarting the rest of the instrument**. Several goals follow from that
promise.

#### Keep the feedback loop short

The distance from an idea to a visible result should be one edit and one evaluation.
The environment supplies the continuing clock, audio analysis, canvas, controls, and
error boundary so a patch author can focus on the behavior being explored.

#### Keep unrelated work alive

Changing one patch should not restart the music, reset the clock, reconstruct every
other patch, or close the audience display. A patch is therefore a replaceable unit,
not an entire application.

#### Keep composition visible

The active composition is represented by a JavaScript array in the editor. Adding,
removing, duplicating, reordering, spreading, or nesting array entries changes the
same structure the runtime uses. Library buttons edit that visible source instead of
maintaining a hidden layer graph.

#### Keep JavaScript first-class

p5js live adds a small host API instead of inventing a separate visual language.
Functions, objects, classes, arrays, methods, closures, and higher-order functions
retain their normal JavaScript meaning. Knowledge gained here transfers to other
programming environments.

#### Keep mistakes survivable

New source is staged before it replaces working behavior. Compilation, evaluation,
validation, and first-render failures preserve or restore the last successful
version. Safe State adds a larger performer-controlled recovery point.

#### Keep the performer and audience separate

The operator needs code, messages, audio state, library tools, and recovery controls.
The audience may need only pixels, or pixels plus selected code. Separate views let
the same instrument support both needs.

#### Keep sharing inspectable

A shared patch is source text with metadata. Receiving it never silently evaluates or
activates it. The recipient can inspect, install, edit, and deliberately add it to a
scene.

#### Make advanced ideas observable

The system turns abstract ideas into immediate visual consequences:

- array order becomes layer order;
- nesting becomes rendering scope;
- identity determines whether a trail continues;
- a closure holds configuration;
- an injected function becomes changing shader behavior;
- rollback restores the last image after an error;
- a MIDI message changes a source-declared control.

This is why the architecture is useful educationally: the computer-science model is
not hidden behind the artwork. It is what makes the artwork composable and live.

### 26. The computer science inside the instrument

#### First-class values and polymorphism

A patch is a value. It can be stored in a variable, placed in an array, passed to a
function, returned from a factory, or selected from a collection. The host accepts
more than one shape of value:

```text
function                       → call function(context)
object or class instance       → call object.draw(context)
```

This is **polymorphism**: different implementations satisfy one behavioral contract.
It is also the **Strategy pattern**: the scene chooses which visual strategies are in
use without needing to know their internal algorithms.

#### Dependency injection

Patches do not construct their own analyser, global clock, MIDI manager, or canvas.
The host provides a context object each frame. This is **dependency injection**:
behavior depends on capabilities supplied from outside.

The design has two injection times:

```text
construction/evaluation time     frame time
----------------------------     ------------------------------
constructor arguments            audio
object properties                time, sceneTime, dt
closure variables                controls and keyboard
function-valued options          state and canvas
```

Construction-time values describe the patch's configuration. Frame-time context
describes the changing world. Function-valued options connect the two: an object can
be configured with a function that derives one property from current context.

#### Closures and factories

A factory separates creation from use. Its local values remain available to the
returned patch through a **closure**:

```js
const makePulse = (base, response) => ({
  draw({ audio }) {
    circle(width / 2, height / 2, base + audio.bass * response);
  },
});
```

`base` and `response` are private configuration without a class. A factory can also
return a class instance or a nested group.

#### Higher-order functions

A function is **higher-order** when it accepts or returns behavior. In p5js live this
can happen at two different rates:

- A scene factory such as `withGlow(patch)` runs when its scene code is evaluated.
- A function-valued shader argument such as `({ audio }) => audio.bass` runs each
  frame.

Understanding evaluation time prevents accidental work. A one-time composition
decision belongs outside the frame loop; a musical response belongs inside it.

#### Recursive data and the Composite pattern

A scene is a recursive data structure:

```text
Scene item = Patch | Group
Group      = Array<Scene item>
```

A flat array is an ordered stack. A nested array is both a child collection and one
composited result in its parent. This is the **Composite pattern**: individual patches
and groups participate in one recursive tree while groups introduce a rendering
boundary.

The simple syntax supports arbitrary depth because the host traverses the tree
recursively. Each group receives a transparent offscreen target, renders its children,
and returns the completed image to its parent.

#### Object-oriented encapsulation

Class-instance patches use objects as durable owners of behavior and resources:

- constructor arguments establish configuration;
- public properties expose live-coding opportunities;
- methods divide an algorithm into understandable operations;
- private fields protect implementation details;
- `dispose()` closes resources owned by the instance.

The host retains the real object rather than copying it into a literal form, so
prototypes, getters, private fields, and normal `this` behavior remain intact.

#### Identity and state

Behavior and state change on different schedules. Re-evaluating a patch replaces its
behavior, but the active scene slot retains its identity. State is stored against that
identity, allowing a trail, simulation, or phase to continue through code edits.

```text
shared by repeated copies       unique to each occurrence
-------------------------       -------------------------
implementation                  instance identifier
source and version              state object
methods                         enter/exit membership
```

The first occurrence uses the patch name; additional occurrences use `name#2`,
`name#3`, and so on. Anonymous patches use paths such as `scene[1][0]`. Moving an
anonymous patch changes its path and therefore its identity.

#### Lifecycle and event dispatch

Lifecycle methods turn continuous frame processing and discrete events into a common
object protocol. The host dispatches `enter`, `beat`, `draw`, `exit`, and `dispose` at
defined transitions. A patch can implement only the methods it needs.

This separates *when* something happens from *what* a patch does in response. Beat
detection occurs once in shared infrastructure; every interested patch receives the
same event.

#### Data-oriented audio processing

The analyser produces one immutable snapshot per frame. All patches read the same
snapshot instead of running separate FFT calculations. Scalar features are convenient
derived data; waveform and spectrum remain arrays for more detailed algorithms.

Sharing one snapshot provides temporal consistency: every patch in a frame sees the
same level, bands, beat decision, waveform, and spectrum.

#### GPU pipeline composition

Drawing patches contribute pixels. `ShaderChain` compiles ordered operations into one
fragment-shader program and treats the pixels produced so far as a texture. Each
operator transforms coordinates, samples pixels, or changes color; operator order is
function composition over an image.

Nested arrays introduce texture scope. An effect inside a group samples that group's
current pixels, while an outer effect samples the already-composited parent image.

#### Separation of model, controller, and views

Internally, responsibilities are separated even though the interface feels like one
instrument:

```text
editor source
     ↓
evaluator → registry → host frame → canvas
                ↕            ↑
          state store    audio + controls
                ↓
            controller → tools / reference / audience views
```

- The evaluator turns selected source into staged values and commands.
- The registry owns patch definitions, scene trees, versions, and status.
- The state store owns per-occurrence state.
- The host advances frames and dispatches lifecycle calls.
- The controller exposes data-only snapshots and named actions.
- Views display state and request actions without owning the runtime model.

This separation lets the code editor, Library, Reference drawer, status bar, and
audience window observe one model without becoming competing sources of truth.

### 27. Transactional replacement, identity, and recovery

Live replacement is handled like a small transaction. The new code must pass several
gates before it becomes the confirmed version.

| Phase | What happens | If it fails |
| --- | --- | --- |
| Compile | JavaScript is compiled from the selected cell or statement | Nothing changes |
| Execute | Declarations and live commands run in a staging environment | Nothing changes |
| Validate | Patch forms, scene entries, and command targets are checked | Nothing changes |
| Snapshot | State for affected occurrences is cloned when possible | Code can proceed; unclonable state is reported |
| Queue | Valid changes wait for the next frame boundary | No half-updated frame appears |
| Candidate | Every active occurrence tries the new behavior once | Previous behavior, scene, and compatible state are restored |
| Confirm | The candidate becomes the successful version | History records the version |

#### Why the frame boundary matters

An evaluated patch can finish in the middle of a displayed frame. Applying it
immediately could produce a scene in which some patches used old definitions and
others used new ones. Queuing replacement until the frame boundary makes the change
atomic from the audience's perspective.

#### Why the first frame matters

Compilation proves that code is syntactically valid; it does not prove that a draw
will succeed. A missing variable, bad WebGL call, or unexpected state may fail only
when the candidate first runs. Confirmation is therefore delayed until every active
copy completes one frame.

#### Bindings make source values persistent

Successful top-level declarations become an evaluation environment for later cells.
This is why a scene cell can refer to a patch evaluated earlier and why ordinary
method calls can operate on the retained object. Re-evaluating a named cell replaces
that binding deliberately instead of redeclaring it in one accumulating global scope.

An explicit `// %% patch name` cell groups a class, factory, and constructed instance
into one replaceable unit. During full-buffer evaluation, accidental duplicate patch
cells are collapsed to the newest copy so duplicate `class` or `const` declarations
do not break recovery.

#### Three different kinds of recovery

| Mechanism | Purpose | Scope |
| --- | --- | --- |
| Automatic rollback | Reject one failed evaluation | Previous definition, binding, scene configuration, and clone-compatible affected state |
| Safe State | Performer-controlled emergency checkpoint | Source, definitions, versions, scene tree, controls, mappings, and clone-compatible instance state |
| Named performance | Deliberate recall point | Source, active scene name, controls/mappings, audio-analysis settings, and view settings |

Browser-local autosave provides restart persistence, while project export provides a
portable backup. These mechanisms overlap by design but serve different moments:
rollback protects an edit, Safe State protects a set, a performance supports recall,
and export protects the project outside one browser.

#### The limits of transactions

The evaluator can catch thrown errors but cannot interrupt JavaScript that never
returns. An infinite loop can freeze the tab before rollback is possible. Browser and
GPU resources also cannot always be cloned. Keep serializable simulation data in
`state`, keep live resource handles on their owning object, and release those handles
in `dispose()`.

---

## Part VI — Practice and reference

### 28. Patterns worth practicing

#### One value, many destinations

```js
control("energy", 0.5, { type: "continuous", min: 0, max: 1, step: 0.01 });

const sharedEnergy = new ShaderChain()
  .scale(({ controls }) => 1 + controls.energy * 0.3)
  .saturate(({ controls }) => 0.7 + controls.energy * 1.8);
```

A single musical gesture can coordinate several visual dimensions.

#### Audio plus performer intent

```js
const size = ({ audio, controls }) => (
  20 + audio.bass * 180 * controls.energy
);
```

Audio supplies motion; the performer supplies its range.

#### Select a visual algorithm

```js
control("mode", "rings", {
  type: "choice",
  choices: ["rings", "orbiters", "scope"],
});

const selector = {
  draw(context) {
    const choices = {
      rings,
      orbiters: smallOrbiters,
      scope: waveLine,
    };

    const selected = choices[context.controls.mode];
    if (typeof selected === "function") selected(context);
    else selected.draw(context);
  },
};
```

This is the Strategy pattern expressed with first-class patch values. It is best for
stateless choices because all choices are being called through one scene occurrence.
For stateful choices, select the patch while constructing the scene so the host can
give each selected occurrence its own lifecycle and state.

#### Scene recipe as a higher-order function

```js
const visualSandwich = (source, effect, overlay) => [
  solidBackground,
  [source, effect],
  overlay,
];

const scene = visualSandwich(neonTunnel, plasma, vignette);
activate(scene);
```

The function captures a compositional rule while leaving the ingredients open.

### 29. Interface reference

#### Stage and editor

| Area | Purpose |
| --- | --- |
| Stage | The current visual output and background behind the editor |
| Folded cells | Compact overview of patch and scene units |
| Expanded editor | Editable source, line numbers, selection, and fold controls |
| Runtime bar | FPS, Running/Active/Installed counts, and the latest status message |
| Transport | File playback and looping controls that remain available during editing |

Line numbers always refer to the complete source buffer. When cells are folded, the
hidden lines still exist, so the next visible cell may begin at a much larger number.
This is intentional: an error line and an editor line always refer to the same source.

The status counts answer different questions:

- **Installed**: how many patch sources are in the project.
- **Active**: how many patch occurrences are in the evaluated scene.
- **Running**: how many active occurrences have rendered successfully.

#### Tools drawer

Open or close Tools with `Cmd/Ctrl+\`.

| Panel | Main tasks |
| --- | --- |
| **Audio** | Inspect the source and playback position, choose an input device, loop, adjust smoothing, and enable or disable auto-gain |
| **Library** | Browse Available/Installed/Active patches, install source, add to scene, insert the demo, share a patch, and view shader names |
| **Messages** | Read diagnostics and revert to a successful patch version from Evaluation history |
| **Project** | Save and recall performances, set or restore Safe State, import/export/reset a project, set the FPS warning, and tune drawer opacity and code size |
| **AI** | Configure the optional staged source assistant, inspect its proposal, and accept or cancel it |
| **Controllers** | Declare live controls, operate them onscreen, connect MIDI, learn or remove mappings, and see connected devices |

The Network implementation is beta and the current interface reports network
streaming as temporarily unavailable. Treat [Networking](NETWORKING.md) as developer
documentation rather than a dependable performance workflow in this release.

#### Library filters and groups

The **All**, **Installed**, and **Active** filters select lifecycle views; they do not
change source or runtime state. Library groups describe purpose or origin:

- Utilities
- Sources / drawing patches
- Effects / shaders
- Community patches
- Shared patches

Each patch row includes an explicit lifecycle label and action. **Install source**
adds source. **Add to scene** edits the scene array. **In active scene** is read-only
confirmation, not an install action.

#### Reference drawer

The Reference drawer lists installed patches and their public properties and methods.
It reads descriptors without invoking getters. **Jump to source** navigates the editor
but never evaluates code or changes the scene.

#### Audience output

Open the audience window with `p`. The audience selector supports:

| Layout | Audience receives |
| --- | --- |
| **canvas** | Clean rendered output |
| **canvas + code** | Output with selected code presentation |
| **canvas + trace** | Output with the evaluation trace presentation |

Keep the operator window on the computer display and move the audience window to the
projector or external display.

### 30. Keyboard reference

Keyboard behavior depends on focus. Editor commands work while the caret is in code.
Single-key performance commands work after pressing `Esc` to release editor focus.

#### Editor and global commands

| Command | Action |
| --- | --- |
| `Cmd/Ctrl+Enter` | Evaluate the current cell or complete top-level statement |
| `Cmd/Ctrl+Shift+Enter` | Evaluate the complete source buffer |
| `Cmd/Ctrl+/` | Add or remove one reversible comment layer |
| `Cmd/Ctrl+Option/Alt+T` | Tidy indentation in the current cell without evaluating |
| `Cmd/Ctrl+Shift+Up/Down` | Move the current line or selected consecutive lines |
| `Cmd/Ctrl+Z` | Undo; add Shift to redo |
| `Enter` | Insert a line with context-aware indentation |
| `Tab` / `Shift+Tab` | Indent or outdent the current line or selection |
| `Cmd/Ctrl+Alt+[` | Fold all objects, functions, classes, and scenes |
| `Cmd/Ctrl+Alt+]` | Unfold all and retain individual fold controls |
| `Cmd/Ctrl+Alt+/` | Open or close the command sheet while editing |
| `Cmd/Ctrl+Option/Alt+A` | Open the AI source editor |
| `Cmd/Ctrl+Option/Alt+1…9` | Recall the corresponding stable performance slot |
| `Cmd/Ctrl+Option/Alt+S` | Quick-save to a new performance slot |
| `Cmd/Ctrl+Alt+N` | Start a new performance from the starter source |
| `Cmd/Ctrl+\` | Open or close Tools |
| `Esc` | Release editor focus |

`Option/Alt+Up/Down` also moves lines in browsers that do not reserve that shortcut.
The `Cmd/Ctrl+Shift+Up/Down` form is the portable choice.

#### Performance commands after `Esc`

| Key | Action |
| --- | --- |
| `Space` | Play or pause a loaded audio file |
| `0` | Restore Safe State |
| `s` | Capture the current confirmed project as Safe State |
| `r` | Show or hide the installed-patch Reference drawer |
| `e` | Show or hide code |
| `f` | Enter or leave fullscreen |
| `p` | Open or close the audience window |
| `l` | Toggle audio-file looping |
| `a` | Choose an audio file |
| `m` | Start live microphone/input audio |
| `?` | Open or close the command sheet |

Physical keyboard state is also available to patches through `context.keyboard`; a
performance key that the interface handles can therefore have both interface and
patch implications. Prefer non-command keys for patch-specific interaction.

### 31. Runtime reference

#### Accepted patch forms

```js
const functionPatch = (context) => {};

const objectPatch = {
  draw(context) {},
};

class PatchClass {
  draw(context) {}
}
const classPatch = new PatchClass();
```

A function becomes a patch when a scene references it or when it is the named value
of an explicit patch cell. An object is a patch when it has a callable `draw` method.
A class declaration by itself is a constructor, not a patch; place an instance in the
scene.

#### Context fields

| Field | Type | Meaning |
| --- | --- | --- |
| `audio` | object | Shared immutable audio snapshot for the frame |
| `canvas` | p5 renderer | Current render target; the main canvas or current nested group |
| `state` | object | Persistent data unique to this scene occurrence |
| `dt` | number | Seconds since the previous frame, capped at `0.1` after a stall |
| `time` | number | Seconds since the instrument clock began |
| `sceneTime` | number | Seconds since the active scene changed |
| `controls` | object | Current values from `control()` declarations |
| `keyboard` | object | Read-only keyboard state with `keys`, `shift`, and `alt` |

`keyboard.keys` is a `Set` of currently held `event.key` values:

```js
const keyboardDot = ({ keyboard }) => {
  const x = keyboard.keys.has("ArrowLeft") ? width * 0.3 : width * 0.7;
  circle(x, height / 2, keyboard.shift ? 100 : 40);
};
```

The same context object is reused for efficiency; treat its shared fields as
read-only. Store persistent patch data in `state` or on the patch object as
appropriate.

#### Audio fields

| Field | Range/type | Meaning |
| --- | --- | --- |
| `audio.level` | generally `0..1` | Normalized overall amplitude |
| `audio.bass` | generally `0..1` | Normalized low-frequency energy |
| `audio.mid` | generally `0..1` | Normalized middle-frequency energy |
| `audio.treble` | generally `0..1` | Normalized high-frequency energy |
| `audio.beat` | Boolean | Onset decision for this frame |
| `audio.spectrum` | array of `0..255` | FFT magnitude bins |
| `audio.waveform` | array of `-1..1` | Time-domain samples |
| `audio.sampleRate` | number | Samples per second reported by the audio context |
| `audio.nyquist` | number | Highest represented frequency, half the sample rate |
| `audio.raw` | object | Original scalar features plus the same spectrum and waveform arrays |

With no source, the host supplies a silent snapshot so patches can continue running.
All patches in one frame receive the same analysis.

#### Lifecycle methods

| Method | Contract |
| --- | --- |
| `state()` | Return a plain object used as initial per-occurrence state |
| `enter(context)` | Called once when the occurrence enters the active scene |
| `beat(context)` | Called on a frame whose shared audio snapshot reports a beat |
| `draw(context)` | Called once per active frame; required for object/instance patches |
| `exit(context)` | Called when the occurrence leaves the active scene |
| `dispose()` | Release resources when the implementation is permanently replaced or discarded |

Lifecycle methods run with the patch object as `this`. State intended for rollback or
Safe State should contain numbers, strings, booleans, arrays, and plain objects that
`structuredClone` can copy. Keep DOM nodes, WebGL handles, media elements, and other
resources on the owning object rather than in `state`.

#### Live commands

| Command | Result |
| --- | --- |
| `activate(scene)` | Queue the supplied scene array as active at a frame boundary |
| `reset(patch)` | Recreate state for every active occurrence of the supplied patch value |
| `control(name, initial, options)` | Declare or update a project-wide live control; current performer value is preserved on reevaluation |

Commands accept actual JavaScript values. Use `activate(scene)` and `reset(rings)`,
not string names.

Control value types are number, Boolean, or string:

```js
control("amount", 0.5, {
  type: "continuous",
  min: 0,
  max: 1,
  step: 0.01,
});

control("gate", false, {
  type: "button",
  mode: "momentary", // or "toggle"
});

control("mode", "rings", {
  type: "choice",
  choices: ["rings", "grid", "scope"],
});
```

#### Scene and identity rules

| Source form | Runtime meaning |
| --- | --- |
| `[a, b, c]` | Flat scene or group, processed left to right |
| `[a, [b, effect], c]` | `b` and `effect` render in an isolated transparent group |
| `[...group]` | Group members are inserted into the parent; no isolation |
| `factory()` | Factory runs during evaluation; returned patch or array is retained |
| bare function in scene | Function is invoked as a patch each frame |
| repeated named patch | Shared implementation with independent occurrence state |
| anonymous patch | Identity is its recursive zero-based scene path |

#### ShaderChain methods

Every operator argument, `.mix(amount)`, and most numeric options may be either a
fixed value or a function receiving current context.

Chain-level methods:

| Method | Meaning |
| --- | --- |
| `.mix(amount)` | Wet/dry amount |
| `.blend(mode)` | `alpha`, `add`, `multiply`, `screen`, `overlay`, `difference`, `subtract`, `lighten`, or `darken` |
| `.bypass(enabled = true)` | Skip or re-enable the chain without deleting it |
| `.clear()` | Remove all operators from the chain |
| `.clone()` | Create a separate chain with copied operators and chain settings |

Transform and coordinate operators:

| Method | Arguments |
| --- | --- |
| `.transform(x, y, scaleX, scaleY, angle, anchorX, anchorY)` | Complete normalized transform |
| `.mirror(horizontal, vertical)` | Axis reflection amounts |
| `.crop(left, right, top, bottom)` | Normalized visible bounds |
| `.noiseWarp(amount, scale, speed)` | Animated value-noise displacement |
| `.rotate(angle, speed)` | Angle and optional continuous speed |
| `.scale(amount, xMult, yMult, offsetX, offsetY)` | Zoom, axis multipliers, and offset |
| `.pixelate(pixelX, pixelY)` | Horizontal and vertical cell counts |
| `.repeat(repeatX, repeatY, offsetX, offsetY)` | Two-axis tiling with alternating offsets |
| `.repeatX(reps, offset)` | Horizontal tiling |
| `.repeatY(reps, offset)` | Vertical tiling |
| `.kaleid(sides)` | Radial mirrored segments |
| `.scroll(x, y, speedX, speedY)` | Two-axis offset and speed |
| `.scrollX(x, speed)` | Horizontal offset and speed |
| `.scrollY(y, speed)` | Vertical offset and speed |

Sampling and temporal operators:

| Method | Arguments |
| --- | --- |
| `.blur(radius)` | Blur radius |
| `.sharpen(amount)` | Sharpening amount |
| `.edgeDetect(amount, radius)` | Edge amount and sample radius |
| `.bloom(amount, radius, threshold)` | Glow amount, radius, and brightness threshold |
| `.vignette(amount, softness)` | Edge darkening and transition softness |
| `.rgbSplit(amount, angle)` | Channel separation and direction |
| `.feedback(amount, decay, zoom)` | Previous-frame amount, decay, and zoom |
| `.lumaMask(threshold, softness, invert)` | Luminance cutoff, softness, and inversion |

Color operators:

| Method | Arguments |
| --- | --- |
| `.posterize(bins, gamma)` | Color levels and gamma |
| `.shift(r, g, b, a)` | Per-channel shift |
| `.invert(amount)` | Inversion amount |
| `.contrast(amount)` | Contrast multiplier |
| `.brightness(amount)` | Brightness adjustment |
| `.luma(threshold, tolerance)` | Luminance key |
| `.thresh(threshold, tolerance)` | Threshold and transition tolerance |
| `.color(r, g, b, a)` | Color multiplication/tint values |
| `.saturate(amount)` | Saturation multiplier |
| `.hue(amount)` | Hue rotation |
| `.colorama(amount)` | Nonlinear color cycling amount |
| `.sum(scale)` | Sum RGB channels with scaling |
| `.rgba(r, g, b, a)` | Explicit channel weighting |

`ShaderChain` is single-input: it processes the pixels already present in its current
scene or nested-group scope. Use nested groups to choose that input scope. Arbitrary
multi-texture routing requires a custom WebGL patch.

#### p5.js drawing surface

Normal p5 drawing functions, math helpers, constants, dimensions, and input globals
are available in patch code. See the official
[p5.js reference](https://p5js.org/reference/) for the broad drawing API. p5js live
adds the patch, scene, context, control, and replacement model described here.

### 32. Files, sharing, and persistence reference

#### What each save mechanism contains

| Mechanism | Stored data | Where it lives | Primary use |
| --- | --- | --- | --- |
| Browser autosave | Working source, Safe Scene preference, live-control values, and MIDI mappings | Current browser profile and origin | Survive refresh/restart |
| Named performance | Source, active scene name, Safe Scene preference, values/mappings, audio-analysis and loop settings, and view settings | Browser storage; also included in project export | Fast recall during a set |
| Safe State | Exact confirmed definitions and bindings, version data, recursive active scene, controls/mappings, source, and clone-compatible occurrence state | Current running session | Emergency rollback |
| Project file | Working project plus every named performance | Downloaded JSON file | Backup and transfer |
| Patch file | One source cell plus metadata | `.p5patch.js` file | Share one patch |
| Patch link | One patch's source encoded in the URL fragment | Copied URL | Quick source exchange |

Audio and local-video files are not embedded in any project or performance. Compiled
functions and live browser resource handles are also not serialized.

#### New performance, reset, and reload

- **Reload** restores the last browser-autosaved working source and settings.
- **New performance** loads the starter source while preserving saved performances
  and the current music/canvas session.
- **Reset project** discards the working project and returns to the starter. Export a
  backup first when any current work matters.
- **Recall** runs the selected performance source and restores its saved settings. A
  failed recall restores the previous working performance.

#### Project import behavior

Import validates the JSON format and asks the normal evaluator to run its working
source. Only successful source becomes current. Named performances are merged by
identity: matching records update and unrelated browser-local performances remain.

Because imported source is executable JavaScript, review and trust it before allowing
it to run.

#### Portable patch format

A shared patch uses this source header:

```js
// %% patch myPatch
// @title My Patch
// @author Your Name
// @description One sentence explaining what it does.
// @category community
// @version 1

const myPatch = {
  draw({ audio }) {
    circle(width / 2, height / 2, 20 + audio.bass * 200);
  },
};
```

The binding after `// %% patch` must be a valid JavaScript identifier and should match
the exported patch binding. Valid categories are `visual`, `utility`, `shader`, and
`community`. Browser sharing supplies friendly defaults for missing optional metadata,
but community catalog contributions require title, author, description, and category.

Importing a patch or opening a patch link stores it under Shared patches as Available.
It does not install, evaluate, activate, or run the source.

#### Add a repository community patch

1. Put one `.js` source file in `community-patches/`.
2. Include the required marker and metadata shown above.
3. Keep loops, histories, and resource use bounded.
4. Run `npm run build:patches`.
5. Run the relevant tests and inspect the patch before sharing the change.

The build validates metadata and generates `src/generated/communityPatches.js` as
catalog data. Do not edit the generated file directly. See the
[community patch guide](../community-patches/README.md).

### 33. Product limits and safety

#### Trusted code, not a sandbox

p5js live evaluates JavaScript with `new Function`. Evaluated code can access browser
globals and same-origin data, allocate excessive memory or GPU resources, or enter an
infinite loop. Use source only from people you trust and review imports before
evaluation.

Errors that throw can be caught. Code that never yields control cannot be interrupted
by the evaluator. Safe State is recovery, not isolation from hostile code.

#### Browser-dependent capabilities

- Web Audio requires an explicit user gesture before sound can start.
- Audio codec support varies by browser and operating system.
- Direct MIDI uses Chrome's Web MIDI support. Onscreen controls work without hardware.
- Fullscreen, multiple windows, local file pickers, and autoplay remain subject to
  browser permissions.
- Browser storage is local to one browser profile and site origin. `localhost`,
  `127.0.0.1`, and the hosted site do not share saved projects.

#### Current product boundaries

- OSC is not implemented.
- Recording and deterministic event replay are not implemented.
- `ShaderChain` processes one current canvas texture; arbitrary multi-source routing
  needs custom WebGL code.
- Audio and local media are not included in project exports.
- Network streaming code is beta and the current interface marks it temporarily
  unavailable.
- The included networking architecture is intended for small peer groups, not a large
  broadcast audience.

#### Network developer API (beta)

`StreamRoom` remains available to expert projects and development deployments even
though the current interface marks network streaming temporarily unavailable. Treat
it as an experimental API, configure the required signaling infrastructure, and do
not depend on it for a set without testing the exact deployment.

```js
const room = new StreamRoom({
  name: "warehouse-stage",
  performer: "Maya",
});

const remoteParticles = room.receive({
  stream: "Alex/particles",
  fit: "cover",       // "cover", "contain", or "stretch"
  opacity: 1,
});

const publishMain = room.publish({
  name: "main-output",
  fps: 30,
});

const scene = [remoteParticles, plasma, publishMain];
activate(scene);
```

`receive()` and `publish()` return normal lifecycle patches. Publication is explicit
and video-only. A receiver progresses through waiting, connecting, live, and stalled
states without throwing merely because a peer leaves. Its `texture` becomes a stable
p5 media source after a track arrives. See [Networking](NETWORKING.md) for signaling,
deployment, source selection, security, and peer-mesh limits.

#### Performance boundaries

The project targets live use, but patch code determines the final cost. Common sources
of slowdown are unbounded state arrays, per-frame DOM work, repeated graphics-buffer
allocation, deeply nested full-resolution groups, expensive raymarching, too many
full-canvas effects, and high pixel density.

Use `dt` for frame-rate-independent motion, keep histories bounded, allocate durable
resources once, release them in `dispose()`, and use the Project panel's FPS threshold
as an early warning rather than a guarantee.

#### AI and secret handling

AI proposals are untrusted source and should be reviewed before acceptance. API keys
are sent from the browser directly to OpenAI. Session storage is safest on shared
machines; the remember option stores the key in that browser. Keys are excluded from
project exports.

See [Security](../SECURITY.md) for the full trust boundary.

### 34. Troubleshooting

#### The music plays, but the canvas is blank

- Open Messages and look for an evaluation or first-frame error.
- Confirm the scene cell was evaluated.
- Confirm the Library marks expected patches Active or Running.
- Add an explicit `solidBackground` while diagnosing.
- Remember that an isolated shader group cannot see pixels outside the group.

If the runtime bar reports `0 running`, evaluate the scene cell. If it reports active
patches but fewer Running patches, open Messages to find the patch that failed.

#### A patch is Installed but not visible

Installed only means source is in the project. Add the patch to the scene array, then
evaluate the scene.

If **Add to scene** changed the source, move the cursor into that scene cell and press
`Cmd/Ctrl+Enter`. Installation and source insertion are deliberately separate from
activation.

#### A nested group is unexpectedly black or faint

The group starts transparent. Put drawing content before its effect inside the group.
An outer background is intentionally not sampled by an inner effect.

Compare the flat and isolated forms:

```js
const flat = [solidBackground, asciiNoise, plasma];
const isolated = [solidBackground, [asciiNoise, plasma]];
```

If `flat` works and `isolated` is faint, the effect needs a richer or opaque source
inside its group.

#### The source changed, but the image did not

Typing does not evaluate. Put the cursor in the edited cell and press
`Cmd/Ctrl+Enter`. If you changed array membership, evaluate the scene cell. If you
changed a factory that constructs the scene, reevaluate the code that calls that
factory.

Look for a red evaluation flash or error message. Failed source remains visible for
repair while the previous version remains on stage.

#### Line numbers seem to skip

Folded cells hide source lines without renumbering the file. A visible cell may start
at line 112 because lines 1–111 are folded above it. Unfold all with
`Cmd/Ctrl+Alt+]` to see the continuous source.

#### A class reports a duplicate declaration

Keep the class and its constructed patch value in one explicit patch cell:

```js
// %% patch myEffect
class MyEffect {
  draw() {}
}

const myEffect = new MyEffect();
```

Evaluate that cell as a unit. Current full-buffer evaluation repairs accidental
duplicate explicit patch cells by keeping the newest source. If an older project has
unmarked duplicate declarations, remove the older copy.

#### MIDI does not connect

- Confirm the browser supports Web MIDI.
- Connect and power on hardware before selecting Connect MIDI.
- Grant the browser permission.
- Use MIDI Learn, then move or press one physical control clearly.
- Use an onscreen control when the browser does not support MIDI.

If Learn succeeds but values do not change, confirm that the declared control type
matches the hardware gesture: continuous for knobs/faders, momentary or toggle for
pads/switches, and choice for a discrete menu.

#### The instrument was opened in another browser

p5js live targets current desktop Google Chrome. Open the same URL in Chrome before
diagnosing audio, MIDI, shader, fullscreen, or performance behavior. Browser-local
projects do not automatically move between browsers; export the project from the old
browser and import it in Chrome when necessary.

#### A local video does not appear

Install and activate `localVideo`, then explicitly evaluate:

```js
localVideo.choose();
```

Select a browser-supported video. The file cannot be restored automatically after
moving or reopening a project, and the video remains silent by design.

#### A shader fails or produces a solid color

- Put a visible drawing source before the effect in the same render scope.
- Open Messages for a shader compilation or uniform error.
- Reduce the chain to one operator, then restore operators one at a time.
- Confirm dynamic argument functions return finite numbers.
- For a custom shader, confirm resolution, texture, time, and audio uniforms match
  the program's declarations.

#### Old source returns after reloading

The browser automatically restores the last working project. Use New performance for
the starter or import the intended project.

Remember that storage is origin-specific. Opening `localhost`, `127.0.0.1`, and the
hosted site can reveal different browser-local projects.

#### The frame rate falls

Look for arrays that grow forever, large nested loops, too many full-canvas effects,
high-resolution shaders, and repeated allocation in `draw()`. Reduce shader passes or
resolution and keep persistent buffers bounded.

Use `dt` rather than assuming a fixed frame rate. If one patch is suspect, comment it
out of the scene and evaluate the scene; then restore simpler settings or a known-good
version from Messages.

#### The browser freezes

An infinite loop or blocking operation cannot be caught while it is still running.
Reload the tab. If startup recovery can isolate the failed source, repair or remove
the offending cell before evaluating it again. Otherwise export any recoverable work
and use Project reset only as a last resort.

#### A performance will not recall

Open Messages. Recall evaluates the performance's source before applying its saved
settings. If that evaluation fails, p5js live restores the performance that was
running before recall. Update or delete the broken saved performance after recovering
its source.

#### Import or export is incomplete

Project JSON contains source, controls, mappings, and named performances, but not audio
or local-video files. Move those media files separately. Patch export contains only
the cell under the cursor, not its external dependencies; include or document any
helper it requires.

### 35. Glossary

- **Active**: present in the currently evaluated scene.
- **Available**: present in the Library catalog.
- **Binding**: a retained top-level JavaScript name and its current successful value.
- **Candidate**: a staged patch version waiting to survive its first active frame.
- **Cell**: an independently foldable and evaluable source unit.
- **Context**: live values injected into a patch each frame.
- **Control**: a named live value usable onscreen or through MIDI.
- **Dependency injection**: receiving shared capabilities from the host rather than
  constructing them inside every patch.
- **Evaluation**: compiling and executing selected source so a valid change can be
  staged for the runtime.
- **Factory**: a function that creates and returns a patch or group.
- **FFT**: frequency analysis that produces spectrum bins and frequency bands.
- **First-class value**: a value that can be stored, passed, returned, or placed in a
  collection; patches have this property.
- **Frame boundary**: the transition between displayed frames when queued changes can
  be applied atomically.
- **Higher-order function**: a function that accepts or returns behavior or patches.
- **Installed**: editable patch source has been added to the project.
- **Instance/occurrence**: one position occupied by a patch in the active scene, with
  its own identity and state.
- **Nested render group**: an isolated transparent offscreen scene array.
- **Patch**: a function, drawing object, class instance, or pixel effect used in a
  scene.
- **Performance**: a named, recallable snapshot of the working window.
- **Polymorphism**: different forms satisfying one contract, such as functions and
  objects both serving as patches.
- **Rollback**: automatic restoration after a candidate fails its first active frame.
- **Running**: an active patch has evaluated and rendered successfully.
- **Safe State**: the explicit known-good recovery snapshot.
- **Scene**: an array of patches and nested groups in render order.
- **ShaderChain**: a configurable GPU post-processing patch.
- **Strategy pattern**: choosing interchangeable behavior through a common contract;
  a patch is the product-level name for such visual behavior.
- **Structured clone**: the browser's copying model used for recoverable plain state.
- **Transaction**: a multi-phase change that either confirms as a complete update or
  leaves/restores the previous working version.

### 36. Where to continue

- [API reference](API.md): exact patch, context, lifecycle, control, audio, and shader
  behavior.
- [Nested render groups](NESTED-RENDER-GROUPS.md): recursive isolation, state, and
  error behavior.
- [Architecture](ARCHITECTURE.md): how editor, evaluator, registry, host, persistence,
  and views are separated.
- [Networking](NETWORKING.md): optional peer-to-peer canvas sharing.

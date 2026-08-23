# Using p5js live

p5js live keeps one p5 host running while you replace patches and scenes. Code is
ordinary JavaScript. For exact fields and lifecycle behavior, see the
[API reference](API.md).

## Start

```sh
npm ci
npm run dev
```

Open `http://localhost:5173/live/` and choose an audio file, microphone, or silence.
Put the cursor in a patch or scene and press `Cmd/Ctrl+Enter`. Use
`Cmd/Ctrl+Shift+Enter` to evaluate the complete buffer.

## Write a patch

A patch can be a function, an object with `draw()`, or a class instance.

### Function

```js
function pulse({ time, audio }) {
  const size = 80 + sin(time * 2) * 30 + audio.bass * 160;
  circle(width / 2, height / 2, size);
}
```

### Object

```js
const rings = {
  count: 8,
  spacing: 24,

  grow(amount) {
    this.spacing += amount;
  },

  draw({ audio }) {
    noFill();
    for (let i = 1; i <= this.count; i += 1) {
      circle(width / 2, height / 2, i * this.spacing + audio.bass * 80);
    }
  },
};

rings.grow(2);
```

p5js live supplies the live context to `draw()`. You supply arguments to methods such
as `grow()`.

### Class instance

```js
class Orbiters {
  constructor(count, radius) {
    this.count = count;
    this.radius = radius;
  }

  draw({ time, audio }) {
    for (let i = 0; i < this.count; i += 1) {
      const angle = time + i * TWO_PI / this.count;
      const radius = this.radius + audio.mid * 100;
      circle(
        width / 2 + cos(angle) * radius,
        height / 2 + sin(angle) * radius,
        12,
      );
    }
  }
}

const orbiters = new Orbiters(12, 140);
```

Use a function for a small stateless patch, an object for properties and methods,
and a class for constructors, private fields, inheritance, or several instances.

## Use the live context

p5js live passes one object to each patch. Destructure only what you need.

| Field | Value |
| --- | --- |
| `time` | Host time in seconds |
| `sceneTime` | Seconds since the scene changed |
| `dt` | Seconds since the previous draw |
| `audio` | Level, bands, beat, and plain-array spectrum/waveform data |
| `state` | Persistent data for this occurrence of the patch |
| `canvas` | Main p5 renderer; also usable as a shader source |
| `params` | Values created with `param()` |
| `controls` | Read-only keyboard state |

p5 globals such as `circle`, `fill`, `noise`, `width`, and `height` remain available.

## Compose a scene

A scene is an array in layer order. Later patches draw over or post-process earlier
ones.

```js
const scene = [
  solidBackground,
  waveScope,
  rings,
  plasma,
];

activate(scene);
```

An inline function is also a patch:

```js
const scene = [
  ({ time, audio }) => {
    const size = 80 + sin(time) * 40 + audio.bass * 120;
    circle(width / 2, height / 2, size);
  },
  plasma,
];
```

An inline p5 transform affects later p5 drawing during that frame. Use a
`ShaderChain` when you need to sample and transform pixels already drawn.

## Install and create patches

The Library reports four states:

```text
Available → Installed → Active → Running
```

- **Install source** adds editable source to the project.
- **Add to scene** edits the scene array.
- Evaluating the scene makes the patch **Active**.
- A successful draw makes it **Running**.

To create a patch, hover in the far-left gutter beside a folded cell and select `+`.
Enter a JavaScript identifier. p5js live inserts and opens an object-patch cell. Write
inside `draw()`, evaluate the patch, add its name to the scene, and evaluate the scene.

## Keep state

Return plain data from `state()` when a scene occurrence needs persistent state:

```js
const trails = {
  state() {
    return { points: [] };
  },

  draw({ state, audio }) {
    state.points.push({ x: mouseX, y: mouseY, energy: audio.level });
    if (state.points.length > 120) state.points.shift();
    for (const point of state.points) {
      circle(point.x, point.y, 4 + point.energy * 20);
    }
  },
};
```

Keep arrays and histories bounded. Optional lifecycle methods are `state`, `enter`,
`beat`, `draw`, `exit`, and `dispose`. Use `dispose()` to release graphics, shaders,
cameras, or other owned resources.

## Use audio

Start with `waveform`, `frequencyBars`, or `audioMeters` to inspect the input.

```js
const size = 40 + audio.bass * 220;
const wobble = sin(time * 2 + audio.mid * 3);
const flash = audio.beat ? 255 : 30;
```

Use level or frequency bands for continuous motion and `audio.beat` for events. Map
a few features first; audio ranges differ across tracks and input devices.

## Post-process with ShaderChain

`ShaderChain` captures the pixels drawn by earlier patches and applies its operators
in order.

```js
const spin = new ShaderChain()
  .rotate(({ time, audio }) => time * 0.15 + audio.bass * 0.3)
  .scale(({ audio }) => 1.02 + audio.mid * 0.08)
  .bloom(({ audio }) => 0.25 + audio.bass, 4, 0.5)
  .hue(({ time }) => time * 0.03)
  .blend("screen")
  .mix(0.7);

const scene = [
  waveScope,
  laserFan,
  spin,
  plasma,
];
```

Each operator argument can be a number or a function of the live context. `mix()` is
the effect's wet/dry control; `blend()` determines how its result combines with the
captured scene. Put the chain after the content it should process.

## Edit with AI (beta)

1. Open **Tools → AI**, choose a model, and add your own OpenAI API key.
2. Press `Cmd/Ctrl+Option/Alt+A` and describe the source change.
3. Review the highlighted proposal in the editor.
4. Press `Cmd/Ctrl+Enter` to accept and run it, or `Cmd/Ctrl+Z` to cancel it.

Follow-up prompts revise the same staged proposal. AI may tune values, edit the
scene, install a named library patch, or write a new patch cell. The previous visual
continues while a proposal is staged. If evaluation fails, the proposal stays staged
for another prompt or cancellation.

The API key goes directly from the browser to OpenAI. It is session-only unless
**remember on this device** is enabled, and it is not saved in projects or exports.
A ChatGPT subscription is separate from API access.

## Publish a canvas stream (beta)

Create a room and place its publisher after the output you want to share:

```js
const room = new StreamRoom({
  name: "AudioPixel-Thursday",
  performer: "Eric",
});

const publishMain = room.publish({ name: "main-output" });

const scene = [
  waveScope,
  plasma,
  publishMain,
];

activate(scene);
```

The stream appears as `Eric/main-output`. Publishing begins only while
`publishMain` is active. It shares canvas video, not code or audio.

## Receive a canvas stream (beta)

Network streaming is currently disabled in the interface. The workflow below documents
the inactive beta implementation.

The shortest path is in the **Network** panel:

1. Join the same room with a unique performer name.
2. Find the remote stream.
3. Select **Add receiver**.

p5js live creates a receiver patch, adds it to the scene, and activates the update.

For editable source, install `networkReceiver` from **Library → Utilities** and set
the room, your performer name, and the remote stream exactly as listed:

```js
const receiverRoom = new StreamRoom({
  name: "AudioPixel-Thursday",
  performer: "Maya",
});

const networkReceiver = receiverRoom.receive({
  stream: "Eric/main-output",
  fit: "cover",
  opacity: 1,
});
```

Add `networkReceiver` to the scene and evaluate it. See
[Networked visual streams](NETWORKING.md) for local two-browser testing, shader
textures, and deployment.

## Recover work

- Failed evaluation leaves the last successful version running.
- A first-frame failure restores the previous patch or scene.
- **Set safe** captures source, scene, parameters, versions, and compatible state.
- Press `0` or use **Restore safe** to restore that checkpoint.
- Named performances remain in the current browser and are included in project
  exports. Import merges them by identity instead of deleting unrelated local saves.
- Saved performances use stable insertion-order slots and new saves appear at the
  bottom. Use `Cmd/Ctrl+Option/Alt+1…9` to recall one of the first nine without
  leaving the editor.
- Export the project to back up the current source, parameters, and every named
  performance. Audio files remain separate.

p5js live evaluates trusted JavaScript, not sandboxed code. An infinite loop can freeze
the tab. See [SECURITY.md](../SECURITY.md).

## Commands

| Command | Action |
| --- | --- |
| `Cmd/Ctrl+Enter` | Evaluate the current cell or statement |
| `Cmd/Ctrl+Shift+Enter` | Evaluate the complete editor |
| `Cmd/Ctrl+/` | Toggle one comment layer |
| `Cmd/Ctrl+Option/Alt+T` | Tidy the current cell |
| `Option/Alt+Up/Down` | Move the current line or selected lines |
| `Cmd/Ctrl+Option/Alt+A` | Open the AI source editor |
| `Cmd/Ctrl+Option/Alt+1…9` | Recall the corresponding numbered saved performance |
| `Cmd/Ctrl+Option/Alt+S` | Quick-save to a new numbered performance slot |
| `Cmd/Ctrl+Alt+N` | Start a new performance from the default scene |
| `Esc` | Release editor focus |
| `Space` | Play or pause audio |
| `Cmd/Ctrl+\` | Show or hide tools |
| `r` | Show or hide the patch reference |
| `e` | Show or hide code |
| `f` | Enter or leave fullscreen |
| `p` | Open the audience window |
| `0` | Restore Safe State |
| `?` | Show all commands |

## Share a patch

To add a patch to the community catalog, follow the
[community patch guide](../community-patches/README.md). Keep it small, bounded,
credited, and easy to combine with unrelated patches.

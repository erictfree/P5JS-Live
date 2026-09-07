# Quickstart

Start with a moving sketch, change it while it runs, then combine it with another
sketch. No audio file or Library installation is needed for this guide.
The [documentation index](README.md) links to the full manual and references.

## Open the instrument

Use [p5js.live](https://p5js.live), or run locally from the project folder:

```sh
npm ci
npm run dev
```

Open [localhost:5173/live/](http://localhost:5173/live/) in current desktop Google
Chrome. Select **Start silent** to begin. You can choose a file or microphone later
in **Tools → Audio**.

The instrument restores your browser's saved project. **New performance** starts
the pulsing-square starter below. Save your current work first if you want a named
copy to return to. Named saves remain available in **Tools → Performances**.

## Make one live edit

The starter is a complete program:

<!-- example: starter -->
```js
// %% patch myPatch
const myPatch = {
  draw({ time }) {
    noStroke();
    fill("#57dbc8");
    rectMode(CENTER);
    const size = 120 + sin(time * 2) * 30;
    rect(width / 2, height / 2, size, size);
  },
};

// %% scene scene
const scene = [
  () => background(20, 22, 27),
  [myPatch]
    .rotate(0, 0.2)
    .opacity(0.85),
];
scene.draw();
```

1. Unfold `myPatch`, change the color in `fill()` or the size `120`, and press
   `Cmd/Ctrl+Enter` with the cursor inside that patch.
2. Unfold `scene`, change `.rotate(0, 0.2)` to `.rotate(0, -0.3)`, and run that cell.
3. Use `Cmd/Ctrl+Shift+Enter` when you want to evaluate the complete buffer.

The **Run** button on a cell does the same job as evaluating that cell with the
keyboard. Typing prepares a change; Run applies it. **Live · Edited** means the
previous version is running while the editor has unapplied changes. Syntax and
first-frame errors keep the last working version on stage.

## Add a second sketch

Insert this patch cell before the scene cell, then run it:

<!-- example: rings -->
```js
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
```

Replace the existing scene cell with this one and run it:

<!-- example: pair -->
```js
// %% scene scene
const scene = [
  () => background(20, 22, 27),
  [myPatch, rings]
    .rotate(0, 0.2)
    .opacity(0.85),
];
scene.draw();
```

Both sketches now share one transparent layer. Rotation and opacity process their
combined pixels; the background stays separate. To give them different effects,
replace that scene cell with:

<!-- example: separate -->
```js
// %% scene scene
const scene = [
  () => background(20, 22, 27),
  [myPatch].rotate(0, 0.2),
  [rings].opacity(0.6),
];
scene.draw();
```

Keep one declaration of each name in the buffer. Re-running the same cell is fine;
pasting several `const scene` declarations into a full program is a JavaScript error.

## Understand what runs

- A **patch** is a function or an object with `draw(context)`. The host calls it
  every frame and supplies changing `time`, `audio`, `controls`, and occurrence `state`.
- An **array** describes a layer in draw order. Nesting an array isolates its image.
- Array methods such as `.rotate()` and `.opacity()` add GPU effects and return a
  new frozen array. p5js live installs these methods; they are not built into JavaScript.
- **`scene.draw()` selects one active scene.** It takes over at the next frame
  boundary, then the host keeps rendering it. Run `otherScene.draw()` to switch.
  Defining a new array alone does not change the active scene.

Build arrays when evaluating source, outside patch `draw()` methods. Change a named
patch and run its cell to update its existing occurrences. After changing a helper
that builds a layer, run the scene expression again to rebuild that structure.

For nested effects, `.add()`, `.fx()`, and configured patches, continue with the
[composition cookbook](COMPOSITION.md). The [data model](DATA-MODEL.md) explains
array immutability, namespaces, and the draw loop.

## Find tools and source

**Tools → Scene** shows the running composition and shader order. Select an entry
to open its source. Reorder arrows edit source; **Review scene & run** lets you
apply that edit. Until then, the tree continues to show the live scene.

**Tools → Library** offers **Browse**, **In project**, and **In scene** filters.
**Install source** adds an editable patch. **Add to [scene]…** prepares a scene edit;
**Review scene & run** applies it after you review. **Not run** marks a pending addition.

**Tools → Controls** creates live controls and maps them to MIDI hardware.
**Settings** holds code size, panel opacity, FPS warnings, and audience layout.
**Messages** holds diagnostics and evaluation history. **AI assistant** offers a
staged source-editing workflow; see the [manual](USER-MANUAL.md#23-use-the-ai-source-editor-carefully).

## Save and recover

Save a named performance in **Tools → Performances**. **Project files → Export
project** backs up working source, controls, mappings, and named performances.
Audio and local video files remain separate. Browser storage belongs to that
browser and URL; it is not a shared backup.

Use **Set safe** when the current performance works. **Restore safe** or `0` returns
to that checkpoint, including supported occurrence state. Automatic rollback handles
failed evaluations; Safe State is your explicit recovery point. Live JavaScript is
trusted code, so an infinite loop can still freeze the tab; see [Security](../SECURITY.md).

## Useful keys

Press **Escape** to release editor focus before using single-key commands.

| Command | Action |
| --- | --- |
| `Cmd/Ctrl+Enter` | Run the current cell or statement |
| `Cmd/Ctrl+Shift+Enter` | Run the complete buffer |
| `Cmd/Ctrl+\` | Show or hide Tools |
| `e` | Show or hide code |
| `d` | Dim or restore the performer background; audience output is unchanged |
| `n` | Hide or restore the top navigation bar |
| `r` | Show or hide the patch reference |
| `f` | Toggle fullscreen |
| `p` | Open the audience window |
| `Space` / `t` | Tap tempo |
| `Shift+Space` | Play or pause audio |
| `s` / `0` | Set / restore Safe State |
| `Cmd/Ctrl+Option/Alt+S` | Save to a new numbered performance slot |
| `Cmd/Ctrl+Option/Alt+1…9` | Recall a saved performance slot |
| `Cmd/Ctrl+Option/Alt+N` | Start a new performance |
| `?` | Show all commands |

See the [keyboard reference](USER-MANUAL.md#30-keyboard-reference) for editing,
folding, and audio shortcuts. For networking experiments, use the source-based
[beta guide](NETWORKING.md); the Network tab is currently unavailable.

## Explore motion and rhythm

Choose Tools → Audio → Run Motion Lab to try all six visual signal helpers. Press
Esc, then hold H to trigger the example without sound or tap Space to establish tempo.
The complete [timing guide](RHYTHM.md) explains how to reuse those values in your
own p5 patches and shader effects. Auto tracking is an explicit preview while its
recorded-audio validation continues.

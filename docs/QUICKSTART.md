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
the moving-circle starter below. Save your current work first if you want a named
copy to return to. Named saves remain available in **Tools → Performances**.

Projects open with patch cells collapsed and scene cells expanded. The scene shows
what runs; open a patch's disclosure arrow when you want to edit its drawing code.

## Make one live edit

The starter is a complete program:

<!-- example: starter -->
```js
// %% patch myPatch
const myPatch = ({ audio, time }) => {
  const size = 120 + audio.bass * 180;
  const x = width / 2 + sin(time) * width / 4;

  noStroke();
  fill(105, 224, 198);
  circle(x, height / 2, size);
};

// %% scene scene
const scene = [
  () => background(0),
  myPatch,
];
scene.draw();
```

1. Unfold `myPatch`, change the color in `fill()` or the size `120`, and press
   `Cmd/Ctrl+Enter` with the cursor inside that patch.
2. Change `sin(time)` to `sin(time * 2)` and run the patch again to double its speed.
3. Use `Cmd/Ctrl+Shift+Enter` when you want to evaluate the complete buffer.

The circle moves in silence and grows with bass when you load audio. The short
`() => background(0)` function clears the canvas to black before the circle draws.

Typing prepares a change; `Cmd/Ctrl+Enter` applies it. **Live · Edited** means the
previous version is running while the editor has unapplied changes. A brief flash
confirms evaluation; there is no per-cell Run button or persistent Applied message.
Syntax and first-frame errors keep the last working version on stage.

To add an effect, put the caret on `myPatch` **in the scene** and press `Cmd/Ctrl+[`.
This wraps the name as `[myPatch]`. Add `.opacity(0.6)` after the closing bracket,
then run the scene cell. Select the patch expression and use the same shortcut to
wrap or unwrap it; it also works in the complete editor.

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
  () => background(0),
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
  () => background(0),
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
**Review scene & run** opens the scene for review; press `Cmd/Ctrl+Enter` there to
apply it. **Not run** marks a pending addition.

**Tools → Controls** creates live controls and maps them to MIDI hardware.
**Settings** holds code size, panel opacity, FPS warnings, and audience layout.
**Messages** holds diagnostics and evaluation history. **AI assistant** offers a
staged source-editing workflow; see the [manual](USER-MANUAL.md#23-use-the-ai-source-editor-carefully).

## Remove a patch

1. Remove its entry from the scene array, or use `Cmd/Ctrl+/` to comment out that line.
2. Press `Cmd/Ctrl+Enter` **inside the scene cell**. Until then, the old scene still
   runs the patch—even though its name is gone from your edited code.
3. To remove the source too, hover over the patch header (or focus it with the
   keyboard) and select **Delete**. It removes the header and code together.

Delete only appears when no scene source references the patch and the running scene
no longer uses it. Remove references from other scene cells too, if needed.
`Cmd/Ctrl+Z` in the editor restores a deleted block. There is no deletion banner or
separate Undo button. You can also keep unused patch source for later reuse.

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
| `Cmd/Ctrl+/` | Comment or uncomment selected lines |
| `Cmd/Ctrl+[` | Wrap or unwrap a selected expression or patch name as an array |
| `Cmd/Ctrl+Z` | Undo an edit or restore a deleted source block |
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

Choose Tools → Audio → Run Motion Lab to try all seven visual signal helpers. Press
Esc, then hold H to trigger the hit examples and sustain the ADSR; release H to
watch it fade. The Lag cell compares raw steps with smooth motion. Tap Space to establish tempo.
The complete [timing guide](RHYTHM.md) explains how to reuse those values in your
own p5 patches and shader effects. Choose Rhythm → Auto · experimental to try
Pulse (PLP), or switch to Onset grid while listening. Tap takes over with Manual.

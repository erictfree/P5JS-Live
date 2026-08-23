# p5js live

p5js live is a browser-based instrument for live-coding audio-reactive visuals with
JavaScript and p5.js. The canvas, audio analysis, clock, and working scene keep
running while you replace visual code.

Website: [p5js.live](https://p5js.live)

p5js live was created by **Eric Freeman** at the
[Department of Arts and Entertainment Technologies](https://aet.utexas.edu/) at
**The University of Texas at Austin**. It is an open-source project for visualists,
creative coders, performers, and the live-coding community.

## How it works

A **patch** is a JavaScript function, object, or class instance that draws. A
**scene** is an array of patches in layer order.

```js
const pulse = {
  speed: 2,

  draw({ time, audio }) {
    const size = 120 + sin(time * this.speed) * 60 + audio.bass * 140;
    circle(width / 2, height / 2, size);
  },
};

const scene = [
  pulse,
  plasma,
];

activate(scene);
```

Put the cursor in a patch or scene and press `Cmd/Ctrl+Enter`. p5js live evaluates
that unit without restarting the host. Syntax, evaluation, and first-frame errors
leave the last working version running.

p5js live includes:

- file, microphone, and line-input audio analysis;
- normalized level, bass, mid, treble, beat, spectrum, and waveform data;
- function, object, class, factory, closure, and inline patches;
- ordered scenes with independent state for each patch occurrence;
- a source-based patch library and community patch catalog;
- GPU post-processing through standard `ShaderChain` effects, wet/dry mix, blend
  modes, feedback, and custom WebGL patches;
- a beta AI source editor that stages code changes before they run;
- version history, Safe State, named performances, and project import/export;
- fullscreen, projected code, and a separate audience window;
- beta peer-to-peer canvas sharing through `StreamRoom` objects.

## Install and run

### Requirements

- Node.js 20 or newer
- A current desktop browser; Chrome is used for automated browser tests

Install Node from [nodejs.org](https://nodejs.org/) if needed. Then confirm it is
available:

```sh
node --version
npm --version
```

### Download

Use **Code → Download ZIP** on the
[GitHub repository](https://github.com/erictfree/p5js-live), then unzip it. Or clone
the repository:

```sh
git clone https://github.com/erictfree/p5js-live.git
cd p5js-live
```

If you downloaded the ZIP, open a terminal in the unzipped folder that contains
`package.json`.

### Start

```sh
npm ci
npm run dev
```

Keep the terminal open and visit [http://localhost:5173/live/](http://localhost:5173/live/).
Do not open `index.html` directly; the application must run from an HTTP server.

The same server shows the public site at [http://localhost:5173/](http://localhost:5173/).

The source picker waits for an audio file, microphone, or silence before starting
audio. The file picker accepts MP3, WAV, OGG, M4A, and AAC files; codec support
depends on the browser.

To stop the server, press `Ctrl+C` in the terminal. Working source and named
performances remain in that browser. Project export includes the current source,
parameters, and every named performance so they can move to another browser or
computer. Audio files remain separate.

## First edit

The starter scene contains a transparent ASCII layer followed by Plasma:

```js
const scene = [
  asciiNoise,
  plasma,
];

activate(scene);
```

Open `asciiNoise` and change `cellSize`, `density`, or `hue`; or open `plasma`
and change `speed` or `motion`. Press `Cmd/Ctrl+Enter` in that cell. The image
should change without a page reload.

To add a built-in patch:

1. Open tools with `☰` or `Cmd/Ctrl+\`.
2. In **Library**, select **Install source**.
3. Select **Add to scene**.
4. Evaluate the opened scene with `Cmd/Ctrl+Enter`.

The Library uses four distinct states:

```text
Available → Installed → Active → Running
```

Installing adds editable source. Adding to scene edits the scene array. The scene
becomes active only after evaluation.

To write a patch, hover in the far-left gutter beside a folded cell and select the
subtle `+`. Enter a JavaScript name. p5js live inserts an object patch and places the
cursor in `draw()`.

To share only that patch, leave the cursor inside its cell and use **Library → Share
current patch**. Export creates a human-readable `.p5patch.js` file; **copy link**
encodes the same source in the URL fragment. Opening a link or importing a file adds
the patch under **Shared patches** as Available—it does not install, activate, or run
the code.

## AI source editor (beta)

Press `Cmd/Ctrl+Option/Alt+A`, or open **Tools → AI**. Add your own OpenAI API key,
then ask for a parameter change, a scene edit, a library patch, or a new patch.

AI writes its proposal into the editor and highlights changed lines. The running
visual does not change until you select **Accept & run** or press `Cmd/Ctrl+Enter`.
Select **Cancel** or press `Cmd/Ctrl+Z` to restore the exact pre-AI source. A failed
proposal remains staged while the last good visual keeps running.

Keys are sent directly from the browser to OpenAI. Session-only storage is the
default; **remember on this device** uses browser storage. Keys are never included in
projects or exports. A ChatGPT subscription does not include API access.

## Main commands

| Command | Action |
| --- | --- |
| `Cmd/Ctrl+Enter` | Evaluate the current cell or statement |
| `Cmd/Ctrl+Shift+Enter` | Evaluate the complete editor |
| `Cmd/Ctrl+/` | Toggle one comment layer |
| `Cmd/Ctrl+Option/Alt+T` | Tidy the current cell |
| `Option/Alt+Up/Down` | Move the current line or selected lines |
| `Cmd/Ctrl+Option/Alt+A` | Open the AI source editor |
| `Cmd/Ctrl+Option/Alt+1…9` | Recall the corresponding stable numbered performance slot |
| `Cmd/Ctrl+Option/Alt+S` | Quick-save to a new numbered performance slot |
| `Cmd/Ctrl+Alt+N` | Start a new performance from the default scene |
| `Esc` | Release editor focus |
| `Space` | Play or pause audio |
| `Cmd/Ctrl+\` | Show or hide tools |
| `r` | Show or hide the installed-patch reference |
| `e` | Show or hide code |
| `f` | Enter or leave fullscreen |
| `p` | Open the audience window |
| `0` | Restore Safe State |
| `?` | Show all commands |

## Troubleshooting

### `node` or `npm` is not found

Install Node.js 20 or newer, close the terminal, and open it again.

### `npm` cannot find `package.json`

Change into the `p5js-live` folder before running the command.

### The page is blank or reports module/CORS errors

Use the URL printed by `npm run dev`, not a `file://` address.

### Port 5173 is already in use

Use the existing server, stop it with `Ctrl+C`, or run `PORT=4173 npm run dev` on
macOS/Linux. In PowerShell, run `$env:PORT=4173` first.

### A patch is installed but does not draw

Add it to the scene, then evaluate the scene cell.

### Old source returns after a restart

p5js live restores the working project saved in that browser. Use **New performance**
for the default ASCII Noise + Plasma scene, or import another project.

### Audio does not start

Choose a source on the first-run screen, allow microphone access if applicable, and
check whether the transport says **Play**. Enter with silence to test visuals alone.

## Documentation

| Document | Use it for |
| --- | --- |
| [Guide](docs/GUIDE.md) | Patches, scenes, audio, shaders, networking, and recovery |
| [API](docs/API.md) | Context fields, lifecycle, identity, commands, and exact behavior |
| [Networking (disabled)](docs/NETWORKING.md) | Inactive beta implementation and deployment notes |
| [Architecture](docs/ARCHITECTURE.md) | Runtime design and implementation invariants |
| [Product](docs/PRODUCT.md) | Purpose, principles, scope, and limits |
| [Contributing](CONTRIBUTING.md) | Development setup and contribution rules |
| [Security](SECURITY.md) | Trust boundary and vulnerability reporting |

## Development

```sh
npm ci
npm run dev
npm test
npx playwright install chromium  # once
npm run test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before changing the runtime or submitting a
community patch.

## Cloudflare Workers deployment

The hosted build puts the public site at `/` and the instrument at `/live/`:

```sh
npm run build
npm run preview
```

`dist/` is the Workers static-assets directory. `npm run deploy` builds it and runs
`wrangler deploy`. The custom domain is configured in Cloudflare, not in this repository.
Network streaming is currently disabled in the interface. Its beta implementation uses
local signaling and is not part of the hosted Worker yet.

## Google Analytics

The marketing page at `/` loads `/analytics.js` and reports to the p5js.live GA4 web
stream. The live instrument at `/live/` does not load analytics. After deploying,
confirm visits to `/` in the GA4 Realtime report or Tag Assistant.

Add any privacy notice or consent controls required for the audiences and regions where
the site is used before enabling collection.

## Security

p5js live evaluates trusted JavaScript with `new Function`; it is not a sandbox. Code
can access browser globals, consume unbounded resources, or freeze the tab. Run only
source you trust. See [SECURITY.md](SECURITY.md).

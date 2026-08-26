// p5js live's compact system patch library.
//
// The core mixing patches deliberately use several forms patch authors can remix:
// a plain function, arrow functions, object literals, higher-order factories, and
// classes. Three diagnostic patches expose the raw waveform, FFT bins, and normalized
// audio features. A small scene utility sets a solid background. ShaderFlow demonstrates
// the built-in fluent GPU pipeline, and Cellular & Blobular demonstrates feedback.
// Breathing Ellipse is the deliberately tiny first example: one object and one shape.
// The small remix set adds three transparent drawing layers and five ShaderChain
// treatments that are intentionally short enough to understand during a performance.
// Configuration remains ordinary JavaScript, with one control() example for a value
// that can be performed live from the Parameters panel.

/** @typedef {{ name: string, title?: string, blurb: string, category: 'visual'|'utility'|'shader'|'community', source: string }} LibraryEntry */

/** @type {LibraryEntry[]} */
export const LIBRARY = [
  {
    name: 'breathingEllipse',
    category: 'visual',
    blurb: 'One ellipse animated by sin(time × speed). Minimal object patch.',
    source: `// %% patch breathingEllipse
// breathingEllipse — one object, one shape, one changing value.
const breathingEllipse = {
  speed: 2,

  draw({ time }) {
    const diameter = 160 + sin(time * this.speed) * 90;
    noStroke();
    fill(255, 90, 190);
    ellipse(width / 2, height / 2, diameter, diameter);
  },
};`,
  },

  {
    name: 'localVideo',
    category: 'visual',
    blurb: 'Choose a local video, loop it silently and control its playback speed.',
    source: `// %% patch localVideo
// localVideo — a browser-local, silent video layer.
// The video file stays on this computer and is not included in project exports.
// Evaluate this method call when you want to choose or replace the file:
//   localVideo.choose();
control("videoSpeed", 1, { type: "continuous", min: 0.1, max: 4, step: 0.05 });

class LocalVideo {
  #video = null;
  #objectUrl = null;

  constructor({
    speed = 1,
    fit = "contain",
    opacity = 1,
  } = {}) {
    // speed may be a number or a function of the normal draw context.
    this.speed = speed;
    this.fit = fit; // "contain", "cover", or "stretch"
    this.opacity = opacity;
  }

  choose() {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "video/*";
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      if (file) this.load(file);
      picker.remove();
    }, { once: true });
    picker.click();
  }

  load(file) {
    if (!(file instanceof Blob)) {
      throw new TypeError("localVideo.load() expects a video File or Blob");
    }

    this.#releaseFile();
    const video = document.createElement("video");
    this.#objectUrl = URL.createObjectURL(file);
    video.src = this.#objectUrl;
    video.loop = true;
    video.playsInline = true;
    video.preload = "auto";
    this.#silence(video);
    this.#video = video;
    video.play().catch(() => {});
    return file.name || "local video";
  }

  play() {
    if (!this.#video) return false;
    this.#silence(this.#video);
    this.#video.play().catch(() => {});
    return true;
  }

  pause() {
    this.#video?.pause();
  }

  restart() {
    if (!this.#video) return false;
    this.#video.currentTime = 0;
    return this.play();
  }

  enter() {
    this.play();
  }

  exit() {
    this.pause();
  }

  draw(context) {
    const video = this.#video;
    if (!video || video.readyState < 2) return;

    this.#silence(video);
    const configuredSpeed = typeof this.speed === "function"
      ? this.speed(context)
      : this.speed;
    const numericSpeed = Number(configuredSpeed);
    video.playbackRate = constrain(Number.isFinite(numericSpeed) ? numericSpeed : 1, 0.1, 4);

    const sourceWidth = video.videoWidth || width;
    const sourceHeight = video.videoHeight || height;
    let drawWidth = width;
    let drawHeight = height;

    if (this.fit !== "stretch") {
      const scale = this.fit === "cover"
        ? Math.max(width / sourceWidth, height / sourceHeight)
        : Math.min(width / sourceWidth, height / sourceHeight);
      drawWidth = sourceWidth * scale;
      drawHeight = sourceHeight * scale;
    }

    drawingContext.save();
    drawingContext.globalAlpha = constrain(Number(this.opacity) || 0, 0, 1);
    drawingContext.drawImage(
      video,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    drawingContext.restore();
  }

  dispose() {
    this.#releaseFile();
  }

  #silence(video) {
    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
  }

  #releaseFile() {
    if (this.#video) {
      this.#video.pause();
      this.#video.removeAttribute("src");
      this.#video.load();
      this.#video = null;
    }
    if (this.#objectUrl) {
      URL.revokeObjectURL(this.#objectUrl);
      this.#objectUrl = null;
    }
  }
}

const localVideo = new LocalVideo({
  speed: ({ controls }) => controls.videoSpeed,
  fit: "contain",
  opacity: 1,
});`,
  },

  {
    name: 'gameOfLife',
    category: 'visual',
    blurb: "Conway's Game of Life with fixed-step simulation, live OOP methods and beat-seeded cells.",
    source: `// %% patch gameOfLife
// Conway's Game of Life — a transparent, stateful class patch.
// Add an explicit background patch before it when the scene should clear or fade.
// Evaluate these ordinary method calls live:
//   gameOfLife.toggle();      // pause or resume
//   gameOfLife.singleStep();  // advance once while paused
//   gameOfLife.reseed();      // make a new random population
//   gameOfLife.clearGrid();   // remove every living cell
class GameOfLife {
  constructor({
    cellSize = 14,
    generationsPerSecond = 10,
    startingDensity = 0.24,
    hue = 165,
    wrapEdges = true,
    birthsOnBeat = 6,
  } = {}) {
    this.cellSize = cellSize;
    this.generationsPerSecond = generationsPerSecond;
    this.startingDensity = startingDensity;
    this.hue = hue;
    this.wrapEdges = wrapEdges;
    this.birthsOnBeat = birthsOnBeat;

    this.running = true;
    this.audioSpeed = 1.25;
    this.showStats = true;

    this.seedVersion = 0;
    this.clearVersion = 0;
    this.stepVersion = 0;
  }

  state() {
    return {
      columns: 0,
      rows: 0,
      cells: [],
      next: [],
      elapsed: 0,
      generation: 0,
      seedVersion: -1,
      clearVersion: this.clearVersion,
      stepVersion: this.stepVersion,
    };
  }

  toggle() {
    this.running = !this.running;
    return this.running;
  }

  reseed() {
    this.seedVersion += 1;
  }

  clearGrid() {
    this.clearVersion += 1;
  }

  singleStep() {
    this.stepVersion += 1;
  }

  resizeAndSeed(state) {
    state.columns = Math.max(8, Math.floor(width / this.cellSize));
    state.rows = Math.max(8, Math.floor(height / this.cellSize));
    const count = state.columns * state.rows;
    state.cells = Array.from(
      { length: count },
      () => Math.random() < this.startingDensity ? 1 : 0,
    );
    state.next = new Array(count).fill(0);
    state.elapsed = 0;
    state.generation = 0;
    state.seedVersion = this.seedVersion;
  }

  cellIndex(x, y, state) {
    if (this.wrapEdges) {
      x = (x + state.columns) % state.columns;
      y = (y + state.rows) % state.rows;
    } else if (x < 0 || x >= state.columns || y < 0 || y >= state.rows) {
      return -1;
    }
    return y * state.columns + x;
  }

  livingNeighbours(x, y, state) {
    let total = 0;
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        if (offsetX === 0 && offsetY === 0) continue;
        const index = this.cellIndex(x + offsetX, y + offsetY, state);
        if (index >= 0) total += state.cells[index];
      }
    }
    return total;
  }

  advance(state) {
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.columns; x++) {
        const index = y * state.columns + x;
        const neighbours = this.livingNeighbours(x, y, state);
        const alive = state.cells[index] === 1;

        // Conway's complete rule: birth with 3; survive with 2 or 3.
        state.next[index] = neighbours === 3 || (alive && neighbours === 2) ? 1 : 0;
      }
    }
    [state.cells, state.next] = [state.next, state.cells];
    state.generation += 1;
  }

  seedFromBeat(state) {
    for (let i = 0; i < this.birthsOnBeat; i++) {
      const x = Math.floor(Math.random() * state.columns);
      const y = Math.floor(Math.random() * state.rows);
      state.cells[y * state.columns + x] = 1;
    }
  }

  update({ audio, state, dt }) {
    const columns = Math.max(8, Math.floor(width / this.cellSize));
    const rows = Math.max(8, Math.floor(height / this.cellSize));
    if (
      columns !== state.columns ||
      rows !== state.rows ||
      state.seedVersion !== this.seedVersion
    ) {
      this.resizeAndSeed(state);
    }

    if (state.clearVersion !== this.clearVersion) {
      state.cells.fill(0);
      state.clearVersion = this.clearVersion;
      state.generation = 0;
    }

    if (audio.beat && this.birthsOnBeat > 0) this.seedFromBeat(state);

    while (state.stepVersion < this.stepVersion) {
      this.advance(state);
      state.stepVersion += 1;
    }

    if (!this.running) return;
    const mid = audio.mid ?? 0;
    const rate = Math.max(0.1, this.generationsPerSecond * (1 + mid * this.audioSpeed));
    const interval = 1 / rate;
    state.elapsed += dt;

    // Cap catch-up work so returning from a paused browser tab stays smooth.
    let steps = 0;
    while (state.elapsed >= interval && steps < 4) {
      this.advance(state);
      state.elapsed -= interval;
      steps += 1;
    }
  }

  draw(context) {
    this.update(context);
    const { audio, state } = context;
    const bass = audio.bass ?? 0;
    const treble = audio.treble ?? 0;
    const gridWidth = state.columns * this.cellSize;
    const gridHeight = state.rows * this.cellSize;
    const left = (width - gridWidth) / 2;
    const top = (height - gridHeight) / 2;

    colorMode(HSB, 360, 100, 100, 1);
    noStroke();

    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.columns; x++) {
        if (state.cells[y * state.columns + x] === 0) continue;
        const colour = (this.hue + x * 1.6 + y * 0.8 + state.generation * 0.35) % 360;
        fill(colour, 62 + treble * 30, 78 + bass * 22, 0.9);
        rect(
          left + x * this.cellSize + 1,
          top + y * this.cellSize + 1,
          Math.max(1, this.cellSize - 2),
          Math.max(1, this.cellSize - 2),
          Math.min(3, this.cellSize * 0.18),
        );
      }
    }

    if (this.showStats) {
      fill(this.hue, 30, 100, 0.82);
      textSize(12);
      textAlign(LEFT, TOP);
      text(
        'generation ' + state.generation + ' · ' + (this.running ? 'running' : 'paused'),
        12,
        12,
      );
    }
  }
}

const gameOfLife = new GameOfLife();`,
  },

  {
    name: 'roseWindow',
    category: 'visual',
    blurb: 'Layered polar roses that open with bass. Small configurable object patch.',
    source: `// %% patch roseWindow
// roseWindow — three polar curves, drawn as one transparent scene layer.
// Try petals: 5, 7, 9 or 12. Fractional values make the curve wander.
// Pair it with solidBackground, then pixelDrift.
const roseWindow = {
  petals: 7,
  radius: 0.32,
  hue: 325,
  spin: 0.08,

  draw({ audio, time }) {
    const size = min(width, height) * (this.radius + audio.bass * 0.09);
    const phase = time * (0.35 + audio.mid * 0.8);

    translate(width / 2, height / 2);
    rotate(time * this.spin);
    colorMode(HSB, 360, 100, 100, 1);
    blendMode(ADD);
    noFill();

    for (let layer = 0; layer < 3; layer++) {
      stroke((this.hue + layer * 34 + time * 8) % 360, 72, 100, 0.58);
      strokeWeight(1.15 + audio.treble * 2.5);
      beginShape();
      for (let step = 0; step <= 240; step++) {
        const angle = map(step, 0, 240, 0, TWO_PI);
        const radius = size * cos(this.petals * angle + phase + layer * 0.24);
        vertex(cos(angle) * radius, sin(angle) * radius);
      }
      endShape(CLOSE);
    }
  },
};`,
  },

  {
    name: 'waveTerrain',
    category: 'visual',
    blurb: 'The live waveform repeated as a glowing perspective landscape. Arrow-function patch.',
    source: `// %% patch waveTerrain
// waveTerrain — one waveform copied into receding rows.
// Change rows and points first: they trade detail for speed.
// Pair it with solidBackground, then prismMirror.
const waveTerrain = ({ audio, time }) => {
  const wave = audio.waveform;
  if (wave.length < 2) return;

  const rows = 14;
  const points = 96;
  const lift = height * (0.06 + audio.level * 0.14);

  colorMode(HSB, 360, 100, 100, 1);
  blendMode(ADD);
  noFill();

  for (let row = rows - 1; row >= 0; row--) {
    const depth = row / (rows - 1);
    const y = lerp(height * 0.28, height * 0.92, depth);
    stroke((205 + depth * 115 + time * 5) % 360, 70, 100, 0.26 + depth * 0.42);
    strokeWeight(0.7 + depth * 1.4);
    beginShape();
    for (let point = 0; point <= points; point++) {
      const across = point / points;
      const sample = floor(across * (wave.length - 1));
      const envelope = sin(PI * across);
      const ripple =
        sin(across * TWO_PI * 3 + time * 2.2 + row * 0.45) *
        (4 + audio.mid * 18);
      const waveY = wave[sample] * lift * envelope * (1 - depth * 0.5);
      vertex(across * width, y - waveY + ripple);
    }
    endShape();
  }
};`,
  },

  {
    name: 'moireField',
    category: 'visual',
    blurb: 'Two transparent line fields make an audio-driven moiré interference pattern.',
    source: `// %% patch moireField
// moireField — two ordinary line grids; their overlap makes the complexity.
// Pair it with solidBackground, then neonInk.
const moireField = {
  lines: 44,
  spacing: 22,
  hue: 185,
  speed: 0.11,

  field(angle, spacing, colour, alpha) {
    const extent = Math.hypot(width, height);
    push();
    translate(width / 2, height / 2);
    rotate(angle);
    stroke(colour, 68, 100, alpha);
    for (let lineIndex = -this.lines; lineIndex <= this.lines; lineIndex++) {
      const x = lineIndex * spacing;
      line(x, -extent, x, extent);
    }
    pop();
  },

  draw({ audio, time }) {
    const spacing = max(8, this.spacing - audio.bass * 9);
    const crossing = 0.18 + audio.mid * 0.34;
    colorMode(HSB, 360, 100, 100, 1);
    blendMode(ADD);
    strokeWeight(0.85 + audio.treble * 1.3);
    this.field(time * this.speed, spacing, this.hue, 0.34);
    this.field(
      -time * this.speed + crossing,
      spacing,
      (this.hue + 105) % 360,
      0.3
    );
  },
};`,
  },

  {
    name: 'strobe',
    category: 'visual',
    blurb: 'A restrained white beat flash. Plain first-class function patch.',
    source: `// %% patch strobe
// strobe — one translucent flash on each detected onset.
// Put it late in a scene so it flashes over the layers before it.
function strobe({ audio }) {
  if (!audio.beat) return;
  blendMode(ADD);
  noStroke();
  fill(255, 255, 255, 72);
  rect(0, 0, width, height);
}`,
  },

  {
    name: 'waveScope',
    category: 'visual',
    blurb: 'An additive oscilloscope line drawn from the live waveform. Arrow-function patch.',
    source: `// %% patch waveScope
// waveScope — the waveform as a bright oscilloscope trace.
// It is a first-class arrow function: no wrapper object is required.
const waveScope = ({ audio }) => {
  const wave = audio.waveform;
  if (wave.length === 0) return;

  // These local values are intentionally easy live-coding targets.
  const yPosition = 0.5;
  const amplitude = 0.28;
  const colour = [80, 220, 255, 190];

  blendMode(ADD);
  noFill();
  stroke(...colour);
  strokeWeight(2);

  beginShape();
  const step = Math.max(1, Math.floor(wave.length / 220));
  for (let i = 0; i < wave.length; i += step) {
    const x = map(i, 0, wave.length - 1, 0, width);
    const y = height * yPosition + wave[i] * height * amplitude;
    vertex(x, y);
  }
  endShape();
};`,
  },

  {
    name: 'solidBackground',
    category: 'utility',
    blurb: 'Utility: fills the canvas with one configurable colour. Put it first in a scene.',
    source: `// %% patch solidBackground
// solidBackground — the simplest possible scene foundation.
// Put it first in the scene array so later patches draw over it.
// Make variations with ordinary object spread:
//   const redBackground = { ...solidBackground, colour: [30, 0, 8] };
const solidBackground = {
  colour: [6, 8, 18],

  draw() {
    background(...this.colour);
  },
};`,
  },

  {
    name: 'networkReceiver',
    category: 'utility',
    blurb: 'Beta: receives another performer’s canvas. Edit the room, your name, and the published stream name.',
    source: `// %% patch networkReceiver
// networkReceiver (beta) — another performer's canvas as an ordinary scene object.
// 1. Use the same room name shown in the Network panel.
// 2. Set performer to your own name.
// 3. Copy the remote stream name exactly, including the slash.
const receiverRoom = new StreamRoom({
  name: "performance-room",
  performer: "your-name",
});

const networkReceiver = receiverRoom.receive({
  stream: "performer/main-output",
  fit: "cover",       // "cover", "contain", or "stretch"
  opacity: 1,
});`,
  },

  {
    name: 'waveform',
    category: 'utility',
    blurb: 'Diagnostic: the unprocessed FFT waveform drawn as a single linear trace.',
    source: `// %% patch waveform
// waveform — a deliberately plain view of audio.waveform.
// The samples are raw FFT waveform values from -1 to 1. There is no glow,
// persistence, gain remapping, or artistic distortion in this patch.
const waveform = {
  samples: 512,
  position: 0.5,
  height: 0.72,
  colour: [245, 245, 250, 230],

  draw({ audio }) {
    const values = audio.waveform;
    if (values.length < 2) return;

    const center = height * this.position;
    const amplitude = height * this.height * 0.5;
    stroke(120, 120, 135, 110);
    strokeWeight(1);
    line(0, center, width, center);

    noFill();
    stroke(...this.colour);
    strokeWeight(1.5);
    beginShape();
    const points = min(this.samples, values.length);
    for (let i = 0; i < points; i++) {
      const sample = floor(map(i, 0, points - 1, 0, values.length - 1));
      const x = map(i, 0, points - 1, 0, width);
      const y = center + values[sample] * amplitude;
      vertex(x, y);
    }
    endShape();
  },
};`,
  },

  {
    name: 'frequencyBars',
    category: 'utility',
    blurb: 'Diagnostic: raw linear FFT bins grouped into an adjustable bar chart.',
    source: `// %% patch frequencyBars
// frequencyBars — raw FFT magnitudes from low frequency on the left to high
// frequency on the right. Unlike audio.bass/mid/treble, these values are 0..255
// and have not been normalized by p5js live's auto-gain.
const frequencyBars = {
  bars: 64,
  heightRatio: 0.34,

  draw({ audio }) {
    const spectrum = audio.spectrum;
    if (spectrum.length === 0) return;

    const top = height * (1 - this.heightRatio);
    const chartHeight = height - top - 22;
    const barWidth = width / this.bars;

    noStroke();
    for (let bar = 0; bar < this.bars; bar++) {
      const start = floor((bar / this.bars) * spectrum.length);
      const end = max(start + 1, floor(((bar + 1) / this.bars) * spectrum.length));
      let peak = 0;
      for (let bin = start; bin < end; bin++) peak = max(peak, spectrum[bin]);

      const energy = peak / 255;
      const h = energy * chartHeight;
      // Solid marks only: this diagnostic never lays a translucent tint over the scene.
      if (bar < this.bars * 0.12) fill(100, 145, 255);
      else if (bar < this.bars * 0.46) fill(190, 125, 255);
      else fill(255, 190, 95);
      rect(bar * barWidth, height - 18 - h, max(1, barWidth - 1), h);
    }

    fill(225);
    textSize(11);
    textAlign(LEFT, BOTTOM);
    text('FFT: low frequency', 5, height - 3);
    textAlign(RIGHT, BOTTOM);
    text('high frequency', width - 5, height - 3);
  },
};`,
  },

  {
    name: 'audioMeters',
    category: 'utility',
    blurb: 'Diagnostic: labeled normalized level, bass, mid, treble and centroid meters.',
    source: `// %% patch audioMeters
// audioMeters — the normalized 0..1 features received by every patch.
// Band meters share one auto-gain ceiling, so their relative balance is preserved.
// Turn auto-gain off in the Audio panel to compare normalized and raw behavior.
const audioMeters = {
  x: 20,
  y: 20,
  width: 360,
  rowHeight: 22,

  draw({ audio }) {
    const rows = [
      ['level', audio.level, [105, 215, 145]],
      ['bass', audio.bass, [105, 150, 245]],
      ['mid', audio.mid, [190, 135, 245]],
      ['treble', audio.treble, [245, 185, 100]],
      ['centroid', audio.centroid, [100, 215, 225]],
    ];
    const meterWidth = min(this.width, width - this.x * 2);

    textSize(12);
    textAlign(LEFT, CENTER);
    noStroke();
    for (let i = 0; i < rows.length; i++) {
      const [name, value, colour] = rows[i];
      const y = this.y + i * this.rowHeight;
      // The meter itself is opaque; there is deliberately no backing track or panel.
      fill(...colour);
      rect(this.x, y, meterWidth * constrain(value, 0, 1), this.rowHeight - 4);
      fill(255);
      text(name, this.x + 6, y + (this.rowHeight - 4) / 2);
      textAlign(RIGHT, CENTER);
      text(value.toFixed(3), this.x + meterWidth - 6, y + (this.rowHeight - 4) / 2);
      textAlign(LEFT, CENTER);
    }

    const beatY = this.y + rows.length * this.rowHeight + 5;
    fill(audio.beat ? 255 : 80, audio.beat ? 80 : 80, audio.beat ? 120 : 80);
    circle(this.x + 7, beatY + 7, 10);
    fill(235);
    text('beat', this.x + 19, beatY + 7);
    textAlign(RIGHT, CENTER);
    text(
      \`raw bands  bass \${round(audio.raw.bass)}  mid \${round(audio.raw.mid)}  treble \${round(audio.raw.treble)}\`,
      this.x + meterWidth,
      beatY + 7,
    );
  },
};`,
  },

  {
    name: 'checkerZoom',
    category: 'visual',
    blurb: 'A rotating checker field that breathes with bass. Arrow-function patch.',
    source: `// %% patch checkerZoom
// checkerZoom — a translucent, rotating club-floor grid.
// Add solidBackground before it when the scene should clear each frame.
// checkerSpeed appears in the Controllers panel.
control("checkerSpeed", 0.08, { type: "continuous", min: -0.4, max: 0.4, step: 0.01 });

const checkerZoom = ({ audio, time, controls }) => {
  const cell = 58 + audio.bass * 38;
  const extent = Math.hypot(width, height) * 0.75;

  translate(width / 2, height / 2);
  rotate(time * controls.checkerSpeed);
  rectMode(CENTER);
  noStroke();
  blendMode(ADD);

  let row = 0;
  for (let y = -extent; y <= extent; y += cell) {
    let col = 0;
    for (let x = -extent; x <= extent; x += cell) {
      if ((row + col) % 2 === 0) {
        const glow = 18 + audio.mid * 34;
        fill(120, 70, 255, glow);
        rect(x, y, cell * 0.82, cell * 0.82);
      }
      col++;
    }
    row++;
  }
};`,
  },

  {
    name: 'laserFan',
    category: 'visual',
    blurb: 'A fan of additive laser beams swept by treble. Configurable object literal.',
    source: `// %% patch laserFan
// Make an independent variation with object spread:
//   const pinkLasers = { ...laserFan, hue: 330, direction: -1 };
const laserFan = {
  beams: 13,
  hue: 165,
  spread: 0.72,
  direction: 1,
  weight: 1.4,

  draw({ audio, time }) {
    colorMode(HSB, 360, 100, 100, 1);
    blendMode(ADD);
    noFill();
    strokeWeight(this.weight + audio.treble * 1.5);

    const sweep = sin(time * 0.7 * this.direction) * width * 0.12;
    for (let i = 0; i < this.beams; i++) {
      const t = this.beams === 1 ? 0.5 : i / (this.beams - 1);
      const targetX = width / 2 + map(t, 0, 1, -1, 1) * width * this.spread + sweep;
      stroke((this.hue + i * 3) % 360, 75, 100, 0.16 + audio.treble * 0.5);
      line(width / 2, height, targetX, 0);
    }
  },
};`,
  },

  {
    name: 'glitchSlices',
    category: 'visual',
    blurb: 'Horizontal digital slices that intensify with treble. Configurable object literal.',
    source: `// %% patch glitchSlices
// Treble controls travel distance; a beat adds a bright interruption.
const glitchSlices = {
  slices: 18,
  hue: 320,
  thickness: 7,

  draw({ audio, time }) {
    colorMode(HSB, 360, 100, 100, 1);
    blendMode(ADD);
    noStroke();

    for (let i = 0; i < this.slices; i++) {
      const n = noise(i * 8.17, time * 3.2);
      if (n < 0.5 && !audio.beat) continue;
      const y = n * height;
      const offset = (n - 0.5) * width * audio.treble * 0.45;
      const barWidth = width * (0.08 + n * 0.28);
      fill((this.hue + i * 9) % 360, 65, 100, audio.beat ? 0.34 : 0.12);
      rect((i * 97 + offset) % width, y, barWidth, this.thickness);
    }
  },
};`,
  },

  {
    name: 'spectrumHalo',
    category: 'visual',
    blurb: 'A circular spectrum of frequency spokes. Configurable object literal.',
    source: `// %% patch spectrumHalo
// spectrumHalo — FFT bins wrapped around a circle.
const spectrumHalo = {
  spokes: 72,
  radius: 0.18,
  length: 0.24,
  hue: 200,
  spin: 0.04,

  draw({ audio, time }) {
    const spectrum = audio.spectrum;
    if (spectrum.length === 0) return;

    colorMode(HSB, 360, 100, 100, 1);
    blendMode(ADD);
    translate(width / 2, height / 2);
    rotate(time * this.spin);
    strokeWeight(1.5);

    const base = min(width, height) * this.radius;
    const maxLength = min(width, height) * this.length;
    for (let i = 0; i < this.spokes; i++) {
      const angle = (TWO_PI * i) / this.spokes;
      const bin = Math.floor(map(i, 0, this.spokes, 0, spectrum.length * 0.65));
      const energy = spectrum[bin] / 255;
      const outer = base + energy * maxLength;
      stroke((this.hue + energy * 90) % 360, 70, 100, 0.25 + energy * 0.65);
      line(cos(angle) * base, sin(angle) * base, cos(angle) * outer, sin(angle) * outer);
    }
  },
};`,
  },

  {
    name: 'glassOrigin',
    title: 'Glass Origin',
    category: 'shader',
    blurb: 'Procedural glass tunnel source adapted from Frostbyte’s FragCoord shader.',
    source: `// %% patch glassOrigin
// @title Glass Origin
// @author Frostbyte — https://fragcoord.xyz/u/Frostbyte
// @description A procedural glass tunnel source shader. Put effects after it.
// Original shader: https://fragcoord.xyz/s/tbe1g319
// SPDX-License-Identifier: CC-BY-NC-SA-4.0
// Copyright (c) 2026 @Frostbyte
// License: https://creativecommons.org/licenses/by-nc-sa/4.0/
//
// AlgoLab adaptation: p5/WebGL wrapper, portable GLSL ES helpers and live controls.
class GlassOrigin {
  #output = null;
  #program = null;

  constructor({
    speed = 1,
    glow = 1,
    spin = 0,
    audioDrive = 0.35,
  } = {}) {
    // Each value may be a number or a function of the normal draw context.
    this.speed = speed;
    this.glow = glow;
    this.spin = spin;
    this.audioDrive = audioDrive;
  }

  #vertexSource = \`
    precision highp float;

    attribute vec3 aPosition;
    attribute vec2 aTexCoord;
    varying vec2 vTexCoord;

    void main() {
      vTexCoord = aTexCoord;
      vec4 position = vec4(aPosition, 1.0);
      position.xy = position.xy * 2.0 - 1.0;
      gl_Position = position;
    }
  \`;

  #fragmentSource = \`
    precision highp float;

    varying vec2 vTexCoord;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uAudio;
    uniform float uSpeed;
    uniform float uGlow;
    uniform float uSpin;
    uniform float uAudioDrive;

    const mat3 NOISE_MATRIX = mat3(
      -0.57, 0.81, 0.10,
      -0.28, -0.30, 0.90,
       0.77, 0.49, 0.40
    );

    vec3 path(float z) {
      return vec3(cos(z * 0.02) * 20.0, cos(z * 0.05) * 3.0, z);
    }

    mat2 rotate2d(float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return mat2(c, -s, s, c);
    }

    // Xor's dot noise, golfed by Fabrice:
    // https://fragcoord.xyz/s/pf29h2wz
    float dotNoise(vec3 point) {
      return dot(
        cos(NOISE_MATRIX * point),
        sin(1.6 * (point * NOISE_MATRIX))
      );
    }

    // Inigo Quilez cosine palette (MIT):
    // https://www.shadertoy.com/view/ll2GD3
    vec3 palette(float t) {
      return clamp(
        vec3(0.455, 0.322, 0.216)
        + vec3(-0.073, 0.119, 0.150)
        * cos(6.28318 * (
          vec3(20.0, 1.0, 1.0) * t
          + vec3(0.100, -0.256, -0.231)
        )),
        0.0,
        1.0
      );
    }

    // GLSL ES 1.00 does not guarantee tanh(), so use its stable positive-domain
    // approximation. The raymarch accumulation is non-negative here.
    vec3 softTanh(vec3 value) {
      return value / (1.0 + abs(value));
    }

    void main() {
      vec2 fragCoord = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;
      float drive = 1.0 + uAudio.x * uAudioDrive;
      float time = uTime * uSpeed * drive;
      vec3 camera = path(time * 10.0);
      vec3 forward = normalize(path(time * 10.0 + 1.0) - camera);
      vec3 right = normalize(vec3(forward.z, 0.0, -forward.x));
      vec3 up = normalize(cross(right, forward));
      vec2 screen = (fragCoord - 0.5 * uResolution) / uResolution.y;
      vec3 ray = normalize(mat3(-right, up, forward) * vec3(screen, 2.0));

      float distanceTravelled = 0.0;
      float field = 0.0;
      vec3 point = camera;
      vec3 colour = vec3(0.0);

      for (int index = 0; index < 150; index++) {
        field = 0.001 + abs(field) * 0.1;
        distanceTravelled += field;
        colour += palette(point.z * 0.1 + float(index) * 2.0) / max(field, 0.001);

        point = ray * distanceTravelled + camera;
        vec3 unrotated = point;
        point.xy = rotate2d(length(path(time).xy) * 0.05 + uSpin) * point.xy;

        field = sin(point.z + point.y) * 0.1 - 0.2;
        float grain = abs(dotNoise(point) + dotNoise(point / 8.0) * 4.0);
        field += grain + grain * 0.2;
        field = max(
          1.5 + sin(point.z * 0.2 + point.y * 0.4)
          - length((unrotated - path(point.z)).xy),
          field
        );
      }

      float audioGlow = 1.0 + uAudio.y * uAudioDrive * 0.8;
      vec3 exposure = colour * colour * (uGlow * audioGlow / 200000000.0);
      gl_FragColor = vec4(softTanh(exposure) * 1.5, 1.0);
    }
  \`;

  #value(setting, context) {
    return typeof setting === "function" ? setting(context) : setting;
  }

  #ensureShader() {
    if (!this.#output) {
      this.#output = createGraphics(width, height, WEBGL);
      this.#output.pixelDensity(1);
      this.#output.noStroke();
      this.#program = this.#output.createShader(this.#vertexSource, this.#fragmentSource);
    } else if (this.#output.width !== width || this.#output.height !== height) {
      this.#output.resizeCanvas(width, height);
    }
  }

  draw(context) {
    this.#ensureShader();
    this.#output.clear();
    this.#output.shader(this.#program);
    this.#program.setUniform("uResolution", [width, height]);
    this.#program.setUniform("uTime", context.time);
    this.#program.setUniform("uAudio", [
      context.audio.bass,
      context.audio.mid,
      context.audio.treble,
    ]);
    this.#program.setUniform("uSpeed", this.#value(this.speed, context));
    this.#program.setUniform("uGlow", this.#value(this.glow, context));
    this.#program.setUniform("uSpin", this.#value(this.spin, context));
    this.#program.setUniform("uAudioDrive", this.#value(this.audioDrive, context));
    this.#output.rect(0, 0, width, height);
    image(this.#output, 0, 0, width, height);
  }

  dispose() {
    this.#output?.remove();
    this.#output = null;
    this.#program = null;
  }
}

const glassOrigin = new GlassOrigin({
  speed: 1,
  glow: ({ audio }) => 0.9 + audio.mid * 0.35,
  spin: ({ time }) => sin(time * 0.12) * 0.08,
  audioDrive: 0.35,
});`,
  },

  {
    name: 'transparentCubeField',
    title: 'Transparent Cube Field',
    category: 'shader',
    blurb: 'Audio-reactive raymarched field of luminous, glass-like repeating cubes.',
    source: `// %% patch transparentCubeField
// @title Transparent Cube Field
// @author Shane — https://www.shadertoy.com/user/Shane
// @description A fast raymarched field of luminous, glass-like repeating cubes.
// Original shader: https://www.shadertoy.com/view/ll2SRy
// License: not specified in the supplied original source.
//
// Inspired by Fabrice Neyret's cube studies and Duke's port of Las's
// "Cloudy Spikeball," as credited in the original shader comments.
//
// p5js.live adaptation: p5/WebGL wrapper plus audio-reactive live parameters.
// This is a source shader: put it before post-processing effects in the scene.
class TransparentCubeField {
  #output = null;
  #program = null;

  constructor({
    speed = 1,
    thickness = 0.035,
    jitter = 0.03,
    glow = 1,
    fisheye = 0.5,
    swivel = 0.375,
    audioDrive = 0.3,
  } = {}) {
    // Every setting may be a number or a function of the normal draw context.
    this.speed = speed;
    this.thickness = thickness;
    this.jitter = jitter;
    this.glow = glow;
    this.fisheye = fisheye;
    this.swivel = swivel;
    this.audioDrive = audioDrive;
  }

  #vertexSource = \`
    precision highp float;

    attribute vec3 aPosition;
    attribute vec2 aTexCoord;
    varying vec2 vTexCoord;

    void main() {
      vTexCoord = aTexCoord;
      vec4 position = vec4(aPosition, 1.0);
      position.xy = position.xy * 2.0 - 1.0;
      gl_Position = position;
    }
  \`;

  #fragmentSource = \`
    precision highp float;

    varying vec2 vTexCoord;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uAudio;
    uniform float uSpeed;
    uniform float uThickness;
    uniform float uJitter;
    uniform float uGlow;
    uniform float uFisheye;
    uniform float uSwivel;
    uniform float uAudioDrive;

    // Cheap vec3-to-vec3 hash from the original shader.
    vec3 hash33(vec3 point) {
      float noise = sin(dot(point, vec3(7.0, 157.0, 113.0)));
      return fract(vec3(2097152.0, 262144.0, 32768.0) * noise);
    }

    float cubeField(vec3 point) {
      // Offset each cell before repeating space to break up the lattice.
      vec3 offset = hash33(floor(point)) * 0.2;
      point = fract(point + offset) - 0.5;

      // Blend a box distance with a small spherical term for convex faces.
      float roundness = dot(point, point) - 0.21;
      point = abs(point);
      return max(max(point.x, point.y), point.z) * 0.95
        + roundness * 0.05 - 0.21;
    }

    void main() {
      vec2 fragCoord = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;
      vec2 uv = (fragCoord - uResolution * 0.5) / uResolution.y;

      float bassDrive = 1.0 + uAudio.x * uAudioDrive;
      float time = uTime * uSpeed * bassDrive;
      float lens = (1.0 - dot(uv, uv) * uFisheye) * 0.5;
      vec3 ray = normalize(vec3(uv, lens));
      vec3 origin = vec3(0.0, 0.0, time * 3.0);

      float angle = time * uSwivel;
      float cosine = cos(angle);
      float sine = sin(angle);
      mat2 rotation = mat2(cosine, sine, -sine, cosine);
      ray.xz = rotation * ray.xz;
      ray.xy = rotation * ray.xy;

      float jitter = max(0.0, uJitter) * (1.0 + uAudio.z * uAudioDrive);
      ray *= 1.0 - jitter * 0.5 + hash33(ray) * jitter;

      float distanceTravelled = 0.0;
      float layers = 0.0;
      float surfaceDistance = 0.0;
      float accumulatedDistance = 0.0;
      float threshold = max(0.003, uThickness * (1.0 + uAudio.y * uAudioDrive * 0.3));
      vec3 colour = vec3(0.0);

      for (int index = 0; index < 56; index++) {
        if (layers > 15.0 || colour.x > 1.0 || distanceTravelled > 10.0) break;

        vec3 surfacePoint = origin + ray * distanceTravelled;
        surfaceDistance = cubeField(surfacePoint);
        accumulatedDistance =
          (threshold - abs(surfaceDistance) * 15.0 / 16.0) / threshold;

        if (accumulatedDistance > 0.0) {
          float smoothDistance = accumulatedDistance * accumulatedDistance
            * (3.0 - 2.0 * accumulatedDistance);
          float light = smoothDistance / (1.0 + distanceTravelled * distanceTravelled * 0.25);
          colour += vec3(light * 0.2 * uGlow * (1.0 + uAudio.y * uAudioDrive));
          layers += 1.0;
        }

        distanceTravelled += max(abs(surfaceDistance) * 0.7, threshold * 1.5);
      }

      colour = max(colour, vec3(0.0));
      float fireMix = dot(
        sin(ray.yzx * 8.0 + sin(ray.zxy * 8.0)),
        vec3(0.1666)
      ) + 0.4;
      colour = mix(
        colour,
        pow(colour.x * vec3(1.5, 1.0, 1.0), vec3(1.0, 2.5, 12.0)),
        fireMix
      );

      float greenMix = dot(
        sin(ray.yzx * 4.0 + sin(ray.zxy * 4.0)),
        vec3(0.1666)
      ) + 0.25;
      colour = mix(
        colour,
        vec3(colour.x * colour.x * 0.85, colour.x, colour.x * colour.x * 0.3),
        greenMix
      );

      gl_FragColor = vec4(max(colour, vec3(0.0)), 1.0);
    }
  \`;

  #value(setting, context) {
    return typeof setting === "function" ? setting(context) : setting;
  }

  #ensureShader() {
    if (!this.#output) {
      this.#output = createGraphics(width, height, WEBGL);
      this.#output.pixelDensity(1);
      this.#output.noStroke();
      this.#program = this.#output.createShader(this.#vertexSource, this.#fragmentSource);
    } else if (this.#output.width !== width || this.#output.height !== height) {
      this.#output.resizeCanvas(width, height);
    }
  }

  draw(context) {
    this.#ensureShader();
    this.#output.clear();
    this.#output.shader(this.#program);
    this.#program.setUniform("uResolution", [width, height]);
    this.#program.setUniform("uTime", context.time);
    this.#program.setUniform("uAudio", [
      context.audio.bass,
      context.audio.mid,
      context.audio.treble,
    ]);
    this.#program.setUniform("uSpeed", this.#value(this.speed, context));
    this.#program.setUniform("uThickness", this.#value(this.thickness, context));
    this.#program.setUniform("uJitter", this.#value(this.jitter, context));
    this.#program.setUniform("uGlow", this.#value(this.glow, context));
    this.#program.setUniform("uFisheye", this.#value(this.fisheye, context));
    this.#program.setUniform("uSwivel", this.#value(this.swivel, context));
    this.#program.setUniform("uAudioDrive", this.#value(this.audioDrive, context));
    this.#output.rect(0, 0, width, height);
    image(this.#output, 0, 0, width, height);
  }

  dispose() {
    this.#output?.remove();
    this.#output = null;
    this.#program = null;
  }
}

const transparentCubeField = new TransparentCubeField({
  speed: ({ audio }) => 0.8 + audio.bass * 0.35,
  thickness: 0.035,
  jitter: ({ audio }) => 0.018 + audio.treble * 0.018,
  glow: ({ audio }) => 0.9 + audio.mid * 0.35,
  fisheye: 0.5,
  swivel: 0.375,
  audioDrive: 0.3,
});`,
  },

  {
    name: 'mengerLightTunnel',
    title: 'Menger Light Tunnel',
    category: 'shader',
    blurb: 'Fast audio-reactive flight through a glowing Menger tunnel and orbiting light.',
    source: `// %% patch mengerLightTunnel
// @title Menger Light Tunnel
// @author Not identified in the supplied shader fragment
// @description A performance-minded Menger tunnel with a moving light orb.
// Original source URL and license were not included with the supplied fragment.
//
// p5js.live adaptation: portable GLSL ES camera math, initialized accumulators,
// readable Menger layers, a p5/WebGL wrapper, and audio-reactive live parameters.
// This is a source shader: put it before post-processing effects in the scene.
class MengerLightTunnel {
  #output = null;
  #program = null;

  constructor({
    speed = 1,
    scale = 4,
    glow = 1,
    orbSize = 0.01,
    roll = 0.3,
    audioDrive = 0.3,
  } = {}) {
    // Each setting may also be a function of { audio, time, controls, ... }.
    this.speed = speed;
    this.scale = scale; // Values from about 2 through 8 give useful variations.
    this.glow = glow;
    this.orbSize = orbSize;
    this.roll = roll;
    this.audioDrive = audioDrive;
  }

  #vertexSource = \`
    precision highp float;

    attribute vec3 aPosition;
    attribute vec2 aTexCoord;
    varying vec2 vTexCoord;

    void main() {
      vTexCoord = aTexCoord;
      vec4 position = vec4(aPosition, 1.0);
      position.xy = position.xy * 2.0 - 1.0;
      gl_Position = position;
    }
  \`;

  #fragmentSource = \`
    precision highp float;

    varying vec2 vTexCoord;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uAudio;
    uniform float uSpeed;
    uniform float uScale;
    uniform float uGlow;
    uniform float uOrbSize;
    uniform float uRoll;
    uniform float uAudioDrive;

    float lightAccumulation;
    float animationTime;

    vec3 path(float z) {
      return vec3(cos(z * 0.05) * 16.0, cos(z * 0.1) * 8.0, z);
    }

    mat2 rotate2d(float angle) {
      float cosine = cos(angle);
      float sine = sin(angle);
      return mat2(cosine, -sine, sine, cosine);
    }

    float orbDistance(vec3 point) {
      vec3 pathPoint = path(point.z);
      vec3 center = vec3(
        pathPoint.x + sin(point.z * 0.4) * 0.4,
        pathPoint.y + sin(sin(point.z * 0.3) + animationTime) * 0.5,
        5.0 + animationTime + tan(cos(animationTime * 0.2) * 0.5) * 3.2
      );
      return length(point - center);
    }

    float mengerCross(vec3 point, float cellSize, float hole) {
      vec3 repeated = abs(fract(point / cellSize) * cellSize - cellSize * 0.5);
      return min(
        max(repeated.x, repeated.y),
        min(max(repeated.y, repeated.z), max(repeated.x, repeated.z))
      ) - cellSize / hole;
    }

    float mengerField(vec3 point) {
      float cellSize = clamp(uScale, 2.0, 8.0);
      float distanceField = mengerCross(point, cellSize, 6.0);
      cellSize /= 4.0;
      return max(distanceField, mengerCross(point, cellSize, 3.5));
    }

    float sceneField(vec3 point) {
      vec3 originalPoint = point;
      point.xy -= path(point.z).xy;
      point.y += 0.1;

      float tunnel = max(1.0 - abs(point.x), 1.0 - abs(point.y));
      tunnel = min(tunnel, mengerField(point));
      float orb = orbDistance(originalPoint) - max(uOrbSize, 0.001);
      tunnel = min(tunnel, orb);
      lightAccumulation += 1.0 / max(orb, 0.001);
      return min(orb, max(-originalPoint.y - 5.35, tunnel));
    }

    // The original uses tanh(), which is not guaranteed in GLSL ES 1.00.
    vec4 softTanh(vec4 value) {
      return value / (1.0 + abs(value));
    }

    void main() {
      vec2 fragCoord = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;
      float drive = 1.0 + uAudio.x * uAudioDrive;
      animationTime = uTime * 6.0 * uSpeed * drive;
      lightAccumulation = 0.0;

      vec3 origin = path(animationTime);
      vec3 forward = normalize(path(animationTime + 3.0) - origin);
      vec3 right = normalize(vec3(forward.z, 0.0, -forward.x));
      vec3 up = normalize(cross(right, forward));
      vec2 screen = (fragCoord - uResolution * 0.5) / uResolution.y;
      screen = rotate2d(sin(animationTime * 0.2) * uRoll) * screen;
      vec3 direction = normalize(mat3(-right, up, forward) * vec3(screen, 1.0));

      float distanceTravelled = 0.0;
      vec4 colour = vec4(0.0);
      float audioGlow = uGlow * (1.0 + uAudio.y * uAudioDrive);

      for (int index = 0; index < 50; index++) {
        if (distanceTravelled >= 50.0) break;
        vec3 point = origin + direction * distanceTravelled;
        float stepSize = 0.01 + 0.65 * abs(sceneField(point));
        distanceTravelled += stepSize;

        colour += vec4(2.0, 10.0, 4.0, 0.0)
          * audioGlow / max(stepSize, 0.001);
        colour -= 60.0 * vec4(2.0, 1.0, 8.0, 0.0)
          * lightAccumulation / max(distanceTravelled, 0.001);
      }

      vec4 exposure = colour * colour / 400000000.0;
      gl_FragColor = vec4(softTanh(exposure).rgb, 1.0);
    }
  \`;

  #value(setting, context) {
    return typeof setting === "function" ? setting(context) : setting;
  }

  #ensureShader() {
    if (!this.#output) {
      this.#output = createGraphics(width, height, WEBGL);
      this.#output.pixelDensity(1);
      this.#output.noStroke();
      this.#program = this.#output.createShader(this.#vertexSource, this.#fragmentSource);
    } else if (this.#output.width !== width || this.#output.height !== height) {
      this.#output.resizeCanvas(width, height);
    }
  }

  draw(context) {
    this.#ensureShader();
    this.#output.clear();
    this.#output.shader(this.#program);
    this.#program.setUniform("uResolution", [width, height]);
    this.#program.setUniform("uTime", context.time);
    this.#program.setUniform("uAudio", [
      context.audio.bass,
      context.audio.mid,
      context.audio.treble,
    ]);
    this.#program.setUniform("uSpeed", this.#value(this.speed, context));
    this.#program.setUniform("uScale", this.#value(this.scale, context));
    this.#program.setUniform("uGlow", this.#value(this.glow, context));
    this.#program.setUniform("uOrbSize", this.#value(this.orbSize, context));
    this.#program.setUniform("uRoll", this.#value(this.roll, context));
    this.#program.setUniform("uAudioDrive", this.#value(this.audioDrive, context));
    this.#output.rect(0, 0, width, height);
    image(this.#output, 0, 0, width, height);
  }

  dispose() {
    this.#output?.remove();
    this.#output = null;
    this.#program = null;
  }
}

const mengerLightTunnel = new MengerLightTunnel({
  speed: ({ audio }) => 0.85 + audio.bass * 0.25,
  scale: 4,
  glow: ({ audio }) => 0.9 + audio.mid * 0.3,
  orbSize: ({ audio }) => 0.01 + audio.treble * 0.012,
  roll: 0.3,
  audioDrive: 0.3,
});`,
  },

  {
    name: 'patternCRT',
    title: 'Pattern CRT',
    category: 'shader',
    blurb: 'Five mathematical pattern generators cycling through a curved CRT display.',
    source: `// %% patch patternCRT
// @title Pattern CRT
// @author David A. Roberts — https://davidar.io
// @description Five mathematical pattern generators presented through a CRT simulation.
// Copyright (c) 2016 David A Roberts
// License: not specified in the supplied original source.
//
// CRT curvature, vignette, scanlines and grille adapted in the original from:
// https://www.shadertoy.com/view/XtlSD7
//
// AlgoLab adaptation: p5/WebGL wrapper, configurable supersampling and live controls.
class PatternCRT {
  #output = null;
  #program = null;

  constructor({
    speed = 1,
    scale = 1,
    curvature = 1,
    scanlines = 1,
    quality = 3,
    audioDrive = 0.2,
  } = {}) {
    // Every setting may also be a function of { audio, time, controls, ... }.
    this.speed = speed;
    this.scale = scale;
    this.curvature = curvature;
    this.scanlines = scanlines;
    this.quality = quality; // supersampling grid: 1 (fast) through 4 (smooth)
    this.audioDrive = audioDrive;
  }

  #vertexSource = \`
    precision highp float;

    attribute vec3 aPosition;
    attribute vec2 aTexCoord;
    varying vec2 vTexCoord;

    void main() {
      vTexCoord = aTexCoord;
      vec4 position = vec4(aPosition, 1.0);
      position.xy = position.xy * 2.0 - 1.0;
      gl_Position = position;
    }
  \`;

  #fragmentSource = \`
    precision highp float;

    varying vec2 vTexCoord;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uAudio;
    uniform float uSpeed;
    uniform float uScale;
    uniform float uCurvature;
    uniform float uScanlines;
    uniform float uQuality;
    uniform float uAudioDrive;

    #define PI 3.141592653589793

    vec2 crtCurveUV(vec2 uv) {
      uv = uv * 2.0 - 1.0;
      vec2 offset = abs(uv.yx) / vec2(6.0, 4.0);
      uv += uv * offset * offset * uCurvature;
      return uv * 0.5 + 0.5;
    }

    void drawVignette(inout vec3 colour, vec2 uv) {
      float vignette = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
      vignette = clamp(pow(max(16.0 * vignette, 0.0), 0.3), 0.0, 1.0);
      colour *= vignette;
    }

    void drawScanline(inout vec3 colour, vec2 uv, float time) {
      float scanline = clamp(
        0.95 + 0.05 * cos(PI * (uv.y + 0.008 * time) * 240.0),
        0.0,
        1.0
      );
      float grille = 0.85 + 0.15 * clamp(1.5 * cos(PI * uv.x * 640.0), 0.0, 1.0);
      colour *= mix(1.0, scanline * grille * 1.2, uScanlines);
    }

    float atanp(vec2 point) {
      return atan(point.y, point.x);
    }

    float cubeRoot(float value) {
      return sign(value) * pow(abs(value), 1.0 / 3.0);
    }

    float square(float value) {
      return value * value;
    }

    vec3 margarita(vec2 point) {
      float z = length(point) - 3.5 * atanp(point) + sin(point.x) + cos(point.y);
      if (mod(z, 7.0 * PI) < PI / 2.0) return vec3(1.0, 0.0, 0.0);
      if (mod(z, PI) < PI / 2.0) return vec3(0.0);
      return vec3(1.0);
    }

    vec3 digitalBacteria(vec2 point) {
      point /= 4.0;
      float x = square(sin(point.x) + point.y) + square(cos(point.y) + point.x);
      float y = cos(10.0 * point.x) + cos(10.0 * point.y) - sin(point.x * point.y);
      float z = square(sin(floor(point.x)) + floor(point.y))
        + square(cos(floor(point.y)) + floor(point.x));
      if (17.0 < x && x < 21.0 && 17.0 < z && z < 21.0 && y < 0.0) {
        return vec3(1.0, 1.0, 85.0 / 256.0);
      }
      if (17.0 < z && z < 21.0) return vec3(85.0 / 256.0, 0.0, 0.0);
      if (17.0 < x && x < 21.0) return vec3(170.0 / 256.0, 170.0 / 256.0, 0.0);
      return vec3(85.0 / 256.0, 85.0 / 256.0, 0.0);
    }

    vec3 threesome(vec2 point) {
      point /= 3.0;
      float z = 1.0;
      z *= sin(length(point + vec2(5.0, 0.0))) * cos(8.0 * atanp(point + vec2(5.0, 0.0)));
      z *= sin(length(point - vec2(5.0, 5.0))) * cos(8.0 * atanp(point - vec2(5.0, 5.0)));
      z *= sin(length(point + vec2(0.0, 5.0))) * cos(8.0 * atanp(point + vec2(0.0, 5.0)));
      if ((-0.1 < z && z < 0.0) || 0.2 < z) return vec3(0.0);
      return vec3(1.0);
    }

    vec3 plaidMeltdown(vec2 point) {
      point /= 15.0;
      point += 7.0;
      float a = 2.0 * sin(point.x * sin(point.y) + point.y * sin(point.x));
      float b = cubeRoot(sin(2.5 * sqrt(2.0) * (point.x - point.y)));
      float c = cubeRoot(sin(2.5 * sqrt(2.0) * (point.x + point.y)));
      float d = sin(80.0 * point.x) + sin(80.0 * point.y);
      if (0.25 * (a + b + c) > 0.5 * d) return vec3(0.0);
      return vec3(1.0);
    }

    vec3 sunlightRevealed(vec2 point) {
      point /= 6.0;
      point.x += 2.0;
      float a = length(vec2(3.0 - point.x, point.y)) + abs(point.y) + abs(1.0 - point.x);
      float f = atan(point.y, point.x - 1.0);
      float c = atan(point.y, point.x - 3.0);
      float radius = square(point.x - 1.0) + square(point.y);
      vec3 colour = vec3(0.0);
      bool mixed = false;

      if (5.0 < a && a < 7.0 && mod(f, PI / 7.0) < PI / 14.0) {
        colour += vec3(0.0, 82.0 / 256.0, 173.0 / 256.0);
        if (mixed) colour /= 2.0;
        mixed = true;
      }
      if (5.0 < a && a < 7.0 && mod(c, PI / 9.0) < PI / 18.0) {
        colour += vec3(1.0, 0.0, 0.0);
        if (mixed) colour /= 2.0;
        mixed = true;
      }
      if (5.0 < a && a < 7.0 && mod(f, PI / 8.0) < PI / 16.0) {
        colour += vec3(1.0, 1.0, 0.0);
        if (mixed) colour /= 2.0;
        mixed = true;
      }
      float safeF = sign(f) * max(abs(f), 0.0001);
      if (
        (45.0 - 3.0 * point.x) * PI / 180.0 < f
        && f < (47.0 - point.x) * PI / 180.0
        && point.y > 0.1 * point.x
        && mod(log(max(radius, 0.0001)) / log(abs(safeF)), 2.0) < 1.0
      ) {
        colour += vec3(1.0);
        if (mixed) colour /= 2.0;
      }
      return colour;
    }

    vec3 pattern(vec2 point, float time) {
      float phase = mod(0.1 * time, 5.0);
      if (phase < 1.0) return margarita(point);
      if (phase < 2.0) return plaidMeltdown(point);
      if (phase < 3.0) return sunlightRevealed(point);
      if (phase < 4.0) return threesome(point);
      return digitalBacteria(point);
    }

    void main() {
      vec2 fragCoord = vec2(vTexCoord.x, 1.0 - vTexCoord.y) * uResolution;
      float time = uTime * uSpeed;
      float animation = mod(time, 10.0);
      float samples = clamp(floor(uQuality + 0.5), 1.0, 4.0);
      float sampleCount = samples * samples;
      vec3 colour = vec3(0.0);

      // A fixed upper bound is portable in WebGL 1; uQuality chooses how many
      // samples actually run.
      for (int index = 0; index < 16; index++) {
        float sampleIndex = float(index);
        if (sampleIndex >= sampleCount) continue;
        vec2 offset = vec2(
          floor(sampleIndex / samples),
          mod(sampleIndex, samples)
        ) / samples;
        vec2 uv = (fragCoord + offset) / uResolution;
        vec2 crtUV = crtCurveUV(uv);
        if (crtUV.x < 0.0 || crtUV.x > 1.0 || crtUV.y < 0.0 || crtUV.y > 1.0) continue;

        vec2 point = 50.0 * crtUV - 25.0;
        float musicScale = 1.0 + uAudio.x * uAudioDrive;
        point *= (0.75 + 0.05 * animation) * uScale * musicScale;
        point += animation - 5.0;
        point.x *= uResolution.x / uResolution.y;

        if (animation < 2.0 || 8.0 < animation) {
          float fade = smoothstep(0.0, 2.0, animation) - smoothstep(8.0, 10.0, animation);
          float pixelScale = uResolution.y / 50.0 * samples * fade + 1.0;
          point = floor(point * pixelScale) / pixelScale;
        }

        vec3 sampleColour = pattern(point, time);
        drawVignette(sampleColour, crtUV);
        drawScanline(sampleColour, uv, time);
        colour += sampleColour / sampleCount;
      }

      colour *= 1.0 + uAudio.y * uAudioDrive * 0.35;
      gl_FragColor = vec4(colour, 1.0);
    }
  \`;

  #value(setting, context) {
    return typeof setting === "function" ? setting(context) : setting;
  }

  #ensureShader() {
    if (!this.#output) {
      this.#output = createGraphics(width, height, WEBGL);
      this.#output.pixelDensity(1);
      this.#output.noStroke();
      this.#program = this.#output.createShader(this.#vertexSource, this.#fragmentSource);
    } else if (this.#output.width !== width || this.#output.height !== height) {
      this.#output.resizeCanvas(width, height);
    }
  }

  draw(context) {
    this.#ensureShader();
    this.#output.clear();
    this.#output.shader(this.#program);
    this.#program.setUniform("uResolution", [width, height]);
    this.#program.setUniform("uTime", context.time);
    this.#program.setUniform("uAudio", [
      context.audio.bass,
      context.audio.mid,
      context.audio.treble,
    ]);
    this.#program.setUniform("uSpeed", this.#value(this.speed, context));
    this.#program.setUniform("uScale", this.#value(this.scale, context));
    this.#program.setUniform("uCurvature", this.#value(this.curvature, context));
    this.#program.setUniform("uScanlines", this.#value(this.scanlines, context));
    this.#program.setUniform("uQuality", this.#value(this.quality, context));
    this.#program.setUniform("uAudioDrive", this.#value(this.audioDrive, context));
    this.#output.rect(0, 0, width, height);
    image(this.#output, 0, 0, width, height);
  }

  dispose() {
    this.#output?.remove();
    this.#output = null;
    this.#program = null;
  }
}

const patternCRT = new PatternCRT({
  speed: 1,
  scale: ({ audio }) => 1 + audio.bass * 0.08,
  curvature: 1,
  scanlines: 1,
  quality: 3,
  audioDrive: 0.2,
});`,
  },

  {
    name: 'shaderFlow',
    category: 'shader',
    blurb: 'A fluent single-pass ShaderChain with audio- and time-driven operators.',
    source: `// %% patch shaderFlow
// shaderFlow — ShaderChain is an ordinary patch object with a fluent API.
// Each argument may be a number or a function of the normal draw context.
// Put the finished chain after drawing patches so it transforms their combined image.
const shaderFlow = new ShaderChain()
  .rotate(({ time, audio }) => time * 0.035 + audio.mid * 0.08)
  .scale(({ audio }) => 1.02 + audio.bass * 0.16)
  .kaleid(6)
  .hue(({ time, audio }) => sin(time * 0.17) * 0.025 + audio.treble * 0.12)
  .saturate(1.22)
  .contrast(1.08);`,
  },

  {
    name: 'transformFx',
    category: 'shader',
    blurb: 'Effect: position, independent scale, rotation and anchor in one transform.',
    source: `// %% patch transformFx
// transformFx — the standard stage transform. Values are normalized to canvas size.
const transformFx = new ShaderChain()
  .transform(
    ({ audio, time }) => sin(time * 0.24) * audio.mid * 0.04,  // x
    0,                                                        // y
    ({ audio }) => 1 + audio.bass * 0.12,                    // scale x
    ({ audio }) => 1 + audio.bass * 0.12,                    // scale y
    ({ time }) => sin(time * 0.18) * 0.08,                   // rotation
    0.5, 0.5                                                  // anchor
  )
  .mix(1);`,
  },

  {
    name: 'softBlur',
    category: 'shader',
    blurb: 'Effect: nine-tap audio-reactive blur with wet/dry control.',
    source: `// %% patch softBlur
// softBlur — radius is measured in canvas pixels.
const softBlur = new ShaderChain()
  .blur(({ audio }) => 0.5 + audio.mid * 5)
  .mix(0.82);`,
  },

  {
    name: 'edgeDetect',
    category: 'shader',
    blurb: 'Effect: luminance edge detector composited over the source.',
    source: `// %% patch edgeDetect
// edgeDetect — Screen keeps the source while adding bright detected edges.
const edgeDetect = new ShaderChain()
  .edgeDetect(({ audio }) => 1.2 + audio.treble * 4, 1.25)
  .blend("screen")
  .mix(0.72);`,
  },

  {
    name: 'bloom',
    category: 'shader',
    blurb: 'Effect: spreads bright highlights into a restrained audio-reactive glow.',
    source: `// %% patch bloom
// bloom — threshold chooses which highlights glow.
const bloom = new ShaderChain()
  .bloom(
    ({ audio }) => 0.35 + audio.bass * 1.1,
    ({ audio }) => 2 + audio.mid * 8,
    0.48
  )
  .mix(0.9);`,
  },

  {
    name: 'vignette',
    category: 'shader',
    blurb: 'Effect: gently darkens the edges without introducing a background.',
    source: `// %% patch vignette
// vignette — useful near the end of a scene to focus the image.
const vignette = new ShaderChain()
  .vignette(({ audio }) => 0.28 + audio.bass * 0.18, 0.42)
  .mix(1);`,
  },

  {
    name: 'noiseWarp',
    category: 'shader',
    blurb: 'Effect: animated value-noise displacement for fluid distortion.',
    source: `// %% patch noiseWarp
// noiseWarp — amount, spatial scale and time speed.
const noiseWarp = new ShaderChain()
  .noiseWarp(
    ({ audio }) => 0.006 + audio.bass * 0.035,
    5,
    ({ audio }) => 0.08 + audio.treble * 0.3
  )
  .mix(0.9);`,
  },

  {
    name: 'rgbSplit',
    category: 'shader',
    blurb: 'Effect: separates red and blue channels along a controllable direction.',
    source: `// %% patch rgbSplit
// rgbSplit — displacement is measured in pixels; angle is radians.
const rgbSplit = new ShaderChain()
  .rgbSplit(
    ({ audio }) => 1 + audio.treble * 14,
    ({ time }) => time * 0.13
  )
  .mix(({ audio }) => 0.35 + audio.mid * 0.55);`,
  },

  {
    name: 'feedbackEcho',
    category: 'shader',
    blurb: 'Effect: previous-frame echo with controllable decay and zoom.',
    source: `// %% patch feedbackEcho
// feedbackEcho — amount, decay and zoom. Keep decay below 1 to prevent whiteout.
const feedbackEcho = new ShaderChain()
  .feedback(
    ({ audio }) => 0.25 + audio.bass * 0.45,
    0.955,
    ({ audio }) => 1.002 + audio.mid * 0.008
  )
  .mix(0.88);`,
  },

  {
    name: 'lumaMask',
    category: 'shader',
    blurb: 'Effect: converts image brightness into transparency.',
    source: `// %% patch lumaMask
// lumaMask — threshold, soft edge, invert (0 normal; 1 inverted).
const lumaMask = new ShaderChain()
  .lumaMask(({ audio }) => 0.18 + audio.mid * 0.2, 0.09, 0)
  .mix(1);`,
  },

  {
    name: 'mirror',
    category: 'shader',
    blurb: 'Effect: horizontal or vertical reflection with no generated backing.',
    source: `// %% patch mirror
// mirror — horizontal and vertical amounts range from 0 to 1.
const mirror = new ShaderChain()
  .mirror(1, ({ audio }) => audio.bass > 0.72 ? 1 : 0)
  .mix(1);`,
  },

  {
    name: 'prismMirror',
    category: 'shader',
    blurb: 'A tiny kaleidoscope recipe with bass zoom and slowly rotating colour.',
    source: `// %% patch prismMirror
// prismMirror transforms every patch before it in the scene array.
// Each arrow is re-evaluated on every frame.
const prismMirror = new ShaderChain()
  .kaleid(({ audio }) => 5 + floor(audio.mid * 4))
  .rotate(({ time, audio }) => time * 0.035 + audio.treble * 0.1)
  .scale(({ audio }) => 1.04 + audio.bass * 0.2)
  .hue(({ time }) => sin(time * 0.16) * 0.08)
  .saturate(1.35)
  .contrast(1.1);`,
  },

  {
    name: 'slowRotate',
    category: 'shader',
    blurb: 'Rotates everything before it around the center. One-operation ShaderChain patch.',
    source: `// %% patch slowRotate
// slowRotate — the smallest useful transform shader.
// Change 0.06 to reverse or accelerate the continuous turn.
const slowRotate = new ShaderChain()
  .rotate(({ time, audio }) =>
    time * 0.06 + audio.mid * 0.08
  );`,
  },

  {
    name: 'bassZoom',
    category: 'shader',
    blurb: 'Scales preceding layers from the center in response to bass.',
    source: `// %% patch bassZoom
// bassZoom — one audio value controls one spatial operation.
// Raising 0.24 makes the bass punches travel farther.
const bassZoom = new ShaderChain()
  .scale(({ audio }) =>
    1.0 + audio.bass * 0.24
  );`,
  },

  {
    name: 'pixelDrift',
    category: 'shader',
    blurb: 'Audio-sized pixels drift through offset repeats and a compact colour palette.',
    source: `// %% patch pixelDrift
// pixelDrift is a post-processing patch: put it after the image it should affect.
const pixelDrift = new ShaderChain()
  .pixelate(
    ({ audio }) => 120 - audio.bass * 80,
    ({ audio }) => 80 - audio.mid * 50
  )
  .repeatX(2, ({ audio }) => audio.treble * 0.18)
  .scrollX(({ time, audio }) => time * 0.015 + audio.treble * 0.05)
  .posterize(({ audio }) => 5 + floor(audio.mid * 5), 0.72)
  .contrast(1.15);`,
  },

  {
    name: 'neonInk',
    category: 'shader',
    blurb: 'Turns preceding layers into a beat-sensitive two-tone neon silhouette.',
    source: `// %% patch neonInk
// neonInk reduces a complex image to a sharply coloured silhouette.
const neonInk = new ShaderChain()
  .thresh(({ audio }) => 0.34 - audio.bass * 0.12, 0.08)
  .color(0.18, 0.95, 0.7, 1)
  .hue(({ time, audio }) => time * 0.015 + audio.treble * 0.12)
  .saturate(1.5)
  .contrast(1.18);`,
  },

  {
    name: 'cellularBlobular',
    category: 'shader',
    blurb: 'Soft polygon cells twisted by noise and their previous frame. Feedback shader class.',
    source: `// %% patch cellularBlobular
// @title Cellular & Blobular — p5js live study
// @author After Mahalia H-R (IG: mm_hr_)
// @description A p5/WebGL interpretation of the Hydra sketch mahalia_4.
// Original sketch: https://hydra.ojack.xyz/?sketch_id=mahalia_4
// Adaptation license: CC BY-NC-SA 4.0
//
// The original Hydra chain starts with a soft 20-sided shape, repeats and scales it,
// twists it with its previous output, then distorts it with noise. This class keeps
// two GPU buffers so one frame can modulate the next in the same spirit.
class CellularBlobular {
  #buffers = [];
  #programs = [];
  #writeIndex = 0;

  constructor({
    speed = 0.3,
    sides = 20,
    cells = 10,
    twist = 5.5,
    noiseAmount = 0.16,
    colour = [0.48, 0.76, 1.0],
  } = {}) {
    this.speed = speed;
    this.sides = sides;
    this.cells = cells;
    this.twist = twist;
    this.noiseAmount = noiseAmount;
    this.colour = colour;
  }

  // Hydra evaluates arrow-function arguments on every frame. These two controls do
  // the same thing in ordinary JavaScript, before their values enter the shader.
  scale = ({ audio, time }) => {
    const wave = sin(time * this.speed);
    return (wave + 2.0) * (wave + 1.5) * (1.0 + audio.bass * 0.12);
  };

  repeats = ({ audio, time }) =>
    1.0 + abs(sin(time * this.speed)) * this.cells + audio.mid * 2.0;

  #vertexSource = \`
    precision highp float;

    attribute vec3 aPosition;
    attribute vec2 aTexCoord;
    varying vec2 vTexCoord;

    void main() {
      vTexCoord = aTexCoord;
      vec4 position = vec4(aPosition, 1.0);
      position.xy = position.xy * 2.0 - 1.0;
      gl_Position = position;
    }
  \`;

  #fragmentSource = \`
    precision highp float;

    varying vec2 vTexCoord;
    uniform sampler2D uFeedback;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uAudio;
    uniform float uScale;
    uniform float uRepeats;
    uniform float uSides;
    uniform float uTwist;
    uniform float uNoiseAmount;
    uniform vec3 uColour;

    const float PI = 3.141592653589793;
    const float TAU = 6.283185307179586;

    mat2 turn(float angle) {
      float sine = sin(angle);
      float cosine = cos(angle);
      return mat2(cosine, -sine, sine, cosine);
    }

    float hash21(vec2 point) {
      point = fract(point * vec2(123.34, 456.21));
      point += dot(point, point + 45.32);
      return fract(point.x * point.y);
    }

    float valueNoise(vec2 point) {
      vec2 cell = floor(point);
      vec2 local = fract(point);
      local = local * local * (3.0 - 2.0 * local);
      return mix(
        mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), local.x),
        mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0)), local.x),
        local.y
      );
    }

    float fbm(vec2 point) {
      float result = 0.0;
      float weight = 0.5;
      for (int octave = 0; octave < 4; octave++) {
        result += valueNoise(point) * weight;
        point = turn(0.73) * point * 2.03 + 13.7;
        weight *= 0.5;
      }
      return result;
    }

    float polygonDistance(vec2 point, float sides) {
      float angle = atan(point.y, point.x) + PI;
      float sector = TAU / max(3.0, sides);
      return cos(floor(0.5 + angle / sector) * sector - angle) * length(point);
    }

    void main() {
      vec2 uv = vTexCoord;
      vec2 point = uv * 2.0 - 1.0;
      point.x *= uResolution.x / uResolution.y;

      float drift = uTime * 0.3;
      vec2 noisePoint = point * 1.4 + vec2(drift * 0.31, -drift * 0.23);
      vec2 noiseFlow = vec2(
        fbm(noisePoint + 7.1),
        fbm(noisePoint.yx - 4.3)
      ) - 0.5;

      // Hydra's modulateRotate(o0): brightness in the last output becomes a local
      // rotation in this output. A tiny noise offset keeps the feedback from locking.
      vec2 feedbackUv = clamp(uv + noiseFlow * 0.012, 0.002, 0.998);
      vec3 previous = texture2D(uFeedback, feedbackUv).rgb;
      float feedbackLight = dot(previous, vec3(0.299, 0.587, 0.114));
      float localTurn = (feedbackLight - 0.22) * uTwist;

      point = turn(-1.0 - uTime * 0.06) * point;
      point += noiseFlow * (uNoiseAmount + uAudio.y * 0.055);
      point = turn(localTurn) * point;
      point /= max(0.35, uScale);

      vec2 cell = fract(point * max(1.0, uRepeats) + 0.5) - 0.5;
      float distanceToShape = polygonDistance(cell, uSides);
      float radius = 0.205 + uAudio.x * 0.028;
      float softness = 0.045 + uAudio.y * 0.025;
      float body = 1.0 - smoothstep(radius, radius + softness, distanceToShape);
      float rim = smoothstep(radius - 0.035, radius, distanceToShape) * body;

      float cloudy = 0.72 + fbm(point * 3.0 - drift) * 0.42;
      vec3 colour = uColour * body * cloudy;
      colour += uColour * rim * (0.30 + uAudio.z * 0.38);

      // Like Hydra's modulateRotate(), feedback changes coordinates rather than
      // blending old colour into the new frame. That keeps the cells clean over time.
      colour = pow(max(colour, 0.0), vec3(0.84));

      float alpha = clamp(body + rim, 0.0, 1.0);
      gl_FragColor = vec4(colour, alpha);
    }
  \`;

  #makeBuffer() {
    const buffer = createGraphics(width, height, WEBGL);
    buffer.pixelDensity(1);
    buffer.noStroke();
    buffer.clear();
    return buffer;
  }

  #ensureShader() {
    if (this.#buffers.length === 0) {
      this.#buffers = [this.#makeBuffer(), this.#makeBuffer()];
      this.#programs = this.#buffers.map((buffer) =>
        buffer.createShader(this.#vertexSource, this.#fragmentSource)
      );
      return;
    }

    if (this.#buffers[0].width !== width || this.#buffers[0].height !== height) {
      for (const buffer of this.#buffers) {
        buffer.resizeCanvas(width, height);
        buffer.clear();
      }
    }
  }

  draw({ audio, time }) {
    this.#ensureShader();
    const write = this.#buffers[this.#writeIndex];
    const read = this.#buffers[1 - this.#writeIndex];
    const program = this.#programs[this.#writeIndex];

    write.clear();
    write.shader(program);
    program.setUniform("uFeedback", read);
    program.setUniform("uResolution", [width, height]);
    program.setUniform("uTime", time);
    program.setUniform("uAudio", [audio.bass, audio.mid, audio.treble]);
    program.setUniform("uScale", this.scale({ audio, time }));
    program.setUniform("uRepeats", this.repeats({ audio, time }));
    program.setUniform("uSides", this.sides);
    program.setUniform("uTwist", this.twist);
    program.setUniform("uNoiseAmount", this.noiseAmount);
    program.setUniform("uColour", this.colour);
    write.rect(0, 0, width, height);
    image(write, 0, 0, width, height);

    this.#writeIndex = 1 - this.#writeIndex;
  }

  dispose() {
    for (const buffer of this.#buffers) buffer.remove();
    this.#buffers = [];
    this.#programs = [];
    this.#writeIndex = 0;
  }
}

const cellularBlobular = new CellularBlobular();`,
  },

  {
    name: 'kaleido',
    category: 'visual',
    blurb: 'Radial kaleidoscope geometry made by a higher-order patch factory.',
    source: `// %% patch kaleido
// A factory returns a configured object with radial symmetry.
//   const sixFold = makeKaleido(6, 35);
function makeKaleido(segments, hue) {
  return {
    segments,
    hue,

    draw({ audio, time }) {
      colorMode(HSB, 360, 100, 100, 1);
      blendMode(ADD);
      noFill();
      translate(width / 2, height / 2);
      rotate(time * (0.08 + audio.mid * 0.16));

      const inner = min(width, height) * (0.08 + audio.bass * 0.08);
      const outer = min(width, height) * (0.25 + audio.mid * 0.12);
      for (let i = 0; i < this.segments; i++) {
        rotate(TWO_PI / this.segments);
        stroke((this.hue + i * 360 / this.segments) % 360, 65, 100, 0.42);
        strokeWeight(1 + audio.treble * 2);
        triangle(inner, 0, outer, -outer * 0.18, outer, outer * 0.18);
        circle(outer, 0, 8 + audio.treble * 24);
      }
    },
  };
}

const kaleido = makeKaleido(12, 285);`,
  },

  {
    name: 'pixelRain',
    category: 'visual',
    blurb: 'Falling luminous pixels made by a stateful patch factory.',
    source: `// %% patch pixelRain
// Every factory call gets independent configuration and scene state.
function makePixelRain(count, hue) {
  return {
    count,
    hue,

    state() {
      return { drops: [] };
    },

    draw({ audio, state, dt }) {
      while (state.drops.length < this.count) {
        state.drops.push({
          x: random(width),
          y: random(-height, height),
          speed: random(40, 150),
          size: random(3, 10),
        });
      }
      if (state.drops.length > this.count) state.drops.length = this.count;

      colorMode(HSB, 360, 100, 100, 1);
      blendMode(ADD);
      noStroke();
      for (const drop of state.drops) {
        drop.y += drop.speed * (0.5 + audio.treble * 2.2) * dt;
        if (drop.y > height + drop.size) {
          drop.y = -drop.size;
          drop.x = random(width);
        }
        fill((this.hue + drop.y / height * 70) % 360, 65, 100, 0.52);
        rect(drop.x, drop.y, drop.size, drop.size * (1 + audio.level * 3));
      }
    },
  };
}

const pixelRain = makePixelRain(80, 175);`,
  },

  {
    name: 'neonTunnel',
    category: 'visual',
    blurb: 'Concentric polygon travel made by a configurable class instance.',
    source: `// %% patch neonTunnel
class NeonTunnel {
  constructor({ rings = 16, sides = 6, hue = 275 } = {}) {
    this.rings = rings;
    this.sides = sides;
    this.hue = hue;
  }

  polygon(radius) {
    beginShape();
    for (let i = 0; i < this.sides; i++) {
      const angle = (TWO_PI * i) / this.sides;
      vertex(cos(angle) * radius, sin(angle) * radius);
    }
    endShape(CLOSE);
  }

  draw({ audio, time }) {
    colorMode(HSB, 360, 100, 100, 1);
    blendMode(ADD);
    noFill();
    translate(width / 2, height / 2);
    rotate(time * 0.06);

    const limit = Math.hypot(width, height) * 0.62;
    const speed = 0.12 + audio.bass * 0.5;
    for (let i = 0; i < this.rings; i++) {
      const phase = (i / this.rings + time * speed) % 1;
      const radius = 12 + pow(phase, 1.8) * limit;
      stroke((this.hue + phase * 100) % 360, 70, 100, (1 - phase) * 0.58);
      strokeWeight(1 + audio.mid * 2);
      this.polygon(radius);
    }
  }
}

const neonTunnel = new NeonTunnel();`,
  },

  {
    name: 'beatBurst',
    category: 'visual',
    blurb: 'Beat-triggered particles made by a class with lifecycle state.',
    source: `// %% patch beatBurst
class BeatBurst {
  constructor({ amount = 24, hue = 25, life = 0.8 } = {}) {
    this.amount = amount;
    this.hue = hue;
    this.life = life;
  }

  state() {
    return { particles: [] };
  }

  beat({ state, audio }) {
    for (let i = 0; i < this.amount; i++) {
      const angle = random(TWO_PI);
      const speed = random(80, 260) * (0.7 + audio.bass);
      state.particles.push({
        x: width / 2,
        y: height / 2,
        vx: cos(angle) * speed,
        vy: sin(angle) * speed,
        life: this.life,
      });
    }
    if (state.particles.length > 360) {
      state.particles.splice(0, state.particles.length - 360);
    }
  }

  draw({ state, dt }) {
    colorMode(HSB, 360, 100, 100, 1);
    blendMode(ADD);
    noStroke();
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const particle = state.particles[i];
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.985;
      particle.vy *= 0.985;
      particle.life -= dt;
      if (particle.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      fill((this.hue + i * 2) % 360, 70, 100, particle.life / this.life);
      circle(particle.x, particle.y, 3 + particle.life * 8);
    }
  }
}

const beatBurst = new BeatBurst();`,
  },
];

export const RAVE_PATCH_NAMES = [
  'checkerZoom',
  'neonTunnel',
  'spectrumHalo',
  'kaleido',
  'pixelRain',
  'waveScope',
  'laserFan',
  'glitchSlices',
  'beatBurst',
  'strobe',
];

export const MODULAR_PATCH_NAMES = [
  'roseWindow',
  'waveTerrain',
  'moireField',
  'prismMirror',
  'slowRotate',
  'bassZoom',
  'pixelDrift',
  'neonInk',
];

export const STANDARD_EFFECT_NAMES = [
  'transformFx',
  'softBlur',
  'edgeDetect',
  'bloom',
  'vignette',
  'noiseWarp',
  'rgbSplit',
  'feedbackEcho',
  'lumaMask',
  'mirror',
];

export const DIAGNOSTIC_PATCH_NAMES = [
  'waveform',
  'frequencyBars',
  'audioMeters',
];

/**
 * Update copied system diagnostics without rewriting unrelated project code.
 * Only the exact former defaults inside the named patch cells are replaced.
 */
export function upgradeOpaqueDiagnostics(source) {
  const updateCell = (sourceText, name, replacements) =>
    sourceText.replace(
      new RegExp(`(// %% patch ${name}\\n[\\s\\S]*?)(?=\\n// %% |$)`),
      (cell) => replacements.reduce(
        (updated, [before, after]) => updated.replaceAll(before, after),
        cell,
      ),
    );

  const frequencyUpdated = updateCell(source, 'frequencyBars', [
    ['panelHeight: 0.34', 'heightRatio: 0.34'],
    ['this.panelHeight', 'this.heightRatio'],
    ['fill(100, 145, 255, 230)', 'fill(100, 145, 255)'],
    ['fill(190, 125, 255, 230)', 'fill(190, 125, 255)'],
    ['fill(255, 190, 95, 230)', 'fill(255, 190, 95)'],
  ]);

  const metersUpdated = updateCell(frequencyUpdated, 'audioMeters', [
    ['fill(...colour, 220)', 'fill(...colour)'],
  ]);

  const ellipseUpdated = updateCell(metersUpdated, 'breathingEllipse', [
    ['    background(8, 8, 12); // Clear the previous frame so shrinking stays visible.\n', ''],
  ]);

  const checkerUpdated = updateCell(ellipseUpdated, 'checkerZoom', [
    ['// Keep it first: it provides the dark fade behind the other patches.',
      '// Add solidBackground before it when the scene should clear each frame.'],
    ['  noStroke();\n  fill(4, 4, 10, 35);\n  rect(0, 0, width, height);\n\n', ''],
  ]);

  return updateCell(checkerUpdated, 'cellularBlobular', [
    ['      gl_FragColor = vec4(colour, 1.0);',
      '      float alpha = clamp(body + rim, 0.0, 1.0);\n      gl_FragColor = vec4(colour, alpha);'],
    ['    write.shader(program);', '    write.clear();\n    write.shader(program);'],
  ]);
}

/** Ready-made source that mixes all ten system library patches. */
export const libraryDemoSource = () => `// %% scene stacked
// Ten independently configurable patches, composited in array order.
// The patches remain transparent unless solidBackground is added explicitly.
const stacked = [
  checkerZoom,
  neonTunnel,
  spectrumHalo,
  kaleido,
  pixelRain,
  waveScope,
  laserFan,
  glitchSlices,
  beatBurst,
  strobe,
];
activate(stacked);`;

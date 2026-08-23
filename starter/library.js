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
// Configuration remains ordinary JavaScript, with one param() example for a control
// that can be performed live from the Parameters panel.

/** @typedef {{ name: string, blurb: string, category: 'visual'|'utility'|'shader'|'community', source: string }} LibraryEntry */

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
// checkerSpeed appears in the Parameters panel.
param("checkerSpeed", 0.08, { min: -0.4, max: 0.4, step: 0.01 });

const checkerZoom = ({ audio, time, params }) => {
  const cell = 58 + audio.bass * 38;
  const extent = Math.hypot(width, height) * 0.75;

  translate(width / 2, height / 2);
  rotate(time * params.checkerSpeed);
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

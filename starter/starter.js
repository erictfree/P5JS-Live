// The compact p5js live starter project: one transparent drawing patch followed by one
// post-processing shader. Everything else begins in the Patch Library.

export const STARTER_SOURCE = `// %% patch asciiNoise
// p5js live — starter scene
//
// A patch is an ordinary function, object, or class instance that can draw.
// A scene is an array of patches, drawn from first to last.
//
// asciiNoise and Plasma are active below. Open the Patch Library to install another
// patch, add it to the scene source, then press Cmd/Ctrl+Enter in that scene cell.

// asciiNoise — a changing character grid that layers over earlier patches.
// Try changing these properties live, or call asciiNoise.shuffle().
const asciiNoise = {
  characters: " .,:;irsXA253hMHGS#9B&@",
  cellSize: 24,
  density: 0.42,
  changeRate: 10,
  hue: 155,
  shuffleVersion: 0,

  shuffle() {
    this.shuffleVersion += 1;
  },

  state() {
    return { columns: 0, rows: 0, cells: [], elapsed: 0, shuffleVersion: -1 };
  },

  rebuild(state) {
    state.columns = max(1, ceil(width / this.cellSize));
    state.rows = max(1, ceil(height / this.cellSize));
    state.cells = Array.from(
      { length: state.columns * state.rows },
      () => ({ glyph: random(), visibility: random(), phase: random(TWO_PI) }),
    );
    state.shuffleVersion = this.shuffleVersion;
  },

  draw({ audio, state, dt, time }) {
    const columns = max(1, ceil(width / this.cellSize));
    const rows = max(1, ceil(height / this.cellSize));
    if (
      columns !== state.columns ||
      rows !== state.rows ||
      state.shuffleVersion !== this.shuffleVersion
    ) this.rebuild(state);

    state.elapsed += dt;
    if (audio.beat || state.elapsed >= 1 / this.changeRate) {
      state.elapsed = 0;
      const fraction = audio.beat ? 0.32 : 0.015 + audio.treble * 0.08;
      const changes = max(1, floor(state.cells.length * fraction));
      for (let i = 0; i < changes; i++) {
        const cell = random(state.cells);
        cell.glyph = random();
        cell.visibility = random();
        cell.phase = random(TWO_PI);
      }
    }

    const glyphs = this.characters || "@";
    const visible = constrain(this.density + audio.level * 0.3, 0, 1);
    const jitter = audio.treble * this.cellSize * 0.16;
    colorMode(HSB, 360, 100, 100, 1);
    blendMode(ADD);
    textFont("monospace");
    textAlign(CENTER, CENTER);
    textSize(this.cellSize * (0.72 + audio.mid * 0.18));
    noStroke();

    for (let index = 0; index < state.cells.length; index++) {
      const cell = state.cells[index];
      if (cell.visibility > visible) continue;
      const column = index % state.columns;
      const row = floor(index / state.columns);
      const band = row / max(1, state.rows - 1);
      const energy = lerp(audio.bass, audio.treble, band);
      const glyphIndex = floor((cell.glyph + energy * 0.45) * glyphs.length) % glyphs.length;
      const x = (column + 0.5) * this.cellSize + sin(time * 2 + cell.phase) * jitter;
      const y = (row + 0.5) * this.cellSize + cos(time * 1.7 + cell.phase) * jitter;
      fill(
        (this.hue + column * 2.2 + row * 1.3 + time * 8) % 360,
        38 + audio.mid * 45,
        64 + energy * 36,
        0.2 + energy * 0.62,
      );
      text(glyphs[glyphIndex], x, y);
    }
  },
};

// %% patch plasma

// plasma — a live post-processing shader implemented as a real class instance.
//
// Put post-processors LAST in a scene. Plasma captures everything earlier patches
// drew, sends that image and the audio into a fragment shader, then replaces the
// canvas with the warped result. GPU resources stay on the object, not in saved state.
class Plasma {
  #output = null;
  #program = null;

  // -------------------------------------------------------------------------
  // LIVE CONTROLS — change these, then press Cmd/Ctrl+Enter anywhere in this cell.
  // -------------------------------------------------------------------------
  speed = 0.35;  // 0.05 = drifting, 0.8 = restless
  motion = 0.48; // 0 = fixed colour fields, 0.8 = wide travel

  // A control may also be a function of the live draw context. These are evaluated
  // every frame. Change the multipliers, or swap bass/mid/treble to remap the music.
  intensity = ({ audio }) => 0.035 + audio.bass * 0.080 + audio.mid * 0.035;
  warp = ({ audio }) => 0.004 + audio.bass * 0.018;

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
    uniform sampler2D uScene;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uAudio;
    uniform float uIntensity;
    uniform float uSpeed;
    uniform float uMotion;
    uniform float uWarp;

    float softBlob(vec2 point, vec2 center, float radius) {
      vec2 delta = (point - center) / radius;
      return exp(-dot(delta, delta) * 1.7);
    }

    void main() {
      vec2 uv = vTexCoord;
      vec2 centered = uv * 2.0 - 1.0;
      centered.x *= uResolution.x / uResolution.y;

      float bass = uAudio.x;
      float mid = uAudio.y;
      float treble = uAudio.z;
      float drift = uTime * uSpeed;
      vec2 flow = vec2(
        sin(centered.y * 3.5 + drift + mid * 2.0),
        cos(centered.x * 3.2 - drift * 0.83 + treble * 2.4)
      );
      vec2 sampleUv = clamp(uv + flow * uWarp, 0.002, 0.998);

      vec2 split = flow * (0.0005 + treble * 0.002);
      float red = texture2D(uScene, clamp(sampleUv + split, 0.002, 0.998)).r;
      float green = texture2D(uScene, sampleUv).g;
      float blue = texture2D(uScene, clamp(sampleUv - split, 0.002, 0.998)).b;
      // A slow feedback decay keeps preceding patches visible without allowing this
      // ambient layer to accumulate into the bright bands of the original Plasma.
      vec4 sourceSample = texture2D(uScene, sampleUv);
      vec3 scene = vec3(red, green, blue) * 0.88;

      vec2 pinkCenter = vec2(
        -0.50 + sin(drift * 0.71) * uMotion,
        -0.12 + cos(drift * 0.53) * uMotion * 0.75
      );
      vec2 purpleCenter = vec2(
        0.50 + cos(drift * 0.47) * uMotion * 0.85,
        -0.40 + sin(drift * 0.61) * uMotion
      );
      vec2 orangeCenter = vec2(
        -0.44 + cos(drift * 0.39) * uMotion * 0.8,
        0.52 + sin(drift * 0.44) * uMotion * 0.7
      );
      vec2 cyanCenter = vec2(
        0.46 + sin(drift * 0.58) * uMotion * 0.9,
        0.48 + cos(drift * 0.42) * uMotion * 0.8
      );

      float bloom = 1.0 + bass * 0.35 + mid * 0.15;
      float pink = softBlob(centered, pinkCenter, 0.72 * bloom);
      float purple = softBlob(centered, purpleCenter, 0.82 * bloom);
      float orange = softBlob(centered, orangeCenter, 0.68 * bloom);
      float cyan = softBlob(centered, cyanCenter, 0.80 * bloom);

      vec3 ambient =
        vec3(1.00, 0.08, 0.55) * pink +
        vec3(0.48, 0.18, 0.95) * purple +
        vec3(1.00, 0.42, 0.04) * orange +
        vec3(0.02, 0.75, 1.00) * cyan;
      ambient *= uIntensity;

      float radius = length(centered);
      float vignette = 1.0 - smoothstep(0.34, 1.55, radius);
      // Plasma transforms the existing scene; it never supplies a background.
      vec3 colour = scene * (vec3(1.0) + ambient * 0.12);
      colour *= 0.92 + vignette * 0.12;

      gl_FragColor = vec4(colour, sourceSample.a);
    }
  \`;

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

  draw({ audio, time, canvas }) {
    this.#ensureShader();
    this.#output.clear();
    this.#output.shader(this.#program);
    this.#program.setUniform("uScene", canvas);
    this.#program.setUniform("uResolution", [width, height]);
    this.#program.setUniform("uTime", time);
    this.#program.setUniform("uAudio", [audio.bass, audio.mid, audio.treble]);
    this.#program.setUniform("uIntensity", this.intensity({ audio, time }));
    this.#program.setUniform("uSpeed", this.speed);
    this.#program.setUniform("uMotion", this.motion);
    this.#program.setUniform("uWarp", this.warp({ audio, time }));
    this.#output.rect(0, 0, width, height);
    image(this.#output, 0, 0, width, height);
  }

  dispose() {
    this.#output?.remove();
    this.#output = null;
    this.#program = null;
  }
}

const plasma = new Plasma();

// %% scene scene
// Array order is layer order. Keep plasma last when you add another patch.
const scene = [
  asciiNoise,
  plasma,
];
activate(scene);
`;

/** Upgrade known untouched starter Plasma versions without disturbing other cells. */
export function upgradeLegacyPlasma(source) {
  const plasmaCell = (text, transform) => text.replace(
    /(\/\/\s*%%\s*(?:patch|strategy)\s+plasma\s*\n[\s\S]*?)(?=\n\/\/\s*%%\s+|$)/,
    transform,
  );
  const transparentUpgrade = plasmaCell(source, (cell) => {
    if (
      !cell.includes('      vec3 colour = scene + ambient;')
      || !cell.includes('      gl_FragColor = vec4(colour, 1.0);')
    ) return cell;
    return cell
      .replace(
        '      vec3 scene = vec3(red, green, blue) * 0.88;',
        '      vec4 sourceSample = texture2D(uScene, sampleUv);\n      vec3 scene = vec3(red, green, blue) * 0.88;',
      )
      .replace(
        '      vec3 colour = scene + ambient;',
        '      // Plasma transforms the existing scene; it never supplies a background.\n      vec3 colour = scene * (vec3(1.0) + ambient * 0.12);',
      )
      .replace(
        '      gl_FragColor = vec4(colour, 1.0);',
        '      gl_FragColor = vec4(colour, sourceSample.a);',
      );
  });
  if (transparentUpgrade !== source) return transparentUpgrade;

  const knownVersions = [
    // The original high-contrast feedback Plasma.
    [
      'float warp = 0.008 + bass * 0.035;',
      'float bands = 0.5 + 0.5 * cos(',
      'vec3 plasmaColour = mix(',
    ],
    // The first subtle ambient Plasma, before its intensity became a JS control.
    [
      'uniform vec3 uAudio;\n\n    float softBlob',
      'ambient *= 0.0038 + bass * 0.006 + mid * 0.002;',
      'float drift = uTime * 0.075;',
    ],
    // The immediately previous starter: one subtle arrow-function control.
    [
      'intensity = ({ audio }) => 0.0038 + audio.bass * 0.006 + audio.mid * 0.002;',
      'float drift = uTime * 0.075;',
      'vec3 scene = vec3(red, green, blue) * 0.94;',
    ],
    // The brighter ambient starter immediately before this standalone Plasma pass.
    [
      'speed = 0.22;',
      'intensity = ({ audio }) => 0.022 + audio.bass * 0.055 + audio.mid * 0.020;',
      'vec3 scene = vec3(red, green, blue) * 0.90;',
    ],
  ];
  if (!knownVersions.some((signatures) => signatures.every((part) => source.includes(part)))) {
    return source;
  }

  const cellRange = (text) => {
    const marker = /^\/\/\s*%%\s*(?:patch|strategy)\s+plasma\s*$/m.exec(text);
    if (!marker) return null;
    const start = marker.index;
    const rest = text.slice(start + marker[0].length);
    const next = /^\/\/\s*%%\s+/m.exec(rest);
    const end = next ? start + marker[0].length + next.index : text.length;
    return { start, end };
  };
  const oldCell = cellRange(source);
  const newCell = cellRange(STARTER_SOURCE);
  if (!oldCell || !newCell) return source;

  const replacement = STARTER_SOURCE.slice(newCell.start, newCell.end).trimEnd();
  return `${source.slice(0, oldCell.start)}${replacement}\n\n${source.slice(oldCell.end).trimStart()}`;
}

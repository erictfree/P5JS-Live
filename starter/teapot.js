// %% controls teapotControls
// TEAPOT / point-cloud performance. Works in silence; load audio for displacement.
control('teapotSpin', 0.35, { min: -1, max: 1, step: 0.01 });
control('teapotDots', 3, { min: 1, max: 8, step: 0.1 });
control('teapotMotion', 0.3, { min: 0, max: 1, step: 0.01 });
control('teapotAudio', 0.6, { min: 0, max: 1, step: 0.01 });

// %% patch teapotPoints
// Downloaded Utah teapot OBJ, credited to Martin Newell by the source archive.
// Change modelUrl to another same-origin or CORS-enabled OBJ to try its vertices.
// Loading is asynchronous; draw keeps running while the model arrives.
class TeapotPoints {
  modelUrl = 'starter/models/teapot.obj';
  #buffer = null;
  #points = null;
  #loading = false;
  #disposed = false;
  #error = null;

  state() { return { turn: 0, bass: 0 }; }

  #load() {
    if (this.#loading) return;
    this.#loading = true;
    loadModel(this.modelUrl).then(model => {
      if (this.#disposed) return;
      const vertices = model.vertices;
      if (!vertices?.length) throw new Error('The OBJ contains no vertices.');
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const v of vertices) {
        [v.x, v.y, v.z].forEach((n, axis) => {
          if (!Number.isFinite(n)) throw new Error('The OBJ contains an invalid vertex.');
          lo[axis] = Math.min(lo[axis], n); hi[axis] = Math.max(hi[axis], n);
        });
      }
      const span = Math.max(...hi.map((n, axis) => n - lo[axis]));
      if (span === 0) throw new Error('The OBJ has no extent.');
      const center = hi.map((n, axis) => (n + lo[axis]) / 2);
      // Center, fit, and flip model-space Y for p5's downward-positive screen axis.
      // Bound the point count so a dense replacement model stays manageable.
      const stride = Math.max(1, Math.ceil(vertices.length / 8000));
      this.#points = vertices.filter((_, i) => i % stride === 0).map(v => [
        (v.x - center[0]) / span * 3.2,
        -(v.y - center[1]) / span * 3.2,
        (v.z - center[2]) / span * 3.2,
      ]);
    }).catch(error => {
      if (!this.#disposed) this.#error = new Error('Teapot model could not load: ' + error.message);
    });
  }

  draw({ time, dt, audio, state, controls }) {
    if (this.#error) throw this.#error;
    if (!this.#points) {
      this.#load();
      fill(130, 220, 165);
      noStroke();
      textAlign(CENTER, CENTER);
      text('Loading teapot OBJ…', width / 2, height / 2);
      return;
    }
    if (!this.#buffer) {
      this.#buffer = createGraphics(width, height, WEBGL);
      this.#buffer.pixelDensity(1);
    }
    const g = this.#buffer;
    if (g.width !== width || g.height !== height) g.resizeCanvas(width, height);
    state.turn += dt * controls.teapotSpin;
    state.bass += (audio.bass - state.bass) * (1 - Math.exp(-dt * 10));
    const motion = controls.teapotMotion * 0.045 + state.bass * controls.teapotAudio * 0.16;
    const size = Math.min(width / 4.6, height / 3.1);
    g.clear();
    g.push();
    g.rotateX(-0.16);
    g.rotateY(state.turn + 0.4);
    g.stroke(40, 255, 110);
    // Batch four dot sizes instead of issuing thousands of individual draw calls.
    for (let band = 0; band < 4; band++) {
      g.strokeWeight(controls.teapotDots * (0.65 + band * 0.24));
      g.beginShape(POINTS);
      for (let i = band; i < this.#points.length; i += 4) {
        const [x, y, z] = this.#points[i];
        const wave = Math.sin(i * 0.19 + time * 2.4) * motion;
        g.vertex(x * size, (y + wave) * size, z * size);
      }
      g.endShape();
    }
    g.pop();
    image(g, 0, 0, width, height);
  }

  dispose() {
    this.#disposed = true;
    this.#buffer?.remove();
    this.#buffer = null;
    this.#points = null;
  }
}
const teapotPoints = new TeapotPoints();

// %% scene teapotScene
// Try .repeatX(2), .rotate(0, 0.1), or an audio-driven .opacity() here.
const teapotScene = [
  () => background(3, 7, 10),
  [teapotPoints].opacity(0.95),
];
teapotScene.draw();

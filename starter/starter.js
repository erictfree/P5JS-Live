// Temporary featured default. Saved projects keep their source.
export const STARTER_SOURCE = `// %% patch myPatch
// p5js live — starter scene: CHROMATIC DESCENT
// A breathing light tunnel. Silent motion, bass pressure, treble sparks.
// Try changing hue, petals, speed, or glow, then Run this patch.
const myPatch = {
  hue: 175,
  petals: 5,
  speed: 0.18,
  glow: 1.3,
  rings: 36,

  draw({ time, dt, audio, clock, state }) {
    // Smooth the music so motion feels elastic, not jittery.
    const follow = 1 - Math.exp(-Math.min(dt, 0.1) * 9);
    state.bass = (state.bass ?? 0) + ((audio.bass || 0) - (state.bass ?? 0)) * follow;
    state.high = (state.high ?? 0) + ((audio.treble || 0) - (state.high ?? 0)) * follow;
    const hit = clock.running ? clock.tick : audio.onset;
    state.pulse = hit ? 1 : (state.pulse ?? 0) * Math.exp(-dt * 5);
    const bass = state.bass, high = state.high, pulse = state.pulse;
    const t = time * this.speed;
    const unit = Math.min(width, height);
    const cx = width * 0.5, cy = height * 0.5;
    colorMode(HSB, 360, 100, 100, 1);
    blendMode(ADD);
    noFill();

    // Project a twisting tube into depth. Rings travel toward the audience.
    const count = Math.max(12, Math.min(60, Math.round(this.rings)));
    const segments = 72;
    const point = (z, a) => {
      const twist = a + z * 2.4 + t * 0.7;
      const petal = 1 + 0.12 * Math.sin(a * this.petals + z * 4 - t * 2);
      const radius = unit * 0.135 / (z + 0.11) * petal * (1 + bass * 0.2);
      return [
        cx + Math.cos(t * 0.7 + z * 2) * unit * 0.085 * z + Math.cos(twist) * radius,
        cy + Math.sin(t * 0.9 + z * 2.6) * unit * 0.065 * z + Math.sin(twist) * radius,
      ];
    };
    // Far rings first; broad glow under a fine luminous filament.
    for (let i = count - 1; i >= 0; i--) {
      const z = ((i / count - t * 0.28) % 1 + 1) % 1;
      const fade = (0.18 + Math.sin(Math.PI * z) * 0.82) * (0.65 + z * 0.35);
      const hue = (this.hue + z * 155 + 25 * Math.sin(t + z * 4)) % 360;
      for (let pass = 0; pass < 2; pass++) {
        stroke(hue, pass ? 52 : 85, 95, fade * (pass ? 0.95 : 0.2) * this.glow);
        strokeWeight(pass ? 1.2 + pulse * 0.8 : 4 + bass * 6);
        beginShape();
        for (let j = 0; j <= segments; j++) {
          const p = point(z, j / segments * Math.PI * 2);
          vertex(p[0], p[1]);
        }
        endShape();
      }
      // Sparse rails give the rings a continuous, woven structure.
      const nextZ = z + 1 / count;
      if (nextZ < 1) {
        stroke(hue, 55, 90, fade * 0.2 * this.glow); strokeWeight(0.65);
        for (let j = 0; j < 12; j++) {
          const a = j / 12 * Math.PI * 2;
          const p = point(z, a), q = point(nextZ, a);
          line(p[0], p[1], q[0], q[1]);
        }
      }
    }

    // Deterministic dust: no allocation of particles and no frame-to-frame noise.
    noStroke();
    for (let i = 0; i < 160; i++) {
      const seed = Math.sin(i * 127.1 + 43.7) * 43758.5453;
      const angle = (seed - Math.floor(seed)) * Math.PI * 2 + t * 0.12;
      const z = ((i * 0.6180339 - t * 0.11) % 1 + 1) % 1;
      const radius = unit * 0.1 / (z + 0.07);
      const sparkle = Math.pow(0.5 + 0.5 * Math.sin(time * 1.8 + i * 4.1), 8);
      fill((this.hue + i * 1.7) % 360, 30, 100, (1 - z) * (0.15 + sparkle * 0.6));
      circle(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius,
        1 + sparkle * 2 + high * 4);
    }

    // Beat accents are traveling rings rather than a full-screen white flash.
    if (pulse > 0.02) {
      noFill(); stroke((this.hue + 100) % 360, 28, 100, pulse * 0.45);
      strokeWeight(1.5); circle(cx, cy, unit * (0.24 + (1 - pulse) * 1.3));
    }
    blendMode(BLEND);
  },
};

// %% scene scene
// The array isolates the tunnel so these operations affect only its image.
const scene = [
  () => background(5, 8, 16),
  [myPatch]
    .rotate(0, 0.2)
    .opacity(0.85),
];
scene.draw();
`;

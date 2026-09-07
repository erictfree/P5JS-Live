// %% controls motionControls
// MOTION LAB — all six operators. Tools > Audio supplies optional tempo.
// Hold the H key outside the editor to trigger without sound.
control('motionAmount', 1, { min: 0, max: 1, step: 0.01 });

// %% signals motionSignals
const motionLfo = lfo({ period: 4, min: 0.5, max: 1 });
const motionBeat = lfo({ beats: 4, min: 0.5, max: 1 });
const motionHit = c => c.audio.onset || c.keyboard.keys.has('h');
const motionEnvelope = envelope({ trigger: motionHit, attack: 0.04, release: 0.8 });
const motionRamp = ramp({ trigger: motionHit, period: 2, from: 0.3, to: 1 });
const motionSteps = sequence([0, 0.2, 0.5, 0.8], { trigger: motionHit });
const motionBass = remap(c => c.audio.bass, { from: [0, 1], to: [0.25, 1] });
const motionVariation = variation({ seed: 'astra', period: 0.5, min: 0.25, max: 1 });

// %% patch motionBackdrop
const motionBackdrop = () => background(23, 25, 28);

// %% patch motionDemo
const motionDemo = {
  draw(c) {
    const values = [motionLfo(c), motionEnvelope(c), motionRamp(c), motionSteps(c), motionBass(c), motionVariation(c)];
    const names = ['LFO / 4 SEC', 'ENVELOPE / HIT', 'RAMP / HIT', 'SEQUENCE / HIT', 'REMAP / BASS', 'VARIATION / SEED'];
    const gap = 16, cellW = (width - gap * 4) / 3, cellH = (height - 130) / 2;
    textFont('monospace'); textAlign(LEFT, TOP); noStroke();
    fill(225); textSize(18); text('MOTION LAB', gap, 22);
    fill(160); textSize(11); text('H: trigger  ·  T: tap tempo  ·  Tools > Audio: Manual / Auto', gap, 51);
    for (let i = 0; i < values.length; i++) {
      const x = gap + (i % 3) * (cellW + gap), y = 82 + floor(i / 3) * (cellH + gap);
      fill(34, 37, 41); rect(x, y, cellW, cellH);
      fill(160); textSize(10); text(names[i], x + 12, y + 12);
      const v = values[i];
      fill(i === 1 ? color(88, 213, 163) : color(255, 182, 91));
      circle(x + cellW / 2, y + cellH * 0.53, min(cellW, cellH) * 0.48 * v * c.controls.motionAmount);
      fill(215); textSize(11); text(v.toFixed(2), x + 12, y + cellH - 24);
      if (i === 0) {
        noFill(); stroke(100, 180, 215); strokeWeight(2);
        circle(x + cellW / 2, y + cellH * 0.53, min(cellW, cellH) * 0.6 * motionBeat(c)); noStroke();
      }
    }
    fill(c.audio.onset ? color(88, 213, 163) : color(70)); circle(width - 220, 58, 10);
    fill(c.clock.running && c.clock.phase < 0.2 ? color(255, 182, 91) : color(70)); circle(width - 110, 58, 10);
    fill(180); textSize(10); text('HIT', width - 210, 54); text('CLOCK', width - 100, 54);
  },
};

// %% patch motionGlow
const motionGlow = () => {
  noFill(); stroke(88, 213, 163); strokeWeight(6); rect(3, 3, width - 6, height - 6);
};

// %% scene motionLab
// The same envelope drives p5 drawing and this shader opacity.
const motionLab = [motionBackdrop, motionDemo, [motionGlow].opacity(motionEnvelope)];
motionLab.draw();

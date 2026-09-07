// %% controls motionControls
// MOTION LAB — visual signals, smoothing, and held envelopes.
// Hold H outside the editor: trigger the hit examples and sustain the ADSR.
// Release H to watch the ADSR fade out.
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
const motionLag = lag(motionVariation, { rise: 0.12, fall: 0.6 });
const motionHeldEnvelope = envelope({
  gate: c => c.keyboard.keys.has('h'),
  attack: 0.2, decay: 0.3, sustain: 0.55, release: 0.7,
});
const motionSoftness = remap(motionLag, { to: [0, 6] });

// %% patch motionBackdrop
const motionBackdrop = () => background(23, 25, 28);

// %% patch motionDemo
const motionDemo = {
  draw(c) {
    const values = [motionLfo(c), motionEnvelope(c), motionRamp(c), motionSteps(c), motionBass(c), motionVariation(c), motionLag(c), motionHeldEnvelope(c)];
    const names = ['LFO / 4 SEC', 'ENVELOPE / HIT', 'RAMP / HIT', 'SEQUENCE / HIT', 'REMAP / BASS', 'VARIATION / SEED', 'LAG / VARIATION', 'ADSR / HOLD H'];
    const columns = width >= 1000 ? 4 : 2, rows = ceil(values.length / columns);
    const top = width < 700 ? 84 : 18, headerBottom = top + 74;
    const gap = 16, cellW = (width - gap * (columns + 1)) / columns;
    const cellH = (height - headerBottom - 48 - gap * (rows + 1)) / rows;
    textFont('monospace'); textAlign(LEFT, TOP); noStroke();
    fill(225); textSize(18); text('MOTION LAB', gap, top + 4);
    fill(160); textSize(11); text('H: hold / release  ·  Space: tap tempo', gap, top + 32);
    text('Tools > Audio > Rhythm: Manual / Auto', gap, top + 50);
    for (let i = 0; i < values.length; i++) {
      const x = gap + (i % columns) * (cellW + gap), y = headerBottom + gap + floor(i / columns) * (cellH + gap);
      fill(34, 37, 41); rect(x, y, cellW, cellH);
      fill(160); textSize(10); text(names[i], x + 12, y + 12);
      const v = values[i];
      fill(i === 1 || i === 7 ? color(88, 213, 163) : color(255, 182, 91));
      circle(x + cellW / 2, y + cellH * 0.53, min(cellW, cellH) * 0.48 * v * c.controls.motionAmount);
      fill(215); textSize(11); text(v.toFixed(2), x + 12, y + cellH - 24);
      if (i === 0) {
        noFill(); stroke(100, 180, 215); strokeWeight(2);
        circle(x + cellW / 2, y + cellH * 0.53, min(cellW, cellH) * 0.6 * motionBeat(c)); noStroke();
      }
      if (i === 6) {
        // The outline jumps to the raw variation; the filled circle follows it.
        noFill(); stroke(160); strokeWeight(1);
        circle(x + cellW / 2, y + cellH * 0.53, min(cellW, cellH) * 0.48 * motionVariation(c) * c.controls.motionAmount);
        noStroke();
      }
    }
    fill(c.audio.onset ? color(88, 213, 163) : color(70)); circle(200, top + 10, 8);
    fill(c.clock.running && c.clock.phase < 0.2 ? color(255, 182, 91) : color(70)); circle(286, top + 10, 8);
    fill(180); textSize(10); text('HIT', 210, top + 6); text('CLOCK', 296, top + 6);
  },
};

// %% patch motionGlow
const motionGlow = () => {
  noFill(); stroke(88, 213, 163); strokeWeight(6); rect(3, 3, width - 6, height - 6);
};

// %% scene motionLab
// Lag controls blur; the held ADSR controls opacity. Both also drive p5 circles.
const motionLab = [motionBackdrop, motionDemo, [motionGlow].blur(motionSoftness).opacity(motionHeldEnvelope)];
motionLab.draw();

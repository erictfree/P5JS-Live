// %% setup modulationDepth
control('Modulation depth', 0.14, { type: 'continuous', min: 0, max: 0.4, step: 0.01 });

// %% setup modBass
const modBass = lag(c => c.audio.bass, { rise: 0.04, fall: 0.3 });

// %% patch modBackdrop
const modBackdrop = () => background(14, 18, 23);

// %% patch modLettering
const modLettering = { draw({ time }) {
  noStroke();
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(Math.min(width * 0.145, height * 0.25));
  fill(91, 222, 190);
  text('MAKE', width * 0.5, height * 0.37);
  fill(255, 179, 91);
  text('WAVES', width * 0.5, height * 0.64);
  noFill();
  stroke(71, 111, 122);
  strokeWeight(1.5);
  for (let x = 0; x < width; x += 48) {
    line(x, height * 0.12, x, height * 0.83);
  }
} };

// %% patch modRings
// This patch is rendered offscreen. Mid-gray is neutral; R/G move X/Y.
// Try changing the spacing, speed, or red/green balance, then Run this patch.
const modRings = { draw({ time }) {
  background(128);
  noFill();
  strokeWeight(18);
  const span = Math.hypot(width, height);
  for (let r = (time * 42) % 110; r < span; r += 110) {
    stroke(245, 185, 128);
    circle(width * 0.44, height * 0.48, r * 2);
    stroke(35, 85, 128);
    circle(width * 0.44, height * 0.48, r * 2 + 38);
  }
} };

// %% patch modCaption
const modCaption = { draw({ keyboard }) {
  noStroke();
  textStyle(NORMAL);
  textAlign(CENTER, CENTER);
  textSize(Math.max(12, Math.min(16, width / 40)));
  fill(190, 203, 207);
  text(keyboard.keys.has('h') ? 'ORIGINAL' : 'IMAGE MODULATION', width / 2, height * 0.88);
  text('Esc · Hold H to compare · Controls: Modulation depth', width / 2, height * 0.92);
} };

// %% scene imageModulation
const imageModulation = [
  modBackdrop,
  [modLettering].modulate(
    [modRings].blur(5),
    c => c.keyboard.keys.has('h') ? 0 : c.controls['Modulation depth'] + modBass(c) * 0.12
  ),
  modCaption,
];
imageModulation.draw();

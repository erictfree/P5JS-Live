// %% controls labControls
// LAYER LAB — a self-contained p5 + ShaderChain playground.
// Start silent works. Optional audio adds movement; no library installs needed.
// Tools > Controls: try opacity, zoom, hue, blur, and pixel size.
control("labOpacity", 0.85, { min: 0, max: 1, step: 0.01 });
control("labZoom", 1, { min: 0.6, max: 1.5, step: 0.01 });
control("labHue", 0, { min: 0, max: 1, step: 0.01 });
control("labBlur", 0, { min: 0, max: 8, step: 0.25 });
control("labPixels", 55, { min: 12, max: 160, step: 1 });

// %% patch labGrid
// This stays sharp and visible when the foreground is faded or muted.
const labGrid = {
  draw() {
    background(19, 22, 27);
    stroke(38, 43, 50);
    strokeWeight(1);
    for (let x = 0; x < width; x += 32) line(x, 0, x, height);
    for (let y = 0; y < height; y += 32) line(0, y, width, y);
  },
};

// %% patch labRings
// Ordinary p5 drawing. Change the stroke colours, then run just this patch.
const labRings = {
  draw({ time, audio }) {
    translate(width / 2, height / 2);
    const size = min(width, height) * 0.55;
    noFill();
    strokeWeight(3 + audio.bass * 7);
    for (let i = 0; i < 8; i++) {
      stroke(i % 2 ? "#f577b7" : "#57dbc8");
      const diameter = size * (0.28 + i * 0.095);
      const drift = sin(time * 0.6 + i * 0.5) * size * 0.08;
      ellipse(drift, 0, diameter, diameter * 0.7);
    }
  },
};

// %% patch labSignal
// A second transparent p5 sketch, isolated together with the rings.
const labSignal = {
  draw({ time, audio }) {
    const size = min(width, height) * 0.55;
    translate(width / 2, height / 2);
    noStroke();
    fill("#ffb65b");
    for (let i = 0; i < 25; i++) {
      const x = (i / 24 - 0.5) * size;
      const wave = sin(i * 0.45 + time * 1.5);
      const h = size * (0.025 + (wave + 1) * 0.12 + audio.mid * 0.16);
      rect(x, -h / 2, max(3, size / 65), h);
    }
  },
};

// %% patch labCaption
// Drawn AFTER the layers: text and grid are never blurred or rotated.
const labCaption = {
  draw() {
    noStroke();
    fill(215, 222, 231);
    textFont("monospace");
    textSize(14);
    textAlign(LEFT, TOP);
    text("LAYER LAB / P5 + FX", 24, 28);
    textSize(11);
    fill(141, 155, 170);
    text("TOOLS > CONTROLS / OPACITY / ZOOM / HUE / BLUR", 24, 51);
  },
};

// %% scene layerLab
// Try .mute(true), then run THIS scene. The grid and caption stay visible.
// Change the scene structure here; patch-only edits update the live sketches.
const layerLab = [
  labGrid,
  layer([labRings, labSignal])
    .rotate(({ time }) => sin(time * 0.2) * 0.3)
    .scale(({ controls }) => controls.labZoom)
    .fx(new ShaderChain()
      .hue(({ controls }) => controls.labHue)
      .blur(({ controls }) => controls.labBlur))
    .opacity(({ controls }) => controls.labOpacity)
    .mute(false),
  labCaption,
];
activate(layerLab);

// %% patch labOrderCaption
const labOrderCaption = {
  draw() {
    noStroke();
    fill(215, 222, 231);
    textFont("monospace");
    textSize(12);
    textAlign(CENTER, TOP);
    text("PIXELATE > ROTATE", width * 0.25, 28);
    text("ROTATE > PIXELATE", width * 0.75, 28);
    fill(141, 155, 170);
    textSize(10);
    text("Tools > Controls: labPixels / fewer = larger blocks", width / 2, height - 30);
  },
};

// %% scene orderLab
// Same sketch and settings, different order. Left blocks rotate with the image;
// right blocks stay aligned to the screen. Set labPixels around 30 to exaggerate.
// Uncomment activate(orderLab) and run this cell. To return, run layerLab above.
const orderLab = [
  labGrid,
  layer(labSignal).fx(new ShaderChain()
    .pixelate(({ controls }) => controls.labPixels, ({ controls }) => controls.labPixels)
    .rotate(0.6)
    .transform(-0.25, 0, 0.65, 0.65)
    .crop(0.02, 0.48, 0.12, 0.88)),
  layer(labSignal).fx(new ShaderChain()
    .rotate(0.6)
    .pixelate(({ controls }) => controls.labPixels, ({ controls }) => controls.labPixels)
    .transform(0.25, 0, 0.65, 0.65)
    .crop(0.52, 0.98, 0.12, 0.88)),
  labOrderCaption,
];
// activate(orderLab);

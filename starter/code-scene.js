// %% patch metaBackdrop
const metaBackdrop = {
  draw({ time, audio }) {
    background(15, 19, 27);
    noFill();
    strokeWeight(1);
    for (let i = 0; i < 14; i++) {
      stroke(50, 160, 157, 30 + i * 3);
      const size = 100 + i * 70 + Math.sin(time * 0.4) * 25;
      circle(width * 0.72, height * 0.52, size + audio.bass * 40);
    }
  },
};

// %% patch metaField
const metaField = {
  draw({ time }) {
    background(128);
    noStroke();
    for (let y = 0; y < height; y += 4) {
      fill(128 + Math.sin(y * 0.018 - time) * 110, 128, 128);
      rect(0, y, width, 4);
    }
  },
};

// %% patch metaCode
// The editor becomes transparent, syntax-coloured pixels inside the scene.
const metaCode = codeView({ cursor: true });
// Also try codeView({ patch: 'metaField', fontSize: 28 }).

// %% patch metaCaption
const metaCaption = {
  draw() {
    noStroke();
    fill(97, 216, 181);
    textFont('monospace');
    textSize(12);
    text('CODE IS MATERIAL   /   Esc then E: editor   /   hold H: original', 24, height - 58);
  },
};

// %% scene codeScene
// Open a cell and type: the image updates before you run the edit.
// Press Esc, then E to hide the editor and see only the scene's code image.
const codeScene = [
  metaBackdrop,
  [metaCode]
    .modulate([metaField], c => c.keyboard.keys.has('h') ? 0 : 0.035)
    .opacity(0.94),
  metaCaption,
];
codeScene.draw();

// Saved projects keep their own source; this is only used for a fresh project.
export const STARTER_SOURCE = `// %% patch myPatch
// p5js live — starter scene
// Change the colour, size, or speed, then press Cmd/Ctrl+Enter.
const myPatch = ({ audio, time }) => {
  const size = 120 + audio.bass * 180;
  const x = width / 2 + sin(time) * width / 4;

  noStroke();
  fill(105, 224, 198);
  circle(x, height / 2, size);
};

// %% scene scene
const scene = [
  () => background(0),
  myPatch,
];
scene.draw();
`;

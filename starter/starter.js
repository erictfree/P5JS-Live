// The default testing scene: an ordinary p5 patch with native array effects.
// Existing saved projects retain their source; this is used for fresh/new/reset projects.

export const STARTER_SOURCE = `// %% patch myPatch
// p5js live — starter scene
// Start silent works. Change the colour or size, then run this patch.
const myPatch = {
  draw({ time }) {
    noStroke();
    fill("#57dbc8");
    rectMode(CENTER);

    const size = 120 + sin(time * 2) * 30;
    rect(width / 2, height / 2, size, size);
  },
};

// %% scene scene
// The background stays separate. These methods affect only myPatch's image.
// Change rotation speed or opacity, then run this scene.
const scene = [
  () => background(20, 22, 27),
  [myPatch]
    .rotate(0, 0.2)
    .opacity(0.85),
];
scene.draw();
`;

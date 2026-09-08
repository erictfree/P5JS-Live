// Saved launcher examples: importing these does not replace the working editor.
export function controllerDemoPerformances() {
  return [
    { id: 'controller-demo-orbits-v1', name: 'Controller demo · Orbits', hue: 160, shape: 'ellipse' },
    { id: 'controller-demo-tiles-v1', name: 'Controller demo · Tiles', hue: 30, shape: 'rect' },
  ].map(({ id, name, hue, shape }) => ({ id, name, sceneName: 'scene', source: `// %% controls performanceControls
control('size', 70, { min: 10, max: 180, step: 1 });
control('speed', 0.3, { min: -2, max: 2, step: 0.01 });
control('hue', ${hue}, { min: 0, max: 360, step: 1 });
control('count', 12, { min: 1, max: 32, step: 1 });
control('spread', 0.3, { min: 0.05, max: 0.48, step: 0.01 });
control('weight', 2, { min: 1, max: 12, step: 0.1 });
control('reaction', 0.5, { min: 0, max: 2, step: 0.01 });
control('opacity', 0.85, { min: 0, max: 1, step: 0.01 });

// %% patch shapes
const shapes = { draw({ time, controls: c, audio }) {
  colorMode(HSB, 360, 100, 100, 1);
  noFill(); stroke(c.hue, 65, 95, c.opacity); strokeWeight(c.weight);
  rectMode(CENTER);
  const radius = Math.min(width, height) * c.spread;
  const size = c.size * (1 + (audio.bass || 0) * c.reaction);
  for (let i = 0; i < c.count; i++) {
    const angle = i / c.count * Math.PI * 2 + time * c.speed;
    ${shape}(width / 2 + Math.cos(angle) * radius, height / 2 + Math.sin(angle) * radius, size, size);
  }
} };

// %% scene scene
const scene = [() => background(16, 20, 25), shapes];
scene.draw();
` }));
}

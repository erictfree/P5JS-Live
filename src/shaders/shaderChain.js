// A composable, single-input post-processing patch.
//
// The public method vocabulary follows the familiar coordinate and colour operator
// groups used by Hydra, while the implementation is native to p5js live's p5 scene
// model. A chain is an ordinary object with draw() and dispose(), so it participates
// in evaluation, rollback, scene ordering, and resource cleanup like every other patch.

const VERTEX_SOURCE = `
  precision highp float;

  attribute vec3 aPosition;
  attribute vec2 aTexCoord;
  varying vec2 vTexCoord;

  void main() {
    vTexCoord = aTexCoord;
    vec4 position = vec4(aPosition, 1.0);
    position.xy = position.xy * 2.0 - 1.0;
    gl_Position = position;
  }
`;

const GLSL_HELPERS = `
  float luminance(vec3 colour) {
    return dot(colour, vec3(0.2125, 0.7154, 0.0721));
  }

  float random2d(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);
    return mix(
      mix(random2d(cell), random2d(cell + vec2(1.0, 0.0)), local.x),
      mix(random2d(cell + vec2(0.0, 1.0)), random2d(cell + vec2(1.0)), local.x),
      local.y
    );
  }

  vec3 rgbToHsv(vec3 colour) {
    vec4 k = vec4(0.0, -0.3333333333, 0.6666666667, -1.0);
    vec4 p = mix(vec4(colour.bg, k.wz), vec4(colour.gb, k.xy), step(colour.b, colour.g));
    vec4 q = mix(vec4(p.xyw, colour.r), vec4(colour.r, p.yzx), step(p.x, colour.r));
    float delta = q.x - min(q.w, q.y);
    float epsilon = 0.0000000001;
    return vec3(
      abs(q.z + (q.w - q.y) / (6.0 * delta + epsilon)),
      delta / (q.x + epsilon),
      q.x
    );
  }

  vec3 hsvToRgb(vec3 colour) {
    vec3 p = abs(fract(colour.xxx + vec3(0.0, 0.6666666667, 0.3333333333)) * 6.0 - 3.0);
    return colour.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), colour.y);
  }
`;

const SPECS = Object.freeze({
  transform: {
    kind: 'coord',
    args: [
      ['x', 'float', 0], ['y', 'float', 0],
      ['scaleX', 'float', 1], ['scaleY', 'float', 1],
      ['angle', 'float', 0], ['anchorX', 'float', 0.5], ['anchorY', 'float', 0.5],
    ],
    glsl: ([x, y, scaleX, scaleY, angle, anchorX, anchorY], index) => `
      vec2 anchor${index} = vec2(${anchorX}, ${anchorY});
      vec2 transformed${index} = uv - anchor${index} - vec2(${x}, ${y});
      float transformAngle${index} = -(${angle});
      transformed${index} = mat2(
        cos(transformAngle${index}), -sin(transformAngle${index}),
        sin(transformAngle${index}), cos(transformAngle${index})
      ) * transformed${index};
      transformed${index} /= max(abs(vec2(${scaleX}, ${scaleY})), vec2(0.00001));
      uv = transformed${index} + anchor${index};
    `,
  },
  mirror: {
    kind: 'coord',
    args: [['horizontal', 'float', 1], ['vertical', 'float', 0]],
    glsl: ([horizontal, vertical], index) => `
      vec2 mirrored${index} = abs(uv - 0.5) + 0.5;
      uv.x = mix(uv.x, mirrored${index}.x, clamp(${horizontal}, 0.0, 1.0));
      uv.y = mix(uv.y, mirrored${index}.y, clamp(${vertical}, 0.0, 1.0));
    `,
  },
  crop: {
    kind: 'coord',
    args: [
      ['left', 'float', 0], ['right', 'float', 1],
      ['top', 'float', 0], ['bottom', 'float', 1],
    ],
    glsl: ([left, right, top, bottom]) => `
      coverage *= step(${left}, uv.x) * step(uv.x, ${right});
      coverage *= step(${top}, uv.y) * step(uv.y, ${bottom});
    `,
  },
  noiseWarp: {
    kind: 'coord',
    args: [['amount', 'float', 0.03], ['scale', 'float', 4], ['speed', 'float', 0.15]],
    glsl: ([amount, scale, speed], index) => `
      vec2 warpPoint${index} = uv * max(abs(${scale}), 0.0001) + uTime * ${speed};
      vec2 warpFlow${index} = vec2(
        valueNoise(warpPoint${index}),
        valueNoise(warpPoint${index} + vec2(19.7, 7.3))
      ) - 0.5;
      uv += warpFlow${index} * ${amount};
    `,
  },
  rotate: {
    kind: 'coord',
    args: [['angle', 'float', 10], ['speed', 'float', 0]],
    glsl: ([angle, speed]) => `
      vec2 centered = uv - vec2(0.5);
      float turn = ${angle} + ${speed} * uTime;
      centered = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * centered;
      uv = centered + vec2(0.5);
    `,
  },
  scale: {
    kind: 'coord',
    args: [
      ['amount', 'float', 1.5],
      ['xMult', 'float', 1],
      ['yMult', 'float', 1],
      ['offsetX', 'float', 0.5],
      ['offsetY', 'float', 0.5],
    ],
    glsl: ([amount, xMult, yMult, offsetX, offsetY]) => `
      vec2 scaleCenter = vec2(${offsetX}, ${offsetY});
      vec2 scaleAmount = max(abs(vec2(${amount} * ${xMult}, ${amount} * ${yMult})), vec2(0.00001));
      uv = (uv - scaleCenter) / scaleAmount + scaleCenter;
    `,
  },
  pixelate: {
    kind: 'coord',
    args: [['pixelX', 'float', 20], ['pixelY', 'float', 20]],
    glsl: ([pixelX, pixelY]) => `
      vec2 pixels = max(abs(vec2(${pixelX}, ${pixelY})), vec2(1.0));
      uv = (floor(uv * pixels) + 0.5) / pixels;
    `,
  },
  repeat: {
    kind: 'coord',
    args: [
      ['repeatX', 'float', 3],
      ['repeatY', 'float', 3],
      ['offsetX', 'float', 0],
      ['offsetY', 'float', 0],
    ],
    glsl: ([repeatX, repeatY, offsetX, offsetY]) => `
      vec2 repeated = uv * max(abs(vec2(${repeatX}, ${repeatY})), vec2(1.0));
      repeated.x += step(1.0, mod(repeated.y, 2.0)) * ${offsetX};
      repeated.y += step(1.0, mod(repeated.x, 2.0)) * ${offsetY};
      uv = fract(repeated);
    `,
  },
  repeatX: {
    kind: 'coord',
    args: [['reps', 'float', 3], ['offset', 'float', 0]],
    glsl: ([reps, offset]) => `
      vec2 repeatedX = uv * vec2(max(abs(${reps}), 1.0), 1.0);
      repeatedX.y += step(1.0, mod(repeatedX.x, 2.0)) * ${offset};
      uv = fract(repeatedX);
    `,
  },
  repeatY: {
    kind: 'coord',
    args: [['reps', 'float', 3], ['offset', 'float', 0]],
    glsl: ([reps, offset]) => `
      vec2 repeatedY = uv * vec2(1.0, max(abs(${reps}), 1.0));
      repeatedY.x += step(1.0, mod(repeatedY.y, 2.0)) * ${offset};
      uv = fract(repeatedY);
    `,
  },
  kaleid: {
    kind: 'coord',
    args: [['sides', 'float', 4]],
    glsl: ([sides]) => `
      vec2 kaleidPoint = uv - 0.5;
      float kaleidRadius = length(kaleidPoint);
      float kaleidSides = max(abs(${sides}), 1.0);
      float kaleidSector = 6.28318530718 / kaleidSides;
      float kaleidAngle = mod(atan(kaleidPoint.y, kaleidPoint.x), kaleidSector);
      kaleidAngle = abs(kaleidAngle - kaleidSector * 0.5);
      uv = vec2(0.5) + kaleidRadius * vec2(cos(kaleidAngle), sin(kaleidAngle));
    `,
  },
  scroll: {
    kind: 'coord',
    args: [
      ['x', 'float', 0.5],
      ['y', 'float', 0.5],
      ['speedX', 'float', 0],
      ['speedY', 'float', 0],
    ],
    glsl: ([x, y, speedX, speedY]) => `
      uv = fract(uv + vec2(${x} + uTime * ${speedX}, ${y} + uTime * ${speedY}));
    `,
  },
  scrollX: {
    kind: 'coord',
    args: [['x', 'float', 0.5], ['speed', 'float', 0]],
    glsl: ([x, speed]) => `uv.x = fract(uv.x + ${x} + uTime * ${speed});`,
  },
  scrollY: {
    kind: 'coord',
    args: [['y', 'float', 0.5], ['speed', 'float', 0]],
    glsl: ([y, speed]) => `uv.y = fract(uv.y + ${y} + uTime * ${speed});`,
  },
  blur: {
    kind: 'color',
    args: [['radius', 'float', 2]],
    glsl: ([radius], index) => `
      vec2 blurStep${index} = vec2(max(${radius}, 0.0)) / uResolution;
      vec4 blurColour${index} = texture2D(uScene, fract(uv)) * 0.20;
      blurColour${index} += texture2D(uScene, fract(uv + vec2( blurStep${index}.x, 0.0))) * 0.12;
      blurColour${index} += texture2D(uScene, fract(uv + vec2(-blurStep${index}.x, 0.0))) * 0.12;
      blurColour${index} += texture2D(uScene, fract(uv + vec2(0.0,  blurStep${index}.y))) * 0.12;
      blurColour${index} += texture2D(uScene, fract(uv + vec2(0.0, -blurStep${index}.y))) * 0.12;
      blurColour${index} += texture2D(uScene, fract(uv + blurStep${index})) * 0.08;
      blurColour${index} += texture2D(uScene, fract(uv - blurStep${index})) * 0.08;
      blurColour${index} += texture2D(uScene, fract(uv + vec2(blurStep${index}.x, -blurStep${index}.y))) * 0.08;
      blurColour${index} += texture2D(uScene, fract(uv + vec2(-blurStep${index}.x, blurStep${index}.y))) * 0.08;
      colour = blurColour${index};
    `,
  },
  sharpen: {
    kind: 'color',
    args: [['amount', 'float', 0.5]],
    glsl: ([amount], index) => `
      vec2 sharpStep${index} = vec2(1.0) / uResolution;
      vec4 sharpBlur${index} = (
        texture2D(uScene, fract(uv + vec2(sharpStep${index}.x, 0.0))) +
        texture2D(uScene, fract(uv - vec2(sharpStep${index}.x, 0.0))) +
        texture2D(uScene, fract(uv + vec2(0.0, sharpStep${index}.y))) +
        texture2D(uScene, fract(uv - vec2(0.0, sharpStep${index}.y)))
      ) * 0.25;
      colour.rgb += (colour.rgb - sharpBlur${index}.rgb) * ${amount};
    `,
  },
  edgeDetect: {
    kind: 'color',
    args: [['amount', 'float', 1], ['radius', 'float', 1]],
    glsl: ([amount, radius], index) => `
      vec2 edgeStep${index} = vec2(max(${radius}, 0.0)) / uResolution;
      float edgeLeft${index} = luminance(texture2D(uScene, fract(uv - vec2(edgeStep${index}.x, 0.0))).rgb);
      float edgeRight${index} = luminance(texture2D(uScene, fract(uv + vec2(edgeStep${index}.x, 0.0))).rgb);
      float edgeTop${index} = luminance(texture2D(uScene, fract(uv - vec2(0.0, edgeStep${index}.y))).rgb);
      float edgeBottom${index} = luminance(texture2D(uScene, fract(uv + vec2(0.0, edgeStep${index}.y))).rgb);
      float edgeValue${index} = length(vec2(
        edgeRight${index} - edgeLeft${index}, edgeBottom${index} - edgeTop${index}
      )) * ${amount};
      colour = vec4(vec3(edgeValue${index}), colour.a);
    `,
  },
  bloom: {
    kind: 'color',
    args: [['amount', 'float', 0.8], ['radius', 'float', 4], ['threshold', 'float', 0.55]],
    glsl: ([amount, radius, threshold], index) => `
      vec2 bloomStep${index} = vec2(max(${radius}, 0.0)) / uResolution;
      vec3 bloomColour${index} = vec3(0.0);
      vec3 bloomA${index} = texture2D(uScene, fract(uv + vec2(bloomStep${index}.x, 0.0))).rgb;
      vec3 bloomB${index} = texture2D(uScene, fract(uv - vec2(bloomStep${index}.x, 0.0))).rgb;
      vec3 bloomC${index} = texture2D(uScene, fract(uv + vec2(0.0, bloomStep${index}.y))).rgb;
      vec3 bloomD${index} = texture2D(uScene, fract(uv - vec2(0.0, bloomStep${index}.y))).rgb;
      bloomColour${index} += bloomA${index} * smoothstep(${threshold}, 1.0, luminance(bloomA${index}));
      bloomColour${index} += bloomB${index} * smoothstep(${threshold}, 1.0, luminance(bloomB${index}));
      bloomColour${index} += bloomC${index} * smoothstep(${threshold}, 1.0, luminance(bloomC${index}));
      bloomColour${index} += bloomD${index} * smoothstep(${threshold}, 1.0, luminance(bloomD${index}));
      colour.rgb += bloomColour${index} * 0.25 * ${amount};
    `,
  },
  vignette: {
    kind: 'color',
    args: [['amount', 'float', 0.5], ['softness', 'float', 0.35]],
    glsl: ([amount, softness], index) => `
      float vignetteDistance${index} = length((vTexCoord - 0.5) * vec2(uResolution.x / uResolution.y, 1.0));
      float vignetteMask${index} = 1.0 - smoothstep(
        max(0.0, 0.8 - ${softness}), 0.8, vignetteDistance${index}
      ) * clamp(${amount}, 0.0, 1.0);
      colour.rgb *= vignetteMask${index};
    `,
  },
  rgbSplit: {
    kind: 'color',
    args: [['amount', 'float', 3], ['angle', 'float', 0]],
    glsl: ([amount, angle], index) => `
      vec2 splitDirection${index} = vec2(cos(${angle}), sin(${angle})) * ${amount} / uResolution;
      colour.r = texture2D(uScene, fract(uv + splitDirection${index})).r;
      colour.b = texture2D(uScene, fract(uv - splitDirection${index})).b;
    `,
  },
  feedback: {
    kind: 'color',
    args: [['amount', 'float', 0.55], ['decay', 'float', 0.96], ['zoom', 'float', 1.005]],
    glsl: ([amount, decay, zoom], index) => `
      vec2 feedbackUv${index} = (uv - 0.5) / max(abs(${zoom}), 0.0001) + 0.5;
      vec4 feedbackColour${index} = texture2D(uFeedback, fract(feedbackUv${index}));
      feedbackColour${index}.rgb *= ${decay};
      colour = mix(colour, max(colour, feedbackColour${index}), clamp(${amount}, 0.0, 1.0));
    `,
  },
  lumaMask: {
    kind: 'color',
    args: [['threshold', 'float', 0.25], ['softness', 'float', 0.1], ['invert', 'float', 0]],
    glsl: ([threshold, softness, invert], index) => `
      float lumaAlpha${index} = smoothstep(
        ${threshold} - abs(${softness}), ${threshold} + abs(${softness}), luminance(colour.rgb)
      );
      lumaAlpha${index} = mix(lumaAlpha${index}, 1.0 - lumaAlpha${index}, clamp(${invert}, 0.0, 1.0));
      colour.a *= lumaAlpha${index};
    `,
  },
  posterize: {
    kind: 'color',
    args: [['bins', 'float', 3], ['gamma', 'float', 0.6]],
    glsl: ([bins, gamma], index) => `
      float bins${index} = max(abs(${bins}), 1.0);
      float gamma${index} = max(abs(${gamma}), 0.00001);
      vec3 poster${index} = pow(max(colour.rgb, vec3(0.0)), vec3(gamma${index}));
      poster${index} = floor(poster${index} * bins${index}) / bins${index};
      colour.rgb = pow(poster${index}, vec3(1.0 / gamma${index}));
    `,
  },
  shift: {
    kind: 'color',
    args: [['r', 'float', 0.5], ['g', 'float', 0], ['b', 'float', 0], ['a', 'float', 0]],
    glsl: ([r, g, b, a]) => `colour += fract(vec4(${r}, ${g}, ${b}, ${a}));`,
  },
  invert: {
    kind: 'color',
    args: [['amount', 'float', 1]],
    glsl: ([amount]) => `colour.rgb = mix(colour.rgb, 1.0 - colour.rgb, ${amount});`,
  },
  contrast: {
    kind: 'color',
    args: [['amount', 'float', 1.6]],
    glsl: ([amount]) => `colour.rgb = (colour.rgb - 0.5) * ${amount} + 0.5;`,
  },
  brightness: {
    kind: 'color',
    args: [['amount', 'float', 0.4]],
    glsl: ([amount]) => `colour.rgb += vec3(${amount});`,
  },
  luma: {
    kind: 'color',
    args: [['threshold', 'float', 0.5], ['tolerance', 'float', 0.1]],
    glsl: ([threshold, tolerance], index) => `
      float luma${index} = smoothstep(
        ${threshold} - (abs(${tolerance}) + 0.0000001),
        ${threshold} + (abs(${tolerance}) + 0.0000001),
        luminance(colour.rgb)
      );
      colour = vec4(colour.rgb * luma${index}, luma${index});
    `,
  },
  thresh: {
    kind: 'color',
    args: [['threshold', 'float', 0.5], ['tolerance', 'float', 0.04]],
    glsl: ([threshold, tolerance], index) => `
      float threshold${index} = smoothstep(
        ${threshold} - (abs(${tolerance}) + 0.0000001),
        ${threshold} + (abs(${tolerance}) + 0.0000001),
        luminance(colour.rgb)
      );
      colour.rgb = vec3(threshold${index});
    `,
  },
  color: {
    kind: 'color',
    args: [['r', 'float', 1], ['g', 'float', 1], ['b', 'float', 1], ['a', 'float', 1]],
    glsl: ([r, g, b, a], index) => `
      vec4 tint${index} = vec4(${r}, ${g}, ${b}, ${a});
      vec4 positive${index} = step(0.0, tint${index});
      colour = mix((1.0 - colour) * abs(tint${index}), tint${index} * colour, positive${index});
    `,
  },
  saturate: {
    kind: 'color',
    args: [['amount', 'float', 2]],
    glsl: ([amount]) => `colour.rgb = mix(vec3(luminance(colour.rgb)), colour.rgb, ${amount});`,
  },
  hue: {
    kind: 'color',
    args: [['amount', 'float', 0.4]],
    glsl: ([amount], index) => `
      vec3 hsv${index} = rgbToHsv(colour.rgb);
      hsv${index}.x += ${amount};
      colour.rgb = hsvToRgb(hsv${index});
    `,
  },
  colorama: {
    kind: 'color',
    args: [['amount', 'float', 0.005]],
    glsl: ([amount], index) => `
      vec3 colorama${index} = rgbToHsv(colour.rgb) + vec3(${amount});
      colour.rgb = fract(hsvToRgb(colorama${index}));
    `,
  },
  sum: {
    kind: 'color',
    args: [['scale', 'vec4', [1, 1, 1, 1]]],
    glsl: ([scale], index) => `
      vec4 sumChannels${index} = colour * ${scale};
      colour.rgb = vec3(
        sumChannels${index}.r + sumChannels${index}.g + sumChannels${index}.b + sumChannels${index}.a
      );
    `,
  },
  rgba: {
    kind: 'color',
    args: [['r', 'float', 1], ['g', 'float', 1], ['b', 'float', 1], ['a', 'float', 1]],
    glsl: ([r, g, b, a]) => `colour *= vec4(${r}, ${g}, ${b}, ${a});`,
  },
});

export const SHADER_TRANSFORM_OPERATORS = Object.freeze([
  'transform', 'mirror', 'crop', 'noiseWarp',
  'rotate', 'scale', 'pixelate', 'repeat', 'repeatX', 'repeatY',
  'kaleid', 'scroll', 'scrollX', 'scrollY',
]);

export const SHADER_COLOR_OPERATORS = Object.freeze([
  'blur', 'sharpen', 'edgeDetect', 'bloom', 'vignette', 'rgbSplit',
  'feedback', 'lumaMask',
  'posterize', 'shift', 'invert', 'contrast', 'brightness', 'luma', 'thresh',
  'color', 'saturate', 'hue', 'colorama', 'sum', 'rgba',
]);

export const SHADER_BLEND_MODES = Object.freeze([
  'alpha', 'add', 'multiply', 'screen', 'overlay',
  'difference', 'subtract', 'lighten', 'darken',
]);

function blendSource(mode) {
  const rgb = {
    alpha: 'effectColour.rgb',
    add: 'original.rgb + effectColour.rgb',
    multiply: 'original.rgb * effectColour.rgb',
    screen: '1.0 - (1.0 - original.rgb) * (1.0 - effectColour.rgb)',
    overlay: 'mix(2.0 * original.rgb * effectColour.rgb, 1.0 - 2.0 * (1.0 - original.rgb) * (1.0 - effectColour.rgb), step(vec3(0.5), original.rgb))',
    difference: 'abs(original.rgb - effectColour.rgb)',
    subtract: 'original.rgb - effectColour.rgb',
    lighten: 'max(original.rgb, effectColour.rgb)',
    darken: 'min(original.rgb, effectColour.rgb)',
  }[mode];
  if (!rgb) throw new TypeError(`Unknown shader blend mode "${mode}"`);
  return `vec4 blended = vec4(${rgb}, max(original.a, effectColour.a));`;
}

function operation(name, supplied) {
  const spec = SPECS[name];
  if (!spec) throw new TypeError(`Unknown shader operator "${name}"`);
  return {
    name,
    args: spec.args.map(([, , fallback], index) => supplied[index] ?? fallback),
  };
}

/** Compile a method list into one fragment shader and a uniform evaluation plan. */
export function compileShaderOperations(operations, { blendMode = 'alpha' } = {}) {
  const uniforms = [];
  const coord = [];
  const color = [];

  operations.forEach((entry, operationIndex) => {
    const spec = SPECS[entry.name];
    if (!spec) throw new TypeError(`Unknown shader operator "${entry.name}"`);
    const names = spec.args.map(([argName, type, fallback], argIndex) => {
      const name = `u_${operationIndex}_${argName}`;
      uniforms.push({
        name,
        type,
        value: entry.args[argIndex] ?? fallback,
        operator: entry.name,
        argument: argName,
      });
      return name;
    });
    (spec.kind === 'coord' ? coord : color).push(spec.glsl(names, operationIndex));
  });

  const declarations = uniforms.map(({ type, name }) => `uniform ${type} ${name};`).join('\n');
  const fragmentSource = `
    precision highp float;

    varying vec2 vTexCoord;
    uniform sampler2D uScene;
    uniform sampler2D uFeedback;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform vec3 uAudio;
    uniform float uMix;
    ${declarations}

    ${GLSL_HELPERS}

    void main() {
      vec2 uv = vTexCoord;
      float coverage = 1.0;
      ${coord.join('\n')}
      vec4 colour = texture2D(uScene, fract(uv));
      ${color.join('\n')}
      colour *= coverage;
      vec4 original = texture2D(uScene, vTexCoord);
      vec4 effectColour = clamp(colour, 0.0, 1.0);
      ${blendSource(blendMode)}
      gl_FragColor = clamp(mix(original, blended, clamp(uMix, 0.0, 1.0)), 0.0, 1.0);
    }
  `;

  return { fragmentSource, uniforms };
}

/** Resolve a literal or a higher-order live parameter for a p5 shader uniform. */
export function resolveShaderUniform(uniform, context) {
  const candidate = typeof uniform.value === 'function'
    ? uniform.value(context)
    : uniform.value;

  if (uniform.type === 'vec4') {
    if (!Array.isArray(candidate) || candidate.length !== 4) {
      throw new TypeError(`${uniform.operator}.${uniform.argument} must resolve to four numbers`);
    }
    const values = candidate.map(Number);
    if (!values.every(Number.isFinite)) {
      throw new TypeError(`${uniform.operator}.${uniform.argument} must resolve to four finite numbers`);
    }
    return values;
  }

  const value = Number(candidate);
  if (!Number.isFinite(value)) {
    throw new TypeError(`${uniform.operator}.${uniform.argument} must resolve to a finite number`);
  }
  return value;
}

export class ShaderChain {
  #operations = [];
  #output = null;
  #program = null;
  #compiled = null;
  #signature = '';
  #feedback = null;
  #mixValue = 1;
  #blendMode = 'alpha';
  #bypassed = false;

  constructor(operations = []) {
    this.#operations = operations.map(({ name, args }) => operation(name, args));
  }

  get operations() {
    return this.#operations.map(({ name, args }) => ({ name, args: [...args] }));
  }

  clone() {
    return new ShaderChain(this.#operations)
      .mix(this.#mixValue)
      .blend(this.#blendMode)
      .bypass(this.#bypassed);
  }

  clear() {
    this.#operations.length = 0;
    this.#invalidate();
    return this;
  }

  #append(name, args) {
    this.#operations.push(operation(name, args));
    this.#invalidate();
    return this;
  }

  #invalidate() {
    this.#signature = '';
    this.#program = null;
    this.#compiled = null;
  }

  mix(amount = 1) {
    this.#mixValue = amount;
    return this;
  }

  blend(mode = 'alpha') {
    const aliases = { normal: 'alpha', mult: 'multiply', diff: 'difference' };
    const normalized = aliases[String(mode).toLowerCase()] ?? String(mode).toLowerCase();
    if (!SHADER_BLEND_MODES.includes(normalized)) {
      throw new TypeError(`Unknown shader blend mode "${mode}"`);
    }
    this.#blendMode = normalized;
    this.#invalidate();
    return this;
  }

  bypass(enabled = true) {
    this.#bypassed = Boolean(enabled);
    return this;
  }

  transform(x, y, scaleX, scaleY, angle, anchorX, anchorY) {
    return this.#append('transform', [x, y, scaleX, scaleY, angle, anchorX, anchorY]);
  }
  mirror(horizontal, vertical) { return this.#append('mirror', [horizontal, vertical]); }
  crop(left, right, top, bottom) { return this.#append('crop', [left, right, top, bottom]); }
  noiseWarp(amount, scale, speed) { return this.#append('noiseWarp', [amount, scale, speed]); }

  rotate(angle, speed) { return this.#append('rotate', [angle, speed]); }
  scale(amount, xMult, yMult, offsetX, offsetY) {
    return this.#append('scale', [amount, xMult, yMult, offsetX, offsetY]);
  }
  pixelate(pixelX, pixelY) { return this.#append('pixelate', [pixelX, pixelY]); }
  repeat(repeatX, repeatY, offsetX, offsetY) {
    return this.#append('repeat', [repeatX, repeatY, offsetX, offsetY]);
  }
  repeatX(reps, offset) { return this.#append('repeatX', [reps, offset]); }
  repeatY(reps, offset) { return this.#append('repeatY', [reps, offset]); }
  kaleid(sides) { return this.#append('kaleid', [sides]); }
  scroll(x, y, speedX, speedY) { return this.#append('scroll', [x, y, speedX, speedY]); }
  scrollX(x, speed) { return this.#append('scrollX', [x, speed]); }
  scrollY(y, speed) { return this.#append('scrollY', [y, speed]); }

  blur(radius) { return this.#append('blur', [radius]); }
  sharpen(amount) { return this.#append('sharpen', [amount]); }
  edgeDetect(amount, radius) { return this.#append('edgeDetect', [amount, radius]); }
  bloom(amount, radius, threshold) {
    return this.#append('bloom', [amount, radius, threshold]);
  }
  vignette(amount, softness) { return this.#append('vignette', [amount, softness]); }
  rgbSplit(amount, angle) { return this.#append('rgbSplit', [amount, angle]); }
  feedback(amount, decay, zoom) { return this.#append('feedback', [amount, decay, zoom]); }
  lumaMask(threshold, softness, invert) {
    return this.#append('lumaMask', [threshold, softness, invert]);
  }
  posterize(bins, gamma) { return this.#append('posterize', [bins, gamma]); }
  shift(r, g, b, a) { return this.#append('shift', [r, g, b, a]); }
  invert(amount) { return this.#append('invert', [amount]); }
  contrast(amount) { return this.#append('contrast', [amount]); }
  brightness(amount) { return this.#append('brightness', [amount]); }
  luma(threshold, tolerance) { return this.#append('luma', [threshold, tolerance]); }
  thresh(threshold, tolerance) { return this.#append('thresh', [threshold, tolerance]); }
  color(r, g, b, a) { return this.#append('color', [r, g, b, a]); }
  saturate(amount) { return this.#append('saturate', [amount]); }
  hue(amount) { return this.#append('hue', [amount]); }
  colorama(amount) { return this.#append('colorama', [amount]); }
  sum(scale) { return this.#append('sum', [scale]); }
  rgba(r, g, b, a) { return this.#append('rgba', [r, g, b, a]); }

  #ensureShader() {
    if (!this.#output) {
      this.#output = createGraphics(width, height, WEBGL);
      this.#output.pixelDensity(1);
      this.#output.noStroke();
      this.#feedback = createGraphics(width, height);
      this.#feedback.pixelDensity(1);
      this.#feedback.clear();
    } else if (this.#output.width !== width || this.#output.height !== height) {
      this.#output.resizeCanvas(width, height);
      this.#feedback.resizeCanvas(width, height);
      this.#feedback.clear();
    }

    const signature = `${this.#blendMode}:${this.#operations.map(({ name }) => name).join('|')}`;
    if (this.#program && signature === this.#signature) return;
    this.#compiled = compileShaderOperations(this.#operations, { blendMode: this.#blendMode });
    this.#program = this.#output.createShader(VERTEX_SOURCE, this.#compiled.fragmentSource);
    this.#signature = signature;
  }

  draw(context) {
    if (this.#bypassed) return;
    this.#ensureShader();
    this.#output.clear();
    this.#output.shader(this.#program);
    this.#program.setUniform('uScene', context.canvas);
    this.#program.setUniform('uFeedback', this.#feedback);
    this.#program.setUniform('uResolution', [width, height]);
    this.#program.setUniform('uTime', context.time);
    this.#program.setUniform('uAudio', [
      context.audio.bass,
      context.audio.mid,
      context.audio.treble,
    ]);
    this.#program.setUniform('uMix', resolveShaderUniform({
      type: 'float', value: this.#mixValue, operator: 'mix', argument: 'amount',
    }, context));
    for (const uniform of this.#compiled.uniforms) {
      this.#program.setUniform(uniform.name, resolveShaderUniform(uniform, context));
    }
    this.#output.rect(0, 0, width, height);
    blendMode(REPLACE);
    image(this.#output, 0, 0, width, height);
    this.#feedback.clear();
    this.#feedback.image(this.#output, 0, 0, width, height);
  }

  dispose() {
    this.#output?.remove();
    this.#feedback?.remove();
    this.#output = null;
    this.#feedback = null;
    this.#program = null;
    this.#compiled = null;
    this.#signature = '';
  }
}

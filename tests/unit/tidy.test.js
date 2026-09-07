import { describe, expect, it } from 'vitest';
import { tidySource } from '../../src/ui/tidy.js';

describe('tidySource', () => {
  it('indents nested objects, methods, conditions, and arrays', () => {
    const source = `const rings = {
draw({ audio }) {
if (audio.onset) {
circle(width / 2, height / 2, 80);
}
},
};

const scene = [
rings,
];`;

    expect(tidySource(source)).toBe(`const rings = {
  draw({ audio }) {
    if (audio.onset) {
      circle(width / 2, height / 2, 80);
    }
  },
};

const scene = [
  rings,
];`);
  });

  it('ignores delimiters in comments and strings', () => {
    const source = `const patch = {
// a misleading } ] ) comment
draw() {
text("}])", 10, 10);
}
};`;

    expect(tidySource(source)).toBe(`const patch = {
  // a misleading } ] ) comment
  draw() {
    text("}])", 10, 10);
  }
};`);
  });

  it('tidies recognized GLSL template indentation', () => {
    const source = `const fragment = \`
precision highp float;

uniform sampler2D uScene;

void main() {
float red = texture2D(
uScene,
vec2(0.5)
).r;
vec3 colour = vec3(1.0);
gl_FragColor = vec4(colour * red, 1.0);
}
\`;`;

    expect(tidySource(source)).toBe(`const fragment = \`
  precision highp float;

  uniform sampler2D uScene;

  void main() {
    float red = texture2D(
      uScene,
      vec2(0.5)
    ).r;
    vec3 colour = vec3(1.0);
    gl_FragColor = vec4(colour * red, 1.0);
  }
\`;`);
  });

  it('preserves ordinary multiline template text', () => {
    const source = `const message = \`
  This spacing is authored text.
It is not executable GLSL.
\`;`;

    expect(tidySource(source)).toBe(source);
  });

  it('ignores backticks in comments and preserves CRLF around GLSL', () => {
    const source = '// a `template` is mentioned here\r\nconst fragment = `\r\nvoid main() {\r\ngl_FragColor = vec4(1.0);\r\n}\r\n`;';

    expect(tidySource(source)).toBe('// a `template` is mentioned here\r\nconst fragment = `\r\n  void main() {\r\n    gl_FragColor = vec4(1.0);\r\n  }\r\n`;');
  });
});

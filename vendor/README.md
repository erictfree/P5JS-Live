# Vendored runtime libraries

p5js live serves pinned local builds so a performance does not depend on a CDN or
change when an upstream `latest` tag moves.

| File | Release | Official package | SHA-256 |
| --- | --- | --- | --- |
| `p5.min.js` | p5.js 2.3.2 | `p5@2.3.2` | `87adc350e8ec0e9bced22d4f03c181bdd208dc997d3956ab3ec2e90537643c9a` |
| `p5.sound.min.js` | p5.sound 0.4.1 | `p5.sound@0.4.1` | `a1ab1dcac4b5cfa68c077fee2a8d43deb630d20498fc3f54f56c9ee90ab7d5b1` |

The matching upstream license texts are stored as `p5.LICENSE.txt` and
`p5.sound.LICENSE.txt`.

To verify a replacement on macOS:

```sh
shasum -a 256 vendor/p5.min.js vendor/p5.sound.min.js
```

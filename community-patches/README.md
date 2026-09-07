# Sharing a patch

Put one JavaScript file per contribution in this directory. The header is the patch's
library configuration and every field is required:

```js
// %% patch myPatch
// @title My Patch
// @author Your Name
// @description One sentence explaining what it draws.
// @category community
// @version 1

const myPatch = {
  draw({ audio }) {
    circle(width / 2, height / 2, 20 + audio.bass * 200);
  },
};
```

After installing the patch, try it in a scene cell:

```js
// %% scene scene
const scene = [[myPatch].rotate(0, 0.2).opacity(0.8)];
scene.draw();
```

Keep the contribution file focused on the patch definition. Array composition and
effects belong in the performer's scene, where patches can be combined freely.

Valid categories are:

- `visual` — a general drawing patch
- `utility` — backgrounds, diagnostics, meters, or scene helpers
- `shader` — a WebGL or post-processing patch
- `community` — a contributed patch that should stay in the Community patches group

Run `npm run build:patches` after adding or changing a file. Invalid or missing metadata
stops the build instead of silently placing the patch in the wrong group.

The same source-only format is used by **Library → Share current patch** in the
browser. **Export** downloads one `.p5patch.js` file, **copy link** puts its source in
the URL fragment, and **import** adds a received file under Shared patches as
Available. None of these actions installs, activates, or evaluates the patch.

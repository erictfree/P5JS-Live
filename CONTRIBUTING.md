# Contributing to p5js live

p5js live welcomes fixes, documentation, performance tools, visual patches, shader
ideas, and focused improvements to the live-coding workflow.

## Set up the repository

```sh
git clone https://github.com/erictfree/p5js-live.git
cd p5js-live
npm ci
npm run dev
```

Create a branch for the change:

```sh
git switch -c feature/short-description
```

Before opening a pull request, run:

```sh
npm test
npm run test:e2e
```

The browser suite requires Chromium once:

```sh
npx playwright install chromium
```

## Contribute a patch

One patch can be contributed without changing the runtime. Add one `.js` file to
`community-patches/` following the [community patch guide](community-patches/README.md).
`npm run dev` and `npm test` rebuild the generated catalog automatically.

A strong community patch is:

- small enough to understand and remix;
- visually distinct without assuming a particular scene;
- bounded in memory and per-frame work;
- safe to combine with other patches;
- configurable through clearly named properties or live parameters;
- credited with an author and a concise description.

Do not edit `src/generated/communityPatches.js`; it is generated from the individual
source files.

## Contribute runtime or interface code

- Keep the canvas and audio graph alive across successful live evaluations.
- Preserve the last working patch or scene when candidate code fails.
- Keep scene source authoritative; interface actions should edit visible source rather
  than create a hidden composition model.
- Keep DOM concerns in `src/ui` and data/runtime concerns outside it.
- Add or update tests for behavior changes.
- Avoid unrelated formatting or generated-file changes in the same pull request.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing evaluation,
rollback, identity, persistence, or the host loop.

## Report bugs and propose features

Open a GitHub issue with:

- the browser and operating system;
- steps to reproduce the behavior;
- the smallest source buffer that demonstrates it;
- what you expected and what happened;
- relevant diagnostics or screenshots.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a public
issue.

## Documentation changes

Start at the [documentation index](docs/README.md). Keep authoring changes aligned
across the API, data model, starter, and composition examples; use the current
interface labels in workflows. Mark complete runnable programs with an
`<!-- example: name -->` comment above their JavaScript fence and cover them in
[documentation.spec.js](tests/e2e/documentation.spec.js). The browser tests read
those fences directly and check real rendering, including the local network example.

```sh
npx playwright test tests/e2e/documentation.spec.js
```

## License

By contributing, you agree that your contribution may be distributed under the
[MIT License](LICENSE).

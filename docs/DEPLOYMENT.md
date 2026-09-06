# GitHub Pages deployment

**Live application:** https://wieslawsoltes.github.io/AxiomCAD/

**Repository:** https://github.com/wieslawsoltes/AxiomCAD

The site is published by [Test and deploy GitHub Pages](../.github/workflows/pages.yml). Every push to `main` runs the unit tests, builds the self-contained HTML distribution, and executes the browser integration suite against that exact production bundle. Deployment proceeds only after the build job succeeds. Pull requests run validation but do not deploy.

The browser tests exercise the actual UI, Web Worker, geometry kernel and renderer with Chromium/SwiftShader. This is software-renderer coverage, not certification of native hardware WebGPU behavior or performance.

## Published files

- `/AxiomCAD/`: the self-contained app, published as `index.html`.
- `/AxiomCAD/axiom-cad.html`: the same standalone distribution.
- `/AxiomCAD/examples/`: the example Axiom documents and STL.
- `/AxiomCAD/version.json`: the exact source commit, workflow run, build timestamp and SHA-256 of the published HTML.

The final workflow step downloads the public version manifest and HTML, verifies the source commit, and checks the HTML's SHA-256. Validation reports and actual rendered previews are retained as workflow artifacts for 14 days.

## Development

Requires Node.js 20 or newer. No runtime dependencies or npm installation are necessary.

```sh
git clone https://github.com/wieslawsoltes/AxiomCAD.git
cd AxiomCAD
npm test
npm run build
npm start
```

The development server binds to loopback by default. WebGPU requires a supported browser and a secure context (HTTPS or localhost); the viewport badge identifies the active renderer. WebGL2 is used when WebGPU is unavailable.

Python Playwright is required only for browser tests. CI pins Playwright and downloads its matching Chromium build. The test harness polls readiness through the automation protocol without adding `unsafe-eval` or disabling the application's CSP.

## Publication configuration

The repository's GitHub Pages publishing source is GitHub Actions. The build has read-only repository access. Only the deployment job requests `pages: write` and `id-token: write`; it deploys through the `github-pages` environment. No personal access token or third-party hosting service is required.

To republish an existing commit, use **Actions → Test and deploy GitHub Pages → Run workflow** on `main`. Published content is built from source, not copied from a stale checked-in distribution.

## Initial import

The original project was transferred as a checksum-verified, compressed source payload. A one-time import workflow reconstructed the readable files, generated binary examples and previews, ran validation, and committed the complete project. Temporary transfer files and the one-time workflow were removed from the working tree afterward; ordinary Git history is preserved.

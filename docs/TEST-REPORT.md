# Validation report — Axiom CAD 0.1.0

Date: 2026-09-06.

## Executed checks

**36 Node tests passed, zero failures.** This covers analytic box metrics, winding-independent concave extrusion, invalid profiles, collinear polygon normals, cylinders/tubes, sphere approximation, partial revolutions, all three CSG operations, T-junction edge cleanup, operand transforms, reflections, shells, holes/suppression, rounded boxes, both example assemblies, cache invalidation, float64 camera inverses, picking, zoom anchoring, document validation, STL and OBJ round trips, malformed imports, standalone JavaScript compilation and local-server HTTP behavior.

**40 browser integration checks passed, zero uncaught JavaScript errors.** These execute the real application, a real geometry Web Worker and the real WebGL2 renderer. They cover initial assembly generation, idle rendering, inspector edits, Undo/Redo, invalid parameter handling, materials, primitive creation, hole cutting, canvas picking, pointer movement, measurement, section lines, exploded offsets, display modes, themes, camera projection, pointer-drawn rectangle sketches, linked extrusion, sketch dimension edits, sketch deletion/freezing and Undo, Boolean union/Undo, patterns, mirrors, isolation, SVG construction, PNG raster capture, native document reload, OBJ unit conversion, command palette dispatch and desktop layout.

The full per-check list is in `browser-test-results.json`; raw Node results are in `unit-test-results.txt`. Preview PNGs are actual screenshots of the running application, not generated design images.

## Environment

Node.js 22.16.0; Python 3.13; Playwright; Chromium **144.0.7559.96**. Browser integration uses **WebGL2 through SwiftShader**. The standalone HTML was loaded into an inline `about:blank` document because managed browser policy prohibited URL navigation in the test environment. The policy was not changed. A virtual X display was used for the software graphics backend.

The local development server was tested separately with Node HTTP requests. The standalone build was checked as classic JavaScript using `vm.Script`; the actual standalone application was then exercised by the browser suite.

## Not verified

Native WebGPU WGSL compilation, pipeline creation, canvas presentation, device-loss recovery and hardware GPU performance were **not executed successfully in this environment**. The API was unavailable in the inline document. Attempts to obtain a separate native test runtime were unsuccessful. Do not treat the fallback screenshots or the test count as evidence of a WebGPU hardware run.

Real-origin browser localStorage persistence and browser-managed download/save dialogs were not verified. File payload generation, native JSON reload, parser/exporter round trips and canvas raster capture were exercised. Multi-browser/mobile behavior, accessibility conformance, very large assemblies, arbitrary third-party CAD meshes, robust manifoldness and manufacturing suitability have not been certified.

## Performance interpretation

The shipped bearing sample generates **22,182 triangles across 14 bodies** in this implementation. Unit and browser checks establish functionality, not an FPS target. On-demand rendering was observed to leave its frame counter unchanged when the workspace was idle. The UI's `Submit` timing is CPU submission duration, not GPU elapsed time. No claim of a particular hardware framerate is made.

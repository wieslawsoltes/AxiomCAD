# Axiom CAD: implementation contracts

## Source boundaries

| Module | Responsibility |
| --- | --- |
| `math.js` | Float64 vectors/matrices, Z-up camera, projection and unprojection, ray/AABB and ray/triangle tests |
| `geometry.js` | Pure solid generation, ear clipping, profile revolution, BSP CSG, transforms, edge extraction, metrics |
| `geometry-worker.js` | Versioned worker requests and transferable typed-array results |
| `renderer.js` | WebGPU and WebGL2 GPU resources, shaders, batch uploads, section contours and rendering |
| `io.js` | Native-document validation, unit-independent STL/OBJ parsing, mesh serialization |
| `samples.js` | Editable example models and document/body construction |
| `icons.js` | Original inline SVG icon geometry |
| `app.js` | Document transactions/history, UI, property editing, interaction state, file orchestration and worker lifecycle |
| `styles.css` | Workspace layout, visual tokens, light/dark themes and responsive rules |

No module imports a runtime library. The worker duplicates the pure kernel into its own realm in the standalone build. The editable source distribution uses a module worker.

## Document model

The JSON root contains `schema: "axiom-cad"`, `version: 1`, `units: "mm"`, `name`, `bodies` and `sketches`. Body identifiers and sketch identifiers are unique within their top-level collections. Each body stores `kind`, `params`, `features`, a local transform, visibility, color and material.

Transforms use scale, then X/Y/Z Euler rotations, then translation. Geometry uses right-handed world coordinates with Z up. A negative scale reverses polygon winding so transformed solids retain outward-facing topology. The CPU kernel stores ordinary JavaScript numbers. Render vertices are float32 and should not be treated as an exact CAD representation.

Extrusion parameters contain a points snapshot and an optional `sketchId`. Before each rebuild the app synchronizes points from that sketch. Deleting a sketch freezes the latest profile and removes the link. Boolean and mirror operands are recursive snapshots, deliberately not a general dependency DAG. Their transformation semantics are world-relative; the result can then have its own transform.

Document transactions snapshot the previous JSON, clear redo, record history, schedule local autosave and trigger appropriate geometry or appearance refreshes. Undo history is limited to 60 states and approximately 32 million serialized characters. This is not a strict byte-memory budget. A single very large state can still exceed it. Failed synchronous mutations restore the previous document. Asynchronous geometry failures leave the feature visible in the tree with an error status and can be undone.

## Geometry pipeline

Closed 2D loops are normalized by winding and triangulated with ear clipping. Caps are triangles and side faces are convex polygons. Revolutions build angular strips and, when needed, end caps. The kernel does not preserve arcs as analytic entities.

CSG partitions oriented polygons using BSP planes and an absolute classification tolerance of 1e-5 model units. Intersection splitting produces new convex polygons. Union, subtraction and intersection use clipping and orientation reversal. A depth guard, operand polygon guard, result guard and worker timeout limit pathological work. The tolerance and guards do not guarantee manifoldness or robustness for arbitrary CAD imports.

Local shape results are cached against serialized kind/parameters/features. World transforms are applied after cache lookup. Cache retention is capped at 100 signatures, not by total polygon memory.

Packing generates triangles, smooth vertex normals, AABBs, approximate signed-volume magnitude, surface area and feature edges. Feature-edge extraction groups collinear polygon boundaries and sweeps overlapping intervals. It suppresses coplanar T-junction seams introduced by BSP splitting while retaining boundaries and normal discontinuities. It is a geometric welding heuristic, not an analytic topological-edge model.

## Worker protocol

Request:

```js
{ revision, bodies }
```

Response:

```js
{
  revision,
  buildMs,
  items: [
    { id, vertices, edges, bounds, volume, area, triangleCount },
    // or: { id, error }
  ]
}
```

`vertices` holds position/normal pairs: 6 float32 elements per vertex, 18 per triangle. `edges` holds consecutive endpoint positions: 6 float32 elements per segment. Both buffers are transferred, not copied, on worker completion. Body JSON is still structured-cloned into the worker.

Only a response for the current revision is accepted. A completed-revision marker prevents exports from reusing obsolete geometry after a worker timeout. The last valid visualization may remain temporarily visible while a rebuild is pending. On-demand rendering and stale-result rejection are not cooperative cancellation: previous work can still consume time until it completes or the worker is terminated.

## GPU layout

The renderer expands the kernel vertex stream to this interleaved format:

| Byte offset | Format | Meaning |
| --- | --- | --- |
| 0 | float32x3 | World position |
| 12 | float32x3 | Smoothed normal |
| 24 | float32x3 | Body display color |
| 36 | float32 | One-based body index; negative values denote ground/section annotations |
| 40 | float32x2 | Metallic and roughness parameters |

Stride: **48 bytes**. The current implementation is unindexed and duplicates triangle vertices. Scene geometry is combined into one surface buffer and one technical-edge buffer. Exploded views and move previews change packed positions, not design coordinates. That avoids CSG regeneration during dragging but still costs a CPU repack and GPU upload.

The **128-byte** uniform consists of a view-projection matrix, eye position, selection/clipping options, rendering settings and ground parameters. WebGPU uses a four-sample color/depth target, resolves into the canvas texture, and draws technical edges with depth testing. A third buffer contains CPU-generated triangle/plane intersection lines. WebGL2 uses the equivalent stream and explicitly converts zero-to-one clip depth to OpenGL clip depth.

Ground contact darkening is an analytic visual approximation, not shadow-map occlusion. Metallic/roughness shading uses a GGX-like direct-light approximation plus fill lighting. There is no environment map, path tracer or exact materials model.

## Picking and overlays

Body picking first rejects world-space AABBs and then tests triangles on the CPU. Picks account for exploded offsets and the active section plane. There is no BVH beyond body-level bounds; dense imported meshes can therefore make pointer movement costly.

Move handles are projected into an SVG interaction layer. Free movement intersects the camera-facing drag plane; axis movement projects the chosen world axis into screen space. Sketch pointer coordinates intersect the active reference plane and optionally snap to a 1 mm grid. Orthographic/perspective camera operations use float64 matrices, avoiding the large-depth-ratio unprojection drift found during testing.

## Deliberate extension boundaries

A production exact-CAD implementation would replace or complement the polygonal kernel behind the worker contract, rather than reusing CSG triangles as a B-rep. A constraint solver, persistent feature DAG, stable topological naming and assembly mates would need explicit data-model layers. STEP/native CAD format support is not achieved by renaming mesh files.

For larger scenes, the concrete next performance boundaries are per-body GPU transforms, indexed geometry, incremental dirty-body uploads, body/triangle BVHs, adaptive tessellation, memory-budgeted caches and cooperative worker scheduling. None is claimed as implemented here.

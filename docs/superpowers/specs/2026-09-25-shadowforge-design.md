# SHADOWFORGE design

Date: 2026-09-25

## Premise

SHADOWFORGE is a compact 3D puzzle game. Lights and simple objects cast shadows onto marked forge surfaces. The player previews that shadow, then activates a forge console. The shadow freezes into a walkable, climbable collision surface. Desktop and touch use the same puzzles and the same discrete snap positions.

## Shadow rule

Each forge surface is a grid of cells (0.25 world units unless a surface overrides it). A cell is **shadowed** only when at least one enabled light reaches it and every light that reaches it is blocked by a caster. Cells no light reaches are dark and cannot be forged. Gameplay never reads GPU shadow maps. Masks are recomputed only when a light or caster changes.

Casters are boxes, triangular prisms, cylinders, or L-shapes made of two boxes. Rays are tested analytically, including yaw.

## Forging and stability

Activating a console copies the current shadowed cells into a solid mask and builds collision boxes (greedy-merged). Floor shadows are slabs. Wall shadows extrude toward the player and are climbable. Ramps and stairs become rows of steps no taller than the controller step height.

The solid shape is kept if the live shadow still covers it. If coverage breaks, stability drains. Surfaces marked unstable also drain on a timer (default about 12 seconds) and can be forged again. At 0% the collision is removed and the surface collapses.

## Manipulation

Every movable light and object implements the same discrete states. Interaction is either a one-press toggle (two states) or a manipulation mode: the camera frames the object, snap nodes or an arc are shown, and the live forge preview updates as the selection changes. Confirm commits; cancel restores the previous state. Mobile uses large tap targets and swipe steps, never free 3D dragging.

## Player

A kinematic body (radius 0.28, height 1.15) moves against axis-aligned boxes: gravity, coyote time, jump buffer, step-up, and climbing while pushing into a climbable face. The camera is a smoothed third-person orbit that pulls in when a box blocks it.

## Content

Ten data-driven rooms. A level config lists platforms, lights, casters, forge surfaces, consoles, a solution state map, and the cells that must be shadowed. `src/levels/evaluate.ts` is shared by the game and the tests.

## Persistence and presentation

Progress and settings live in versioned localStorage. Audio is synthesized with the Web Audio API and starts after a user gesture. Haptics use `navigator.vibrate` when enabled. Quality presets (auto, low, medium, high) change pixel ratio, shadow maps, particles, and bloom. Auto steps down if the frame rate stays low. Portrait phones show a rotate overlay and pause simulation.

## Build

Static Vite app (`base: './'`). `npm install`, `npm run dev`, `npm run build`. No server, account, or asset pack.

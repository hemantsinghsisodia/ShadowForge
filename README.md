# SHADOWFORGE

*Shape the darkness. Change the world.*

A 3D puzzle game for the browser, built with Three.js, TypeScript and Vite. Shadows that fall on glowing **forge plates** can be solidified. Arrange lamps and objects, watch the live shadow preview, then use a forge console to turn the shadow into something you can walk on or climb.

It runs entirely in the browser with no backend. It works with a keyboard and mouse on desktop and with touch in landscape on phones and tablets.

## Getting started

You need Node.js 18 or newer.

```bash
npm install
npm run dev
```

Open the address Vite prints, usually `http://localhost:5173`.

To play on a phone or tablet on the same network:

```bash
npm run dev -- --host
```

Then open the network address Vite prints on the device.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the development server |
| `npm run build` | Type-checks, then builds a static site into `dist/` |
| `npm run preview` | Serves the built `dist/` folder locally |
| `npm test` | Runs the Vitest suite |

## Controls

**Desktop**

- **Move:** WASD or the arrow keys
- **Look:** click the view to lock the mouse, then move it
- **Jump:** Space
- **Interact:** E or Enter, near a lamp, object or console
- **Pause:** Esc

**Touch (landscape)**

- **Move:** drag on the left side of the screen (a floating stick)
- **Look:** drag on the right side
- **Jump / Use / Pause:** on-screen buttons. **Use** only appears near something you can interact with.

On a phone in portrait, a *Rotate your device* overlay pauses the game.

**Adjusting a lamp or object**

Interact with it to enter manipulation mode. Snap positions and the live shadow preview are shown.

- **Desktop:** A/D, the arrow keys, the mouse wheel, or click a node. E confirms, Esc cancels.
- **Touch:** tap a node, swipe, or drag the slider. Tap **Confirm** or **Cancel**.

## How the shadows work

- Each forge plate is divided into a grid of 0.25-unit cells.
- A cell is **shadowed** when at least one enabled light reaches it and every light that reaches it is blocked by an object. A cell that no light reaches is only dark and cannot be forged. An extra unblocked light washes the shadow out.
- Using a console freezes the current shadow into collision boxes. Floor plates become bridges, and wall plates become climbable ledges.
- The frozen shape loses stability if you later move the light or object so the shadow no longer covers it, and on unstable plates over time. When stability reaches zero, the shadow collapses.
- The gameplay reads only this grid, never GPU shadow maps, so every device gets the same result. The forge shader draws the same grid.

## Levels

1. **First Shadow:** forge a shadow that already falls across the gap.
2. **Move the Light:** slide a lamp until the shadow is long enough.
3. **Shadow Wall:** forge a pillar's shadow on a wall and climb it.
4. **Shape Matters:** choose the shape that casts a bridge.
5. **Multiple Objects:** seat two blocks so their shadows join.
6. **Rotating Light:** aim a spotlight at a statue.
7. **Unstable Shadows:** cross before the bridge decays.
8. **Shadow Sculptor:** pick the right silhouette, then set an L-block and a cylinder.
9. **Light Network:** switch off the lamps that wash out the shadow.
10. **The Forge:** a moving lamp, a wall to climb and a fading bridge.

Progress, best times, resets and settings are saved in `localStorage`.

## Settings

- Graphics quality: Auto, Low, Medium or High. Auto lowers quality if the frame rate stays low.
- Sound effects, music and volume
- Haptics (on devices that support vibration)
- Look and movement sensitivity, and inverted look

## Project layout

```text
src/
  main.ts              Boot screen and WebGL check
  game/Game.ts         State machine, game loop and level flow
  core/                Renderer, device checks, game states, adaptive quality
  input/               Keyboard, mouse, touch, joystick and swipe input
  interaction/         Manipulation mode for lamps and objects
  levels/              Level data (Level1–Level10), helpers, shared evaluation
  shadows/             Shadow grid math, ShadowManager, forge plate shader
  physics/             Kinematic character controller
  player/              Robot model and third-person camera
  world/               Builds each level's meshes, lights and consoles
  effects/             Particles
  audio/               Synthesized Web Audio effects and haptics
  save/, settings/     localStorage save file and settings
  ui/                  Menus, HUD and styles
tests/                 Vitest tests
docs/superpowers/specs Design document
```

## Tests

`npm test` covers:

- ray tests against every caster shape
- multi-light masks
- merging cells into collision boxes
- the character controller
- save validation
- each level: its solution covers the required cells, and exactly one combination of states does

Level 1 is also simulated end to end. The player falls into the gap before the shadow is forged and walks across it afterwards.

## Debug mode

Add `?debug=1` to the URL to unlock all levels and expose `window.__SF` in the browser console:

- `__SF.jump(n)`: open level *n*
- `__SF.begin()`: start the open level
- `__SF.solve()`: apply the level's solution
- `__SF.forge()`: forge every plate
- `__SF.use()`: interact with the nearest item
- `__SF.pos()`: report the player's position
- `__SF.drive(x, z, ms)`: move the player in world axes for `ms` milliseconds
- `__SF.boxes()`: list the current collision boxes

## Deployment

`npm run build` writes a static site to `dist/`. Vite is configured with `base: './'`, so the folder works on any static host, including Vercel, Netlify, Cloudflare Pages and GitHub Pages.

If the browser can't create a WebGL context, the game shows a message asking for a modern browser with WebGL enabled.

# Visual Upgrade Phase 1 (Fix & Tune) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Execution model (user rule):** every implementer and reviewer subagent runs with `model: "sonnet"`, `effort: "high"`.

**Goal:** Make particles visible, make emissives actually bloom, give the scene real lighting depth, fix Low-tier colour, and start phones on Medium, so the game looks clearly better before any new VFX.

**Architecture:** Bloom and grade values move into `QualityProfile` so every tier is tuned in one place. `Renderer` gains a `punch()` channel and the grade shader gains `flash`, `flashColor` and `ca` uniforms; Phase 2 drives these. Custom shaders get three's tone-mapping and colour-space includes, so the Low tier (no composer) matches the composer tiers.

**Tech Stack:** TypeScript 5.6, three 0.170 (WebGL2, stock `EffectComposer`), Vite 6, Vitest 4 (`environment: 'node'`, no WebGL).

**Spec:** `docs/superpowers/specs/2026-10-23-visual-upgrade-design.md` (Phase 1 section)

## Global Constraints
- Branch: `feat/visual-upgrade`. One commit per task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No new npm dependencies in Phase 1.
- Low tier gets no new GPU cost: no composer, no env map, no bloom.
- Never add or remove lights at runtime; change only intensities.
- Every task must keep `npm test` and `npm run build` (`tsc --noEmit && vite build`) green.
- Match the surrounding code style: GLSL in template-literal consts, sparse comments, `private` fields.

## Review Focus
1. **Switching tier at runtime.** `applyTier` calls `setPresentation` again, so the old composer, bloom pass and grade pass must not leak, and a stale `punch` must not persist. Task 3 adds a test that `punch` resets with `ZERO_PUNCH`, and its manual check toggles quality in Settings repeatedly.
2. **The debug hook `post('bloom')` (one swap pass).** It must not flicker after the grade pass becomes unconditional. Covered in Task 3's manual step.
3. **Phones at device pixel ratio 2.** Points must not become huge, so they are capped at 64 px in the shader. The test is in Task 1.
4. **Lit floors and trim under strong lamps.** They must stay below the bloom threshold, so the whole room doesn't haze. Task 4's manual check runs `__SF.bloom` with the shipped values.
5. **`punch()` on the Low tier** (no composer, no grade pass). It must not throw, and its exposure must still apply. Covered in Task 3's test via `applyPunch` on a null grade.

---

### Task 1: Particles render again

**Files:**
- Modify: `src/effects/ParticleManager.ts`
- Modify: `src/game/Game.ts` (`applyTier`, ~l.670)
- Test: `tests/particles.test.ts` (create)

**Interfaces:**
- Produces:
  - `export const PARTICLE_VERT: string` and `export const PARTICLE_FRAG: string`, the renamed `VERT` and `FRAG`.
  - `export const KIND_INTENSITY: Record<BurstKind, number>`, with values `{ spark: 3.0, shard: 2.5, ember: 2.0 }`.
  - `export const DUST_INTENSITY = 0.6`.
  - `ParticleManager.setPixelRatio(dpr: number): void`.
  - `ParticleManager.burst(x, y, z, count, hex, kind = 'spark', intensity = KIND_INTENSITY[kind]): void`.
  - `ParticleManager.burstPoints(points: Float32Array, perPoint: number, hex: number, kind: BurstKind, dir?: [number, number, number]): void`.
    - `points` is packed xyz.
    - It spawns `perPoint` particles at each point, never more than the budget allows.
    - `dir` adds `dir * 1.6` to each particle's velocity.
  - Export `type BurstKind`.

- [ ] **Step 1: Write the failing test** in `tests/particles.test.ts`:
```ts
import { PARTICLE_VERT, PARTICLE_FRAG, KIND_INTENSITY, DUST_INTENSITY } from '../src/effects/ParticleManager';
it('declares its own colour attribute instead of the built-in one', () => {
  expect(PARTICLE_VERT).toMatch(/attribute vec3 aColor;/);
  expect(PARTICLE_VERT).not.toMatch(/=\s*color\s*;/);
});
it('caps point size and scales by pixel ratio', () => {
  expect(PARTICLE_VERT).toMatch(/uniform float uScale;/);
  expect(PARTICLE_VERT).toMatch(/min\(64\.0,/);
});
it('tone-maps so the Low tier matches composer tiers', () => {
  expect(PARTICLE_FRAG).toMatch(/#include <tonemapping_fragment>/);
  expect(PARTICLE_FRAG).toMatch(/#include <colorspace_fragment>/);
});
it('pushes burst kinds above the bloom threshold and keeps dust below', () => {
  expect(KIND_INTENSITY).toEqual({ spark: 3.0, shard: 2.5, ember: 2.0 });
  expect(DUST_INTENSITY).toBe(0.6);
});
```
- [ ] **Step 2:** Run `npx vitest run tests/particles.test.ts`. Expected: FAIL, because the exports don't exist yet.
- [ ] **Step 3: Implement.**
  - **Colour attribute:**
    - Geometry attribute `'color'` becomes `'aColor'`, and the vertex shader uses `vColor = aColor`.
    - Don't set `vertexColors`.
  - **Point size:**
    - Uniform `uScale` (default 1).
    - `gl_PointSize = min(64.0, size * uScale * 80.0 / max(1.0, -mv.z))`.
    - `setPixelRatio` writes `uScale`.
  - **Fragment shader:** append the two includes after `gl_FragColor`.
  - **Colour intensity:**
    - `burst` writes `color * intensity` into `colors`.
    - `seedDust` writes `0.75, 0.88, 1` × `DUST_INTENSITY`.
  - **Uploads:**
    - Track `hiAlive`, the highest live burst index plus one.
    - On each `update`, call `clearUpdateRanges()` on the attribute. Then add the range `[0, hiAlive*itemSize)` and the dust range `[dustStart*itemSize, dust*itemSize)`, and set `needsUpdate` for position, size and alpha.
    - Upload `aColor` only when a `colorDirty` flag (set in `burst`, `burstPoints` and `seedDust`) is true.
    - Skip all uploads when `hiAlive === 0 && this.dust === 0`.
  - **`Game.applyTier`:** after `setDust`, call `this.particles.setPixelRatio(this.renderer.renderer.getPixelRatio())`.
- [ ] **Step 4:** Run `npm test && npm run build`. Expected: all tests pass and the build succeeds.
- [ ] **Step 5:** Commit with `fix: render particles with own colour attribute, HDR intensity and dpr scaling`.

---

### Task 2: Quality profiles, phone start tier and step-up

**Files:**
- Modify: `src/settings/Settings.ts`
- Modify: `src/core/QualityMonitor.ts`
- Test: `tests/quality.test.ts`

**Interfaces:**
- Produces:
  - `QualityProfile` gains these fields:
    - `bloomStrength: number`
    - `bloomRadius: number`
    - `bloomThreshold: number`
    - `exposure: number`
    - `chromatic: number`
  - `QualityProfile` loses `lightCap` and `antialias`.
  - `upgrade(tier: AppliedQuality): AppliedQuality | null` (low → medium → high → null).
  - `nextTier(windows: number[], tier: AppliedQuality, mode: QualityMode, dropped: boolean): AppliedQuality | null`.
    - `windows` holds the 90-frame averages, newest last.

Profile values:

| Tier | bloomStrength | bloomRadius | bloomThreshold | exposure | chromatic |
|---|---|---|---|---|---|
| low | 0 | 0 | 1 | 1.05 | 0 |
| medium | 0.45 | 0.35 | 0.90 | 1.0 | 0 |
| high | 0.65 | 0.45 | 0.85 | 1.0 | 0.0012 |

- [ ] **Step 1: Update and add tests** in `tests/quality.test.ts`.
  - Replace the "starts AUTO on HIGH" test with:
```ts
it('starts AUTO on MEDIUM for phones and HIGH for desktops', () => {
  expect(initialAppliedQuality('auto', true)).toBe('medium');
  expect(initialAppliedQuality('auto', false)).toBe('high');
});
it('tunes bloom per tier', () => {
  const m = profileFor('medium', false), h = profileFor('high', false);
  expect([m.bloomStrength, m.bloomRadius, m.bloomThreshold]).toEqual([0.45, 0.35, 0.9]);
  expect([h.bloomStrength, h.bloomRadius, h.bloomThreshold]).toEqual([0.65, 0.45, 0.85]);
  expect(h.chromatic).toBe(0.0012);
  expect(m.chromatic).toBe(0);
  expect(profileFor('low', true).exposure).toBe(1.05);
});
describe('nextTier', () => {
  it('drops a tier when the newest window is under 42 fps', () =>
    expect(nextTier([40], 'high', 'auto', false)).toBe('medium'));
  it('steps up after three windows at 57+ fps', () =>
    expect(nextTier([58, 60, 59], 'medium', 'auto', false)).toBe('high'));
  it('needs three good windows in a row', () =>
    expect(nextTier([58, 50, 59], 'medium', 'auto', false)).toBeNull());
  it('never steps up after a drop this session', () =>
    expect(nextTier([60, 60, 60], 'medium', 'auto', true)).toBeNull());
  it('does nothing in manual mode', () =>
    expect(nextTier([10], 'high', 'high', false)).toBeNull());
  it('stays put at the ends', () => {
    expect(nextTier([10], 'low', 'auto', false)).toBeNull();
    expect(nextTier([60, 60, 60], 'high', 'auto', false)).toBeNull();
  });
});
```
  - In the first test, keep the existing phone-on-HIGH assertions.
- [ ] **Step 2:** Run `npx vitest run tests/quality.test.ts`. Expected: FAIL, because `nextTier` and the new fields are missing and the phone start tier is `high`.
- [ ] **Step 3: Implement.**
  - **Settings:**
    - Add the profile fields from the table and delete `lightCap` and `antialias` (nothing reads them).
    - `initialAppliedQuality` returns `coarse ? 'medium' : 'high'` for `'auto'`. Rename `_coarse` to `coarse`.
    - Add `upgrade` and `nextTier` to `Settings.ts`.
    - `nextTier` rules:
      - Manual mode returns null.
      - If the last window is under 42, return `downgrade(tier)`.
      - If `!dropped`, there are at least 3 windows and the last 3 are all 57 or more, return `upgrade(tier)`.
      - Otherwise return null.
  - **QualityMonitor:**
    - Keep a `windows` array of the last 3 averages and a `dropped` flag.
    - After each 90-frame window, call `nextTier`.
    - On a result:
      - Set `cool = 8` and clear `windows`.
      - Set `dropped = true` when the result is lower than the current tier.
- [ ] **Step 4:** Run `npm test && npm run build`. Expected: PASS. Fix any `tsc` errors from removed fields; there should be none, since nothing reads them.
- [ ] **Step 5:** Commit with `feat: per-tier bloom/exposure profile, phones start on medium, auto quality can step up`.

---

### Task 3: Renderer bloom from profile, grade flash/CA, punch channel

**Files:**
- Modify: `src/effects/PostFX.ts`
- Modify: `src/core/Renderer.ts`
- Modify: `src/game/Game.ts` (debug hook ~l.134)
- Test: `tests/postfx.test.ts` (create)

**Interfaces:**
- Consumes: the Task 2 profile fields `bloomStrength`, `bloomRadius`, `bloomThreshold`, `exposure` and `chromatic`.
- Produces:
  - In `PostFX.ts`:
    - `export interface Punch { flash: number; exposure: number; bloom: number; ca: number; flashColor?: number }`.
    - `export const ZERO_PUNCH: Punch`, with every value 0.
  - `gradeShader.uniforms` gains:
    - `flash: { value: 0 }`
    - `flashColor: { value: new Color(1, 1, 1) }` (import `Color` from three)
    - `ca: { value: 0 }`
  - `export function applyPunch(base: { exposure: number; bloom: number; ca: number }, p: Punch): { exposure: number; bloom: number; ca: number; flash: number }`.
    - It is pure and additive: `exposure = base.exposure + p.exposure`, and the same for `bloom` and `ca`.
  - `Renderer.punch(p: Punch): void` stores the punch. `render()` then applies it:
    - `toneMappingExposure` is always set.
    - Bloom strength, the grade `ca`, `flash` and `flashColor` are applied only when those passes exist.
  - `window.__SF.bloom(strength: number, radius: number, threshold: number)`.

- [ ] **Step 1: Write the failing test** in `tests/postfx.test.ts`:
```ts
import { applyPunch, gradeShader, ZERO_PUNCH } from '../src/effects/PostFX';
it('adds a punch on top of the tier base', () =>
  expect(applyPunch({ exposure: 1, bloom: 0.65, ca: 0.0012 }, { flash: 0.9, exposure: 0.45, bloom: 0.9, ca: 0.005 }))
    .toEqual({ exposure: 1.45, bloom: 1.55, ca: 0.0062, flash: 0.9 }));
it('ZERO_PUNCH returns the base unchanged', () =>
  expect(applyPunch({ exposure: 1.05, bloom: 0, ca: 0 }, ZERO_PUNCH)).toEqual({ exposure: 1.05, bloom: 0, ca: 0, flash: 0 }));
it('exposes flash and CA uniforms and keeps the NaN clamp', () => {
  expect(gradeShader.uniforms).toHaveProperty('flash');
  expect(gradeShader.uniforms).toHaveProperty('ca');
  expect(gradeShader.fragmentShader.match(/== .* \? .* : 0\.0/g)?.length).toBeGreaterThanOrEqual(3);
});
```
  Use `toBeCloseTo` per field if floating-point sums need it.
- [ ] **Step 2:** Run `npx vitest run tests/postfx.test.ts`. Expected: FAIL.
- [ ] **Step 3: Grade shader.**
  - **Chromatic aberration:** add `uniform float ca;`. Inside `if (ca > 0.0)`:
    - `vec2 d = (vUv - 0.5) * ca * dot(vUv - 0.5, vUv - 0.5) * 4.0;`
    - Resample `r` at `vUv + d` and `b` at `vUv - d`.
    - Apply the same NaN check and 0–64 clamp to each resampled channel.
  - **Flash:** after the tint, add `col += flashColor * flash * (0.25 + 0.75 * vig);`.
- [ ] **Step 4: Renderer.**
  - Keep `private bloom: UnrealBloomPass | null` and `private base = { exposure, bloom, ca }`, both taken from the profile.
  - **Exposure:** `applyQuality` sets the exposure from `profile.exposure`, replacing the hard-coded 1.08 / 1.02.
  - **Bloom pass:** `setPresentation` builds it with `new UnrealBloomPass(res, p.bloomStrength, p.bloomRadius, p.bloomThreshold)`. Keep the existing NaN patch.
  - **Grade pass:**
    - Whenever a composer exists, always add the grade pass, so the buffer-swap count stays even.
    - Set `uniforms.amount.value = profile.postFx ? 1 : 0`.
    - Set `uniforms.ca.value = profile.chromatic`.
    - Update the existing MSAA comment to match.
  - **Reset on rebuild:** reset the stored punch to `ZERO_PUNCH` inside `setPresentation`.
  - **render():** run `applyPunch(this.base, this.punchState)` and write the results:
    - `renderer.toneMappingExposure`
    - `bloom.strength`, if the bloom pass exists
    - grade `ca`, `flash` and `flashColor`, if the grade pass exists
- [ ] **Step 5: Debug hook.** In `Game.ts`, next to `post`, add `bloom: (s, r, t) => this.renderer.tuneBloom(s, r, t)`.
  - Add `Renderer.tuneBloom(strength, radius, threshold): void`. It sets the live pass's fields and `base.bloom`.
  - Extend the `__SF` type declaration wherever `window.__SF` is typed (search `__SF` in `src/`).
- [ ] **Step 6:** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 7: Manual check.**
  - Run `npm run dev`, open `/?debug` in the built-in browser and start a level.
  - Run `__SF.post('bloom')`, `('grade')`, `('off')` and `('full')`. Expected: no flicker and no console errors.
  - Switch Quality Low → Medium → High → Low in Settings twice. Expected: no errors, and the image stays stable.
- [ ] **Step 8:** Commit with `feat: profile-driven bloom, grade flash and chromatic aberration, renderer punch channel`.

---

### Task 4: Emissives that bloom and Low-tier tone mapping in custom shaders

**Files:**
- Modify:
  - `src/shadows/ForgeSurface.ts` (FRAG ~l.66–76)
  - `src/effects/Obsidian.ts` (FRAG ~l.26–27)
  - `src/effects/LightBeams.ts` (BEAM_FRAG ~l.41)
  - `src/world/LevelWorld.ts`: lamp head l.242, spot beam colour, exit ring l.208, console icon l.533
  - `src/player/PlayerView.ts` (l.85)
- Test: `tests/shaders.test.ts` (create)

**Interfaces:**
- Produces:
  - `ForgeSurface.ts`, `Obsidian.ts` and `LightBeams.ts` export their fragment shader strings as `FORGE_FRAG`, `OBSIDIAN_FRAG` and `BEAM_FRAG`.
  - No other API changes.

| Location | Change |
|---|---|
| ForgeSurface | `pedge * 1.8` → `2.6`; `sedge * 1.6` → `3.2`; broken `* 1.4` → `2.5`; ring `* 1.5` → `3.0` |
| Obsidian | `warm * fres * 0.6` → `* 1.8` |
| Lamp head | `multiplyScalar(volume.enabled ? 4.0 : 0.12)` |
| Spot beam cone colour | ×3 where the beam material colour is set (find it in `makeLamp` or `sync`) |
| Exit ring `emissiveIntensity` | 1.1 → 2.6 |
| Console icon `emissiveIntensity` | 1.6 → 3.0 |
| Player seam `emissiveIntensity` | 0.85 → 2.2 |
| `trim` | unchanged |

- [ ] **Step 1: Write the failing test** in `tests/shaders.test.ts`. For each of the three exported fragment shaders, assert:
  - it contains `#include <tonemapping_fragment>` and `#include <colorspace_fragment>`;
  - the includes appear after the last `gl_FragColor` assignment, by `lastIndexOf` comparison;
  - `FORGE_FRAG` contains `sedge * 3.2`;
  - `OBSIDIAN_FRAG` contains `fres * 1.8`.
- [ ] **Step 2:** Run `npx vitest run tests/shaders.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Apply the table above, then append the two includes as the last lines of each `main()`.
- [ ] **Step 4:** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 5: Manual check** in `/?debug`, Level 1.
  - On Medium and High, lamp heads, plate edges, obsidian rims (`__SF.forge()`), the exit ring and player seams glow.
  - Floor and trim don't haze. If they do, tune with `__SF.bloom(...)` and report the values; don't change the Task 2 numbers silently.
  - Switch to Low: the plate and obsidian brightness are close to Medium, not darker or clipped.
- [ ] **Step 6:** Commit with `feat: brighter emissives for bloom, tone-map custom shaders on low tier`.

---

### Task 5: Procedural lab environment and rebalanced fill light

**Files:**
- Create: `src/world/LabEnvironment.ts`
- Modify: `src/world/Materials.ts` (`buildEnvMap` l.231)
- Modify: `src/world/LevelWorld.ts` (`applyProfile` l.112, `load` l.144, `ensureEnv` ~l.555)
- Test: `tests/labenv.test.ts` (create)

**Interfaces:**
- Produces:
  - `export const LAB_ENV_PANELS: ReadonlyArray<{ color: number; intensity: number; position: [number, number, number]; size: [number, number] }>`.
  - `export function buildLabEnvScene(): Scene`.
  - `export function hemiIntensity(envMap: boolean): number`, which returns 0.9 with an env map and 1.6 without.
  - `export const ENV_INTENSITY = 0.65`.

**Scene contents:**
- **Gradient sphere:** BackSide, r = 10, a small `ShaderMaterial` gradient.
  - Floor `#05070c`, horizon band `#1a2a3a`, zenith `#0b1220`.
- **Panels:** `MeshBasicMaterial` planes, with the colour multiplied by intensity, all facing the origin.
  - Four cool strips `0x9fdcff` ×6: two on each long side at y = 3, x = ±6, z = ±3, size [8, 0.4].
  - One warm key `0xffc890` ×8, placed along the sun direction at `normalize(-12, 22, 8) * 8`, size [3, 3].
  - One faint accent ring on the floor: a `RingGeometry(3, 3.3)` at y = −2, colour `0x5ce1ff` ×1.5.

- [ ] **Step 1: Write the failing test** in `tests/labenv.test.ts`:
```ts
it('balances fill light against the env map', () => {
  expect(hemiIntensity(true)).toBe(0.9);
  expect(hemiIntensity(false)).toBe(1.6);
  expect(ENV_INTENSITY).toBe(0.65);
});
it('has cool side strips and one warm key matching the sun', () => {
  expect(LAB_ENV_PANELS.filter(p => p.color === 0x9fdcff)).toHaveLength(4);
  const key = LAB_ENV_PANELS.filter(p => p.color === 0xffc890);
  expect(key).toHaveLength(1);
  expect(key[0].position[0]).toBeLessThan(0);
  expect(key[0].position[1]).toBeGreaterThan(0);
});
it('builds a scene without a renderer', () => expect(buildLabEnvScene().children.length).toBeGreaterThanOrEqual(6));
```
- [ ] **Step 2:** Run `npx vitest run tests/labenv.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `LabEnvironment.ts`.**
  - Generate `buildLabEnvScene` from `LAB_ENV_PANELS`, plus the sphere and the ring.
  - In `buildEnvMap`:
    - Replace `new RoomEnvironment()` with `buildLabEnvScene()` and use sigma 0.03.
    - Then traverse the scene and dispose each geometry and material.
    - Remove the `RoomEnvironment` import.
- [ ] **Step 4: Wire it into `LevelWorld`.**
  - Store the hemisphere light as `private hemi: HemisphereLight | null`, created in `load` with `hemiIntensity(this.profile?.envMap ?? true)`.
  - `applyProfile` sets `this.hemi.intensity = hemiIntensity(profile.envMap)` when the hemisphere light exists.
  - Both `environmentIntensity = 0.28` sites become `ENV_INTENSITY`.
- [ ] **Step 5:** Run `npm test && npm run build`. Expected: PASS.
- [ ] **Step 6: Manual check** in `/?debug`.
  - On High, metal and trim show cool strip reflections and a warm highlight, and shadows have more contrast than before.
  - On Low (no env map), the scene is still readable, not too dark.
  - The menu scene still looks right.
- [ ] **Step 7:** Commit with `feat: procedural lab environment map and rebalanced hemisphere fill`.

---

### Task 6: Phase 1 end-to-end verification (no code unless a check fails)

- [ ] **Step 1:** Run `npm test && npm run build`. Expected: all suites pass and the build succeeds.
- [ ] **Step 2: Desktop check.** Run `npm run dev` and open `/?debug` in the built-in browser. Go through the spec's Phase 1 checklist:
  1. No shader errors in the console.
  2. Sparks are visible on forge (`__SF.forge()`) on Low, Medium and High.
  3. `post(...)` modes don't flicker.
  4. Emissives glow without haze.
  5. Low brightness matches Medium.
- [ ] **Step 3: Mobile check.** Use mobile emulation (375×812, which sets coarse pointer) with cleared `localStorage`.
  - The game starts on Medium.
  - `__SF.fps()` stays at 55 or more after 10 s, with 4× CPU throttle if available.
- [ ] **Step 4:** Take screenshots of Level 1 on Low, Medium and High, one of them mid-forge, and attach them to the report for the user.

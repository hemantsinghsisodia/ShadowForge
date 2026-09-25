import { casterBoxes, masksFor, stateMap, staticBoxes, surfaceDef } from '../levels/evaluate';
import type { LevelConfig } from '../levels/LevelData';
import { maskToBoxes } from './math';
import type { SolidBox, SurfaceDef } from './types';

export class ShadowStability {
  value = 1;
  forged = false;

  constructor(
    readonly unstable: boolean,
    readonly decayTime: number,
  ) {}
}

/** Preview masks, frozen solid masks, and the stability of each forge. */
export class ShadowManager {
  readonly states: Record<string, number>;
  readonly defs = new Map<string, SurfaceDef>();
  readonly preview = new Map<string, Uint8Array>();
  readonly solid = new Map<string, Uint8Array>();
  readonly stability = new Map<string, ShadowStability>();
  private visualDirty = true;

  constructor(readonly config: LevelConfig) {
    this.states = stateMap(config, false);
    for (const surface of config.surfaces) {
      const def = surfaceDef(surface);
      this.defs.set(surface.id, def);
      this.preview.set(surface.id, new Uint8Array(def.cols * def.rows));
      this.solid.set(surface.id, new Uint8Array(def.cols * def.rows));
      this.stability.set(surface.id, new ShadowStability(def.unstable, def.decayTime));
    }
    this.recompute();
  }

  setState(id: string, index: number): void {
    this.states[id] = index;
    this.recompute();
  }

  recompute(): void {
    const masks = masksFor(this.config, this.states);
    for (const [id, value] of masks) this.preview.set(id, value.mask);
    this.visualDirty = true;
  }

  /** Freeze the current preview onto a forge. Returns false when nothing is shadowed. */
  forge(surfaceId: string): boolean {
    const preview = this.preview.get(surfaceId);
    const frozen = this.solid.get(surfaceId);
    const stab = this.stability.get(surfaceId);
    if (!preview || !frozen || !stab) return false;
    let any = false;
    for (let i = 0; i < preview.length; i++) if (preview[i]) any = true;
    if (!any) return false;
    frozen.set(preview);
    stab.forged = true;
    stab.value = 1;
    this.visualDirty = true;
    return true;
  }

  /** Drain stability and drop collision when a forge fails. */
  update(dt: number): string[] {
    const collapsed: string[] = [];
    for (const [id, stab] of this.stability) {
      if (!stab.forged) continue;
      const preview = this.preview.get(id);
      const frozen = this.solid.get(id);
      if (!preview || !frozen) continue;
      let total = 0;
      let covered = 0;
      for (let i = 0; i < frozen.length; i++) {
        if (!frozen[i]) continue;
        total++;
        if (preview[i]) covered++;
      }
      const before = stab.value;
      if (stab.unstable) stab.value -= dt / Math.max(0.5, stab.decayTime);
      if (total > 0 && covered < total) stab.value -= dt * 0.7;
      if (stab.value !== before) this.visualDirty = true;
      if (stab.value <= 0) {
        frozen.fill(0);
        stab.value = 0;
        stab.forged = false;
        collapsed.push(id);
        this.visualDirty = true;
      }
    }
    return collapsed;
  }

  collisionBoxes(): SolidBox[] {
    const boxes = [...staticBoxes(this.config), ...casterBoxes(this.config, this.states)];
    for (const [id, frozen] of this.solid) {
      const def = this.defs.get(id);
      const stab = this.stability.get(id);
      if (!def || !stab?.forged) continue;
      boxes.push(...maskToBoxes(def, frozen));
    }
    return boxes;
  }

  takeVisualDirty(): boolean {
    const dirty = this.visualDirty;
    this.visualDirty = false;
    return dirty;
  }
}

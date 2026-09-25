import type { GuideKind } from '../levels/LevelData';

/** One discrete control shared by lamps, spotlights and movable objects. */
export class ManipulationMode {
  active = false;
  id = '';
  kind: 'light' | 'caster' = 'light';
  index = 0;
  saved = 0;
  count = 1;
  label = '';
  prompt = '';
  guide: GuideKind = 'nodes';

  begin(opts: {
    id: string;
    kind: 'light' | 'caster';
    index: number;
    count: number;
    label: string;
    prompt: string;
    guide: GuideKind;
  }): void {
    this.active = true;
    this.id = opts.id;
    this.kind = opts.kind;
    this.index = opts.index;
    this.saved = opts.index;
    this.count = Math.max(1, opts.count);
    this.label = opts.label;
    this.prompt = opts.prompt || 'ADJUST';
    this.guide = opts.guide;
  }

  step(dir: number): number {
    if (!this.active || dir === 0) return this.index;
    const next = Math.max(0, Math.min(this.count - 1, this.index + dir));
    this.index = next;
    return next;
  }

  set(index: number): number {
    this.index = Math.max(0, Math.min(this.count - 1, index));
    return this.index;
  }

  confirm(): void {
    this.active = false;
  }

  cancel(): number {
    this.active = false;
    const saved = this.saved;
    this.index = saved;
    return saved;
  }
}

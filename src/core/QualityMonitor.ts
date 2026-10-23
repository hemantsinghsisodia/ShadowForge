import { nextTier, type AppliedQuality, type QualityMode } from '../settings/Settings';

const ORDER: AppliedQuality[] = ['low', 'medium', 'high'];

/** Steps AUTO quality down when the frame rate stays low, and back up after a sustained smooth run. */
export class QualityMonitor {
  private samples: number[] = [];
  private windows: number[] = [];
  private dropped = false;
  private cool = 0;
  fps = 60;

  update(dt: number, tier: AppliedQuality, mode: QualityMode): AppliedQuality | null {
    const instant = 1 / Math.max(dt, 1 / 240);
    this.fps = this.fps * 0.9 + instant * 0.1;
    this.cool = Math.max(0, this.cool - dt);
    if (mode !== 'auto' || this.cool > 0) return null;
    this.samples.push(instant);
    if (this.samples.length < 90) return null;
    const avg = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    this.samples = [];
    this.windows.push(avg);
    if (this.windows.length > 3) this.windows.shift();
    const next = nextTier(this.windows, tier, mode, this.dropped);
    if (!next) return null;
    this.cool = 8;
    this.windows = [];
    if (ORDER.indexOf(next) < ORDER.indexOf(tier)) this.dropped = true;
    return next;
  }
}

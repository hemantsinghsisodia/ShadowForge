import { downgrade, type AppliedQuality, type QualityMode } from '../settings/Settings';

/** Steps AUTO quality down when the frame rate stays low. */
export class QualityMonitor {
  private samples: number[] = [];
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
    if (avg >= 42) return null;
    const next = downgrade(tier);
    if (!next) return null;
    this.cool = 8;
    return next;
  }
}

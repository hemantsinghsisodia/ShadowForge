export class Haptics {
  enabled = true;
  private last = 0;

  pulse(ms = 14): void {
    if (!this.enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const now = performance.now();
    if (now - this.last < 45) return;
    this.last = now;
    try {
      navigator.vibrate(ms);
    } catch {
      /* some browsers throw if vibration is blocked */
    }
  }
}

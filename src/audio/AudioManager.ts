export type SoundName = 'ui' | 'jump' | 'land' | 'step' | 'snap' | 'forge' | 'collapse' | 'complete' | 'deny' | 'interact';

const CAPTIONS: Partial<Record<SoundName, string>> = {
  forge: 'Shadow forged',
  collapse: 'Shadow collapsed',
  complete: 'Level complete',
  deny: 'Nothing to forge',
  snap: 'Position set',
};

/** Synthesized effects and a slow ambient drone. Starts on the first gesture. */
export class AudioManager {
  sound = true;
  music = true;
  volume = 0.8;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private drones: OscillatorNode[] = [];
  private started = false;
  private stepAt = 0;
  onCaption: ((text: string) => void) | null = null;

  unlock(): void {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.08;
      this.musicGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (!this.started) {
      this.started = true;
      this.startDrone();
    }
  }

  apply(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(this.music ? 0.08 : 0, this.ctx.currentTime, 0.08);
    }
  }

  play(name: SoundName): void {
    const caption = CAPTIONS[name];
    if (caption) this.onCaption?.(caption);
    if (!this.sound || !this.ctx || !this.master) return;
    if (name === 'jump') this.blip(420, 180, 0.09, 'triangle', 0.12);
    else if (name === 'land') this.blip(140, 70, 0.08, 'sine', 0.1);
    else if (name === 'step') this.noise(0.04, 0.03);
    else if (name === 'snap') this.blip(880, 660, 0.05, 'square', 0.04);
    else if (name === 'ui') this.blip(620, 620, 0.04, 'sine', 0.05);
    else if (name === 'interact') this.blip(520, 740, 0.08, 'triangle', 0.06);
    else if (name === 'forge') {
      this.blip(180, 520, 0.45, 'sawtooth', 0.07);
      this.blip(360, 880, 0.5, 'triangle', 0.05);
    } else if (name === 'collapse') this.blip(220, 60, 0.4, 'sawtooth', 0.08);
    else if (name === 'complete') {
      this.blip(523, 523, 0.16, 'triangle', 0.07);
      this.schedule(659, 0.12, 0.18, 'triangle', 0.06);
      this.schedule(784, 0.24, 0.28, 'triangle', 0.06);
    } else if (name === 'deny') this.blip(180, 120, 0.16, 'square', 0.04);
  }

  step(): void {
    const now = performance.now();
    if (now - this.stepAt < 280) return;
    this.stepAt = now;
    this.play('step');
  }

  private startDrone(): void {
    if (!this.ctx || !this.musicGain) return;
    const freqs = [55, 82.5, 110];
    for (const freq of freqs) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = this.ctx.createGain();
      gain.gain.value = freq === 55 ? 0.45 : 0.12;
      osc.connect(gain);
      gain.connect(this.musicGain);
      osc.start();
      this.drones.push(osc);
    }
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain);
    lfoGain.connect(this.drones[0].frequency);
    lfo.start();
    this.drones.push(lfo);
    this.apply();
  }

  private blip(from: number, to: number, dur: number, type: OscillatorType, level: number): void {
    this.schedule(from, 0, dur, type, level, to);
  }

  private schedule(from: number, when: number, dur: number, type: OscillatorType, level: number, to = from): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, level: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const length = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280;
    const gain = this.ctx.createGain();
    gain.gain.value = level;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
  }
}

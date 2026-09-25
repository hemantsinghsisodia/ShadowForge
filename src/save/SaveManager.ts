import { clampSettings, defaultSettings, type Settings } from '../settings/Settings';

export interface SaveFile {
  version: 1;
  unlocked: number;
  completed: boolean[];
  bestTimes: number[];
  resets: number[];
  settings: Settings;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'shadowforge-save-v1';
const LEVELS = 10;

export function emptySave(): SaveFile {
  return {
    version: 1,
    unlocked: 1,
    completed: Array.from({ length: LEVELS }, () => false),
    bestTimes: Array.from({ length: LEVELS }, () => 0),
    resets: Array.from({ length: LEVELS }, () => 0),
    settings: defaultSettings(),
  };
}

export class SaveManager {
  data: SaveFile;

  constructor(private store: KeyValueStore | null = typeof localStorage === 'undefined' ? null : localStorage) {
    this.data = this.read();
  }

  read(): SaveFile {
    if (!this.store) return emptySave();
    try {
      const raw = this.store.getItem(KEY);
      if (!raw) return emptySave();
      return this.parse(raw);
    } catch {
      return emptySave();
    }
  }

  write(): void {
    if (!this.store) return;
    try {
      this.store.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* private mode or a full disk should not crash the session */
    }
  }

  resetProgress(): void {
    const settings = this.data.settings;
    this.data = emptySave();
    this.data.settings = settings;
    this.write();
  }

  markComplete(level: number, time: number, resets: number): void {
    const index = level - 1;
    if (index < 0 || index >= LEVELS) return;
    this.data.completed[index] = true;
    this.data.resets[index] = resets;
    if (this.data.bestTimes[index] <= 0 || time < this.data.bestTimes[index]) this.data.bestTimes[index] = time;
    if (level < LEVELS) this.data.unlocked = Math.max(this.data.unlocked, level + 1);
    else this.data.unlocked = Math.max(this.data.unlocked, LEVELS);
    this.write();
  }

  addReset(level: number): void {
    const index = level - 1;
    if (index < 0 || index >= LEVELS) return;
    this.data.resets[index] += 1;
    this.write();
  }

  updateSettings(settings: Settings): void {
    this.data.settings = clampSettings(settings);
    this.write();
  }

  private parse(raw: string): SaveFile {
    const parsed = JSON.parse(raw) as Partial<SaveFile>;
    if (!parsed || parsed.version !== 1) return emptySave();
    const fresh = emptySave();
    const unlocked = Number(parsed.unlocked);
    fresh.unlocked = Number.isFinite(unlocked) ? Math.min(LEVELS, Math.max(1, Math.floor(unlocked))) : 1;
    fresh.completed = fresh.completed.map((_, i) => parsed.completed?.[i] === true);
    fresh.bestTimes = fresh.bestTimes.map((_, i) => {
      const n = Number(parsed.bestTimes?.[i] ?? 0);
      return Number.isFinite(n) && n > 0 ? n : 0;
    });
    fresh.resets = fresh.resets.map((_, i) => {
      const n = Number(parsed.resets?.[i] ?? 0);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    });
    fresh.settings = clampSettings(parsed.settings);
    const highestCompleted = fresh.completed.reduce((max, done, i) => (done ? i + 1 : max), 0);
    fresh.unlocked = Math.max(fresh.unlocked, Math.min(LEVELS, highestCompleted + 1));
    return fresh;
  }
}

import { describe, expect, it } from 'vitest';
import { SaveManager, type KeyValueStore } from '../src/save/SaveManager';

function memory(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('save file', () => {
  it('starts locked past level 1', () => {
    const save = new SaveManager(memory());
    expect(save.data.unlocked).toBe(1);
    expect(save.data.completed.every((done) => !done)).toBe(true);
  });

  it('records a clear and unlocks the next level', () => {
    const store = memory();
    const save = new SaveManager(store);
    save.markComplete(1, 42, 3);
    const again = new SaveManager(store);
    expect(again.data.completed[0]).toBe(true);
    expect(again.data.bestTimes[0]).toBe(42);
    expect(again.data.resets[0]).toBe(3);
    expect(again.data.unlocked).toBe(2);
    again.markComplete(1, 80, 1);
    expect(again.data.bestTimes[0]).toBe(42);
    again.markComplete(1, 20, 1);
    expect(again.data.bestTimes[0]).toBe(20);
  });

  it('rejects a corrupt payload', () => {
    const store = memory();
    store.setItem('shadowforge-save-v1', '{not json');
    const save = new SaveManager(store);
    expect(save.data.unlocked).toBe(1);
    store.setItem('shadowforge-save-v1', JSON.stringify({ version: 4, unlocked: 9 }));
    expect(new SaveManager(store).data.unlocked).toBe(1);
  });

  it('clamps nonsense settings', () => {
    const store = memory();
    store.setItem(
      'shadowforge-save-v1',
      JSON.stringify({
        version: 1,
        unlocked: 40,
        settings: { quality: 'ultra', volume: 12, cameraSensitivity: 0 },
      }),
    );
    const save = new SaveManager(store);
    expect(save.data.unlocked).toBeLessThanOrEqual(10);
    expect(save.data.settings.quality).toBe('auto');
    expect(save.data.settings.volume).toBeLessThanOrEqual(1);
    expect(save.data.settings.cameraSensitivity).toBeGreaterThanOrEqual(0.4);
  });
});

import type { LevelConfig } from './LevelData';
import level1 from './Level1';
import level2 from './Level2';
import level3 from './Level3';
import level4 from './Level4';
import level5 from './Level5';
import level6 from './Level6';
import level7 from './Level7';
import level8 from './Level8';
import level9 from './Level9';
import level10 from './Level10';

export const LEVELS: LevelConfig[] = [level1, level2, level3, level4, level5, level6, level7, level8, level9, level10];

export function getLevel(id: number): LevelConfig {
  const level = LEVELS.find((entry) => entry.id === id);
  if (!level) throw new Error(`Unknown level ${id}`);
  return level;
}

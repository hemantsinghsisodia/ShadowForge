export type GameStateName =
  | 'MENU'
  | 'LEVEL_SELECT'
  | 'LEVEL_INTRO'
  | 'PLAYING'
  | 'PAUSED'
  | 'SHADOW_TRANSITION'
  | 'LEVEL_COMPLETE'
  | 'GAME_COMPLETE';

export class GameState {
  name: GameStateName = 'MENU';
  private listeners = new Set<(next: GameStateName, prev: GameStateName) => void>();

  set(next: GameStateName): void {
    if (next === this.name) return;
    const prev = this.name;
    this.name = next;
    for (const listener of this.listeners) listener(next, prev);
  }

  onChange(listener: (next: GameStateName, prev: GameStateName) => void): void {
    this.listeners.add(listener);
  }
}

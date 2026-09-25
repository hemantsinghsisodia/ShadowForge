import './ui/styles.css';
import { Game } from './game/Game';

const boot = document.querySelector('#boot') as HTMLElement;
const fill = document.querySelector('#boot-fill') as HTMLElement;
const status = document.querySelector('#boot-status') as HTMLElement;
const nosupport = document.querySelector('#nosupport') as HTMLElement;

fill.style.width = '35%';
status.textContent = 'Lighting the forge…';

function failWebGL(): void {
  boot.hidden = true;
  nosupport.hidden = false;
}

try {
  const canvas = document.querySelector('#game') as HTMLCanvasElement;
  const root = document.querySelector('#ui') as HTMLElement;
  fill.style.width = '70%';
  const game = new Game(canvas, root);
  fill.style.width = '100%';
  status.textContent = 'Ready';
  window.setTimeout(() => {
    boot.hidden = true;
    game.start();
  }, 180);
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'webgl-unavailable') failWebGL();
  else {
    boot.hidden = true;
    const root = document.querySelector('#ui');
    if (root) root.textContent = message || 'SHADOWFORGE failed to start.';
    console.error(error);
  }
}

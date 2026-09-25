import type { Settings } from '../settings/Settings';

export interface LevelCard {
  id: number;
  name: string;
  locked: boolean;
  complete: boolean;
  time: number;
  resets: number;
}

export interface HudState {
  objective: string;
  time: string;
  prompt: string;
  showInteract: boolean;
  manipulating: boolean;
  manipLabel: string;
  manipPrompt: string;
  manipIndex: number;
  manipCount: number;
  bars: { id: string; value: number }[];
}

export interface UiHooks {
  continue: () => void;
  levels: () => void;
  tutorial: () => void;
  settings: () => void;
  menu: () => void;
  startLevel: (id: number) => void;
  begin: () => void;
  resume: () => void;
  restart: () => void;
  next: () => void;
  pause: () => void;
  back: () => void;
  setting: (partial: Partial<Settings>) => void;
  resetProgress: () => void;
  jump: () => void;
  interact: () => void;
  confirm: () => void;
  cancel: () => void;
  slider: (index: number) => void;
}

const TUTORIAL = [
  ['Move', 'Walk with WASD or the left stick. Jump with Space or the jump button.'],
  ['Look', 'Drag the right side of the screen, or click the view and move the mouse.'],
  ['Interact', 'Walk up to a lamp, an object, or a forge console. Press E or Interact.'],
  ['Shape', 'Snap the control. The forge draws the shadow before it is real.'],
  ['Forge', 'At the console, Interact solidifies the shadow. Walk on it, or climb it.'],
  ['Hold', 'Move the light off that shape, or wait on an unstable forge, and it fails.'],
];

export class Ui {
  private captionTimer = 0;
  private readonly slider: HTMLInputElement;

  constructor(
    private root: HTMLElement,
    private hooks: UiHooks,
  ) {
    root.innerHTML = `
      <section class="screen" id="screen-menu" hidden>
        <div class="panel">
          <p class="eyebrow">Experimental optics lab</p>
          <h1>SHADOWFORGE</h1>
          <p class="muted">Shape the darkness. Change the world.</p>
          <div class="stack">
            <button class="primary" data-act="continue">Continue</button>
            <button data-act="levels">Levels</button>
            <button data-act="tutorial">How to play</button>
            <button data-act="settings">Settings</button>
          </div>
        </div>
      </section>
      <section class="screen" id="screen-levels" hidden>
        <div class="panel">
          <p class="eyebrow">Chambers</p>
          <h2>Select a level</h2>
          <div class="levels" id="level-grid"></div>
          <div class="stack"><button data-act="menu">Back</button></div>
        </div>
      </section>
      <section class="screen" id="screen-tutorial" hidden>
        <div class="panel">
          <p class="eyebrow">Briefing</p>
          <h2>How the forge works</h2>
          <div class="steps" id="tutorial-steps"></div>
          <div class="stack"><button class="primary" data-act="menu">Back</button></div>
        </div>
      </section>
      <section class="screen" id="screen-settings" hidden>
        <div class="panel">
          <p class="eyebrow">Bench</p>
          <h2>Settings</h2>
          <div class="settings" id="settings-form"></div>
          <div class="stack">
            <button data-act="reset-progress">Reset progress</button>
            <button class="primary" data-act="back">Back</button>
          </div>
        </div>
      </section>
      <section class="screen" id="screen-intro" hidden>
        <div class="panel">
          <p class="eyebrow" id="intro-kicker"></p>
          <h2 id="intro-name"></h2>
          <p id="intro-blurb" class="muted"></p>
          <p id="intro-objective"></p>
          <div class="stack"><button class="primary" data-act="begin">Begin</button><button data-act="levels">Levels</button></div>
        </div>
      </section>
      <section class="screen" id="screen-pause" hidden>
        <div class="panel">
          <p class="eyebrow">Paused</p>
          <h2>Hold</h2>
          <div class="stack">
            <button class="primary" data-act="resume">Resume</button>
            <button data-act="restart">Restart</button>
            <button data-act="settings">Settings</button>
            <button data-act="menu">Menu</button>
          </div>
        </div>
      </section>
      <section class="screen" id="screen-complete" hidden>
        <div class="panel">
          <p class="eyebrow">Forge stable</p>
          <h2 id="complete-title">Level complete</h2>
          <p id="complete-stats" class="muted"></p>
          <div class="stack">
            <button class="primary" data-act="next">Next</button>
            <button data-act="restart">Retry</button>
            <button data-act="levels">Levels</button>
          </div>
        </div>
      </section>
      <section class="screen" id="screen-victory" hidden>
        <div class="panel">
          <p class="eyebrow">The forge</p>
          <h2>The lab is yours</h2>
          <p class="muted">Every chamber holds. The darkness keeps the shape you gave it.</p>
          <div class="stack"><button class="primary" data-act="levels">Levels</button><button data-act="menu">Menu</button></div>
        </div>
      </section>
      <div id="hud" hidden>
        <div class="hud-top">
          <div class="chip"><strong id="hud-objective"></strong></div>
          <div class="chip"><span id="hud-time">0:00</span></div>
          <button id="pause-btn" data-control data-act="pause" type="button">Pause</button>
        </div>
        <div class="chip bars" id="hud-bars"></div>
        <div class="manip" id="manip" hidden>
          <strong id="manip-label"></strong>
          <p class="muted" id="manip-prompt"></p>
          <input id="manip-slider" data-control type="range" min="0" max="1" step="1" value="0" />
          <div class="stack">
            <button data-control data-act="cancel" type="button">Cancel</button>
            <button class="primary" data-control data-act="confirm" type="button">Confirm</button>
          </div>
        </div>
        <div id="prompt"></div>
        <div class="touch" id="touch" hidden>
          <button data-control data-act="interact" id="btn-interact" type="button" hidden>Use</button>
          <button data-control data-act="jump" id="btn-jump" type="button">Jump</button>
        </div>
      </div>
      <div id="caption" hidden></div>
      <div id="error-banner" hidden></div>
      <div id="rotate"><div><p>ROTATE YOUR DEVICE</p><p class="muted">SHADOWFORGE plays in landscape.</p></div></div>
    `;
    const steps = root.querySelector('#tutorial-steps') as HTMLElement;
    steps.innerHTML = TUTORIAL.map(
      ([title, body], index) =>
        `<div class="step"><div class="glyph">${index + 1}</div><div><strong>${title}</strong><div class="muted">${body}</div></div></div>`,
    ).join('');
    this.slider = root.querySelector('#manip-slider') as HTMLInputElement;
    root.addEventListener('pointerdown', (event) => {
      const target = (event.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!target || (target as HTMLButtonElement).disabled) return;
      event.preventDefault();
      const act = target.dataset.act;
      if (act === 'continue') hooks.continue();
      else if (act === 'levels') hooks.levels();
      else if (act === 'tutorial') hooks.tutorial();
      else if (act === 'settings') hooks.settings();
      else if (act === 'menu') hooks.menu();
      else if (act === 'back') hooks.back();
      else if (act === 'begin') hooks.begin();
      else if (act === 'resume') hooks.resume();
      else if (act === 'restart') hooks.restart();
      else if (act === 'next') hooks.next();
      else if (act === 'pause') hooks.pause();
      else if (act === 'reset-progress') hooks.resetProgress();
      else if (act === 'jump') hooks.jump();
      else if (act === 'interact') hooks.interact();
      else if (act === 'confirm') hooks.confirm();
      else if (act === 'cancel') hooks.cancel();
      else if (act === 'level') hooks.startLevel(Number(target.dataset.level));
    });
    this.slider.addEventListener('input', () => hooks.slider(Number(this.slider.value)));
  }

  show(name: string): void {
    const map: Record<string, string> = {
      menu: 'screen-menu',
      levels: 'screen-levels',
      tutorial: 'screen-tutorial',
      settings: 'screen-settings',
      intro: 'screen-intro',
      pause: 'screen-pause',
      complete: 'screen-complete',
      victory: 'screen-victory',
    };
    for (const id of Object.values(map)) {
      const node = this.root.querySelector(`#${id}`) as HTMLElement;
      node.hidden = id !== map[name];
    }
    const hud = this.root.querySelector('#hud') as HTMLElement;
    hud.hidden = name !== 'play';
  }

  setLevels(cards: LevelCard[]): void {
    const grid = this.root.querySelector('#level-grid') as HTMLElement;
    grid.innerHTML = cards
      .map((card) => {
        const cls = card.locked ? 'locked' : card.complete ? 'done' : '';
        const meta = card.locked ? 'Locked' : card.complete ? `${formatTime(card.time)} · ${card.resets} resets` : 'Open';
        return `<button class="level-card ${cls}" data-control data-act="level" data-level="${card.id}" ${card.locked ? 'disabled' : ''}><strong>${card.id}. ${card.name}</strong><small>${meta}</small></button>`;
      })
      .join('');
  }

  setIntro(level: number, name: string, blurb: string, objective: string): void {
    (this.root.querySelector('#intro-kicker') as HTMLElement).textContent = `Level ${level}`;
    (this.root.querySelector('#intro-name') as HTMLElement).textContent = name;
    (this.root.querySelector('#intro-blurb') as HTMLElement).textContent = blurb;
    (this.root.querySelector('#intro-objective') as HTMLElement).textContent = objective;
  }

  setComplete(title: string, stats: string, last: boolean): void {
    (this.root.querySelector('#complete-title') as HTMLElement).textContent = title;
    (this.root.querySelector('#complete-stats') as HTMLElement).textContent = stats;
    const next = this.root.querySelector('[data-act="next"]') as HTMLButtonElement;
    next.hidden = last;
  }

  setSettings(settings: Settings, live: string): void {
    const form = this.root.querySelector('#settings-form') as HTMLElement;
    form.innerHTML = `
      <label>Quality
        <select data-set="quality">
          ${['auto', 'low', 'medium', 'high'].map((mode) => `<option value="${mode}" ${settings.quality === mode ? 'selected' : ''}>${mode}${mode === 'auto' ? ` · ${live}` : ''}</option>`).join('')}
        </select>
      </label>
      <label class="check"><input data-set="sound" type="checkbox" ${settings.sound ? 'checked' : ''}/> Sound effects</label>
      <label class="check"><input data-set="music" type="checkbox" ${settings.music ? 'checked' : ''}/> Music</label>
      <label>Volume <input data-set="volume" type="range" min="0" max="1" step="0.05" value="${settings.volume}"/></label>
      <label class="check"><input data-set="haptics" type="checkbox" ${settings.haptics ? 'checked' : ''}/> Haptics</label>
      <label class="check"><input data-set="invertY" type="checkbox" ${settings.invertY ? 'checked' : ''}/> Invert look</label>
      <label>Look <input data-set="cameraSensitivity" type="range" min="0.4" max="2" step="0.1" value="${settings.cameraSensitivity}"/></label>
      <label>Move <input data-set="controlSensitivity" type="range" min="0.6" max="1.6" step="0.1" value="${settings.controlSensitivity}"/></label>
    `;
    form.querySelectorAll('[data-set]').forEach((node) => {
      node.addEventListener('change', () => {
        const input = node as HTMLInputElement;
        const key = input.dataset.set as keyof Settings;
        if (input.type === 'checkbox') this.hooks.setting({ [key]: input.checked });
        else if (input.type === 'range') this.hooks.setting({ [key]: Number(input.value) });
        else this.hooks.setting({ [key]: input.value });
      });
    });
  }

  setHud(hud: HudState): void {
    (this.root.querySelector('#hud-objective') as HTMLElement).textContent = hud.objective;
    (this.root.querySelector('#hud-time') as HTMLElement).textContent = hud.time;
    (this.root.querySelector('#prompt') as HTMLElement).textContent = hud.prompt;
    const interact = this.root.querySelector('#btn-interact') as HTMLButtonElement;
    interact.hidden = !hud.showInteract;
    const manip = this.root.querySelector('#manip') as HTMLElement;
    manip.hidden = !hud.manipulating;
    if (hud.manipulating) {
      (this.root.querySelector('#manip-label') as HTMLElement).textContent = hud.manipLabel;
      (this.root.querySelector('#manip-prompt') as HTMLElement).textContent = hud.manipPrompt;
      this.slider.max = String(Math.max(0, hud.manipCount - 1));
      if (Number(this.slider.value) !== hud.manipIndex) this.slider.value = String(hud.manipIndex);
    }
    const bars = this.root.querySelector('#hud-bars') as HTMLElement;
    bars.innerHTML = hud.bars
      .map(
        (bar) =>
          `<div class="bar-row"><span>${bar.id}</span><div class="bar-track"><span style="width:${Math.round(bar.value * 100)}%"></span></div></div>`,
      )
      .join('');
    bars.hidden = hud.bars.length === 0;
  }

  setTouch(on: boolean): void {
    (this.root.querySelector('#touch') as HTMLElement).hidden = !on;
  }

  setRotate(on: boolean): void {
    (this.root.querySelector('#rotate') as HTMLElement).classList.toggle('on', on);
  }

  caption(text: string): void {
    const node = this.root.querySelector('#caption') as HTMLElement;
    node.hidden = false;
    node.textContent = text;
    window.clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => {
      node.hidden = true;
    }, 2200);
  }

  error(text: string): void {
    const node = this.root.querySelector('#error-banner') as HTMLElement;
    node.hidden = false;
    node.textContent = text;
  }
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

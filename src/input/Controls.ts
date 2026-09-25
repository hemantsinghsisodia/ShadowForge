export interface FrameInput {
  moveX: number;
  moveZ: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  interact: boolean;
  confirm: boolean;
  cancel: boolean;
  pause: boolean;
  cycle: number;
  clickX: number;
  clickY: number;
  clicked: boolean;
  pointerLocked: boolean;
}

/** Floating stick. A touch that starts here never becomes a camera drag. */
export class VirtualJoystick {
  active = false;
  private originX = 0;
  private originY = 0;
  private rawX = 0;
  private rawY = 0;
  private smoothX = 0;
  private smoothY = 0;
  readonly knob: HTMLElement;
  readonly base: HTMLElement;

  constructor(parent: HTMLElement) {
    this.base = document.createElement('div');
    this.base.className = 'joystick';
    this.knob = document.createElement('div');
    this.knob.className = 'joystick-knob';
    this.base.append(this.knob);
    parent.append(this.base);
  }

  begin(x: number, y: number): void {
    this.active = true;
    this.originX = x;
    this.originY = y;
    this.rawX = 0;
    this.rawY = 0;
    this.base.style.left = `${x}px`;
    this.base.style.top = `${y}px`;
    this.base.classList.add('on');
    this.placeKnob();
  }

  move(x: number, y: number): void {
    const radius = 54;
    let dx = x - this.originX;
    let dy = y - this.originY;
    const mag = Math.hypot(dx, dy) || 1;
    if (mag > radius) {
      dx = (dx / mag) * radius;
      dy = (dy / mag) * radius;
    }
    const dead = 0.18;
    this.rawX = Math.abs(dx / radius) < dead ? 0 : dx / radius;
    this.rawY = Math.abs(dy / radius) < dead ? 0 : dy / radius;
    this.placeKnob();
  }

  end(): void {
    this.active = false;
    this.rawX = 0;
    this.rawY = 0;
    this.smoothX = 0;
    this.smoothY = 0;
    this.base.classList.remove('on');
  }

  sample(): { x: number; y: number } {
    this.smoothX += (this.rawX - this.smoothX) * 0.45;
    this.smoothY += (this.rawY - this.smoothY) * 0.45;
    return { x: this.smoothX, y: this.smoothY };
  }

  private placeKnob(): void {
    this.knob.style.transform = `translate(${this.rawX * 54}px, ${this.rawY * 54}px)`;
  }
}

/** Turns a horizontal swipe into a single step. */
export class GestureManager {
  private startX = 0;
  private startY = 0;
  private fired = false;
  tracking = false;

  begin(x: number, y: number): void {
    this.tracking = true;
    this.fired = false;
    this.startX = x;
    this.startY = y;
  }

  move(x: number, y: number): number {
    if (!this.tracking || this.fired) return 0;
    const dx = x - this.startX;
    const dy = y - this.startY;
    if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.2) return 0;
    this.fired = true;
    return dx > 0 ? 1 : -1;
  }

  end(): void {
    this.tracking = false;
    this.fired = false;
  }
}

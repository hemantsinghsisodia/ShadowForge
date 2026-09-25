import { GestureManager, VirtualJoystick, type FrameInput } from './Controls';

type Mode = 'play' | 'manipulate';

/**
 * Keyboard, mouse, touch, the floating joystick and right-side camera drag
 * all arrive as one FrameInput. A touch that starts on a control is claimed
 * by that control and never orbits the camera.
 */
export class InputManager {
  private keys = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private cycle = 0;
  private jump = false;
  private interact = false;
  private confirm = false;
  private cancel = false;
  private pause = false;
  private clicked = false;
  private clickX = 0;
  private clickY = 0;
  private pointers = new Map<number, { x: number; y: number; ox: number; oy: number; moved: boolean; role: 'stick' | 'look' | 'ui' | 'swipe' }>();
  private mode: Mode = 'play';
  private lastCycle = 0;
  readonly joystick: VirtualJoystick;
  readonly gestures = new GestureManager();
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly onKeyUp: (event: KeyboardEvent) => void;
  private readonly onPointerDown: (event: PointerEvent) => void;
  private readonly onPointerMove: (event: PointerEvent) => void;
  private readonly onPointerUp: (event: PointerEvent) => void;
  private readonly onWheel: (event: WheelEvent) => void;
  private readonly onContext: (event: Event) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    parent: HTMLElement,
  ) {
    this.joystick = new VirtualJoystick(parent);
    this.onKeyDown = (event) => this.keyDown(event);
    this.onKeyUp = (event) => this.keys.delete(event.code);
    this.onPointerDown = (event) => this.pointerDown(event);
    this.onPointerMove = (event) => this.pointerMove(event);
    this.onPointerUp = (event) => this.pointerUp(event);
    this.onWheel = (event) => {
      if (this.mode !== 'manipulate') return;
      this.cycle += event.deltaY > 0 ? 1 : -1;
      event.preventDefault();
    };
    this.onContext = (event) => event.preventDefault();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContext);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
  }

  /** HUD buttons call this. The pointer never reaches the camera. */
  press(action: 'jump' | 'interact' | 'confirm' | 'cancel' | 'pause'): void {
    if (action === 'jump') this.jump = true;
    if (action === 'interact') this.interact = true;
    if (action === 'confirm') this.confirm = true;
    if (action === 'cancel') this.cancel = true;
    if (action === 'pause') this.pause = true;
  }

  nudge(dir: number): void {
    this.cycle += dir;
  }

  sample(): FrameInput {
    const now = performance.now();
    let moveX = 0;
    let moveZ = 0;
    if (this.mode === 'play') {
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveX -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveX += 1;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveZ += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveZ -= 1;
      const stick = this.joystick.sample();
      moveX += stick.x;
      moveZ += -stick.y;
    } else if (now - this.lastCycle > 150) {
      let dir = 0;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dir -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dir += 1;
      if (dir !== 0) {
        this.cycle += dir;
        this.lastCycle = now;
      }
    }
    const frame: FrameInput = {
      moveX,
      moveZ,
      lookX: this.lookX,
      lookY: this.lookY,
      jump: this.jump || this.fresh('Space'),
      interact: this.interact || this.fresh('KeyE') || this.fresh('Enter'),
      confirm: this.confirm,
      cancel: this.cancel,
      pause: this.pause,
      cycle: this.cycle,
      clickX: this.clickX,
      clickY: this.clickY,
      clicked: this.clicked,
      pointerLocked: document.pointerLockElement === this.canvas,
    };
    if (this.mode === 'manipulate' && (this.fresh('KeyE') || this.fresh('Enter'))) frame.confirm = true;
    if (this.fresh('Escape')) {
      if (this.mode === 'manipulate') frame.cancel = true;
      else frame.pause = true;
    }
    this.lookX = 0;
    this.lookY = 0;
    this.cycle = 0;
    this.jump = false;
    this.interact = false;
    this.confirm = false;
    this.cancel = false;
    this.pause = false;
    this.clicked = false;
    this.edges.clear();
    return frame;
  }

  private edges = new Set<string>();

  private fresh(code: string): boolean {
    return this.edges.has(code);
  }

  private keyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    this.keys.add(event.code);
    this.edges.add(event.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  }

  private claimed(event: PointerEvent): boolean {
    const target = event.target as Element | null;
    return !!target?.closest('[data-control]');
  }

  private pointerDown(event: PointerEvent): void {
    if (this.claimed(event)) {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, ox: event.clientX, oy: event.clientY, moved: false, role: 'ui' });
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    const localX = x - rect.left;
    if (event.pointerType === 'mouse' && event.button === 0 && this.mode === 'play') {
      if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock();
    }
    if (event.pointerType === 'mouse' && document.pointerLockElement === this.canvas) {
      this.pointers.set(event.pointerId, { x, y, ox: x, oy: y, moved: false, role: 'look' });
      return;
    }
    const leftZone = localX < rect.width * 0.46;
    if (event.pointerType !== 'mouse' && leftZone && !this.joystick.active && this.mode === 'play') {
      this.joystick.begin(x, y);
      this.pointers.set(event.pointerId, { x, y, ox: x, oy: y, moved: false, role: 'stick' });
      return;
    }
    if (this.mode === 'manipulate' && event.pointerType !== 'mouse') {
      this.gestures.begin(x, y);
      this.pointers.set(event.pointerId, { x, y, ox: x, oy: y, moved: false, role: 'swipe' });
      return;
    }
    this.pointers.set(event.pointerId, { x, y, ox: x, oy: y, moved: false, role: 'look' });
  }

  private pointerMove(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer || pointer.role === 'ui') return;
    if (pointer.role === 'stick') {
      this.joystick.move(event.clientX, event.clientY);
      return;
    }
    if (pointer.role === 'swipe') {
      this.cycle += this.gestures.move(event.clientX, event.clientY);
      return;
    }
    const locked = document.pointerLockElement === this.canvas;
    const dx = locked ? event.movementX : event.clientX - pointer.x;
    const dy = locked ? event.movementY : event.clientY - pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) pointer.moved = true;
    if (!locked) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }
    if (event.pointerType === 'mouse' && !locked && event.buttons === 0) return;
    this.lookX += dx;
    this.lookY += dy;
  }

  private pointerUp(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (!pointer) return;
    if (pointer.role === 'stick') this.joystick.end();
    if (pointer.role === 'swipe') this.gestures.end();
    if (pointer.role === 'look' && !pointer.moved) {
      const locked = document.pointerLockElement === this.canvas;
      if (locked) {
        this.clickX = 0;
        this.clickY = 0;
        this.clicked = true;
      } else if (event.pointerType === 'mouse') {
        const rect = this.canvas.getBoundingClientRect();
        this.clickX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.clickY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.clicked = true;
      }
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContext);
  }
}

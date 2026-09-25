import { PerspectiveCamera, Vector3 } from 'three';
import type { CharacterBody } from '../physics/CharacterBody';
import { raycastBoxes } from '../shadows/math';
import type { SolidBox } from '../shadows/types';

const target = new Vector3();
const desired = new Vector3();

/** Third-person orbit. Pulls in when a collision box sits between the camera and the robot. */
export class CameraRig {
  readonly camera = new PerspectiveCamera(58, 1, 0.08, 180);
  yaw = 0;
  pitch = 0.42;
  distance = 6.2;
  sensitivity = 1;
  invertY = false;
  shake = 0;
  private focus = new Vector3();
  private override: { x: number; y: number; z: number; tx: number; ty: number; tz: number } | null = null;

  constructor() {
    this.camera.position.set(0, 3, 8);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  look(dx: number, dy: number): void {
    const sense = 0.0026 * this.sensitivity;
    this.yaw -= dx * sense;
    const ySign = this.invertY ? -1 : 1;
    this.pitch = Math.max(0.08, Math.min(1.15, this.pitch + dy * sense * ySign));
  }

  wish(moveX: number, moveZ: number, control: number): { x: number; z: number } {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);
    return {
      x: (moveZ * fx + moveX * rx) * control,
      z: (moveZ * fz + moveX * rz) * control,
    };
  }

  frame(x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
    this.override = { x, y, z, tx, ty, tz };
  }

  clearFrame(): void {
    this.override = null;
  }

  update(dt: number, body: CharacterBody, boxes: SolidBox[]): void {
    this.focus.set(body.x, body.y + 1.15, body.z);
    const lean = Math.cos(this.pitch);
    desired.set(
      this.focus.x - Math.sin(this.yaw) * this.distance * lean,
      this.focus.y + Math.sin(this.pitch) * this.distance * 0.85,
      this.focus.z - Math.cos(this.yaw) * this.distance * lean,
    );
    if (this.override) {
      desired.set(this.override.x, this.override.y, this.override.z);
      this.focus.set(this.override.tx, this.override.ty, this.override.tz);
    }
    const ox = this.focus.x;
    const oy = this.focus.y;
    const oz = this.focus.z;
    let dx = desired.x - ox;
    let dy = desired.y - oy;
    let dz = desired.z - oz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    const hit = raycastBoxes(ox, oy, oz, dx, dy, dz, len, boxes);
    const dist = Math.max(0.8, hit - 0.35);
    target.set(ox + dx * dist, oy + dy * dist, oz + dz * dist);
    const k = 1 - Math.exp(-dt * 8);
    this.camera.position.lerp(target, this.override ? Math.min(1, k * 1.4) : k);
    this.shake = Math.max(0, this.shake - dt);
    if (this.shake > 0) {
      this.camera.position.x += Math.sin(performance.now() * 0.05) * this.shake * 0.18;
      this.camera.position.y += Math.cos(performance.now() * 0.07) * this.shake * 0.12;
    }
    this.camera.lookAt(this.focus);
  }
}

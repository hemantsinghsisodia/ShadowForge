import type { SolidBox } from '../shadows/types';

export const GRAVITY = 22;
export const JUMP_SPEED = 7.1;
export const MOVE_SPEED = 4.55;
export const STEP_UP = 0.46;
export const BODY_RADIUS = 0.28;
export const BODY_HEIGHT = 1.15;
const SKIN = 0.02;

export class CharacterBody {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  radius = BODY_RADIUS;
  height = BODY_HEIGHT;
  grounded = false;
  coyote = 0;
  jumpBuffer = 0;
  climbing = false;
  facing = 0;

  step(dt: number, wishX: number, wishZ: number, jump: boolean, boxes: SolidBox[]): void {
    const frame = Math.min(Math.max(dt, 0), 0.05);
    const wishMag = Math.hypot(wishX, wishZ);
    if (wishMag > 1) {
      wishX /= wishMag;
      wishZ /= wishMag;
    }
    if (jump) this.jumpBuffer = 0.14;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - frame);

    const speed = MOVE_SPEED;
    this.vx = wishX * speed;
    this.vz = wishZ * speed;

    this.moveHorizontal(this.vx * frame, 0, boxes);
    this.moveHorizontal(0, this.vz * frame, boxes);

    const climbBox = this.findClimb(boxes);
    const into = climbBox ? -(climbBox.nx * wishX + climbBox.nz * wishZ) : 0;
    this.climbing = false;

    if (climbBox && this.jumpBuffer > 0 && into < 0.2) {
      this.vy = JUMP_SPEED * 0.9;
      this.vx += climbBox.nx * 3.2;
      this.vz += climbBox.nz * 3.2;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
    } else if (climbBox && into > 0.25) {
      this.climbing = true;
      this.vy = 2.7;
      this.grounded = false;
      this.coyote = 0;
      if (this.y >= climbBox.maxY - 0.2) {
        this.x -= climbBox.nx * (this.radius + 0.7);
        this.z -= climbBox.nz * (this.radius + 0.7);
        this.y = climbBox.maxY + 0.02;
        this.vy = 0.4;
        this.climbing = false;
      }
    } else {
      this.vy -= GRAVITY * frame;
      if (this.vy < -16) this.vy = -16;
      if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
        this.vy = JUMP_SPEED;
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuffer = 0;
      }
    }

    const yBefore = this.y;
    this.y += this.vy * frame;
    this.resolveVertical(boxes, yBefore);

    if (this.grounded) this.coyote = 0.12;
    else if (!this.climbing) this.coyote = Math.max(0, this.coyote - frame);

    const planar = Math.hypot(wishX, wishZ);
    if (planar > 0.2) this.facing = Math.atan2(wishX, wishZ);
  }

  private overlaps(x: number, y: number, z: number, boxes: SolidBox[]): SolidBox | null {
    const minX = x - this.radius;
    const maxX = x + this.radius;
    const minY = y + SKIN;
    const maxY = y + this.height;
    const minZ = z - this.radius;
    const maxZ = z + this.radius;
    for (const box of boxes) {
      if (maxX <= box.minX || minX >= box.maxX) continue;
      if (maxY <= box.minY || minY >= box.maxY) continue;
      if (maxZ <= box.minZ || minZ >= box.maxZ) continue;
      return box;
    }
    return null;
  }

  private moveHorizontal(dx: number, dz: number, boxes: SolidBox[]): void {
    if (dx === 0 && dz === 0) return;
    const prevX = this.x;
    const prevZ = this.z;
    this.x += dx;
    this.z += dz;
    if (!this.overlaps(this.x, this.y, this.z, boxes)) return;
    if (this.grounded || this.coyote > 0) {
      const raised = this.y + STEP_UP;
      if (!this.overlaps(this.x, raised, this.z, boxes)) {
        this.y = raised;
        return;
      }
    }
    this.x = prevX;
    this.z = prevZ;
  }

  private xzOverlaps(box: SolidBox): boolean {
    if (this.x + this.radius <= box.minX || this.x - this.radius >= box.maxX) return false;
    if (this.z + this.radius <= box.minZ || this.z - this.radius >= box.maxZ) return false;
    return true;
  }

  /** Land on the highest surface the feet crossed. Ignore tall faces beside the body. */
  private resolveVertical(boxes: SolidBox[], yBefore: number): void {
    if (this.vy > 0) {
      for (const box of boxes) {
        if (!this.xzOverlaps(box)) continue;
        const headBefore = yBefore + this.height;
        const head = this.y + this.height;
        if (headBefore <= box.minY + 0.001 && head >= box.minY) {
          this.y = box.minY - this.height - 0.001;
          this.vy = 0;
          break;
        }
      }
      this.grounded = false;
      return;
    }
    let support = Number.NEGATIVE_INFINITY;
    for (const box of boxes) {
      if (!this.xzOverlaps(box)) continue;
      if (yBefore + 0.04 >= box.maxY && this.y <= box.maxY + 0.001 && box.maxY > support) {
        support = box.maxY;
      }
    }
    if (support > Number.NEGATIVE_INFINITY) {
      this.y = support;
      this.vy = 0;
      this.grounded = true;
      return;
    }
    this.grounded = false;
  }

  private findClimb(boxes: SolidBox[]): SolidBox | null {
    const pad = 0.16;
    let best: SolidBox | null = null;
    let bestTop = -Infinity;
    for (const box of boxes) {
      if (!box.climbable) continue;
      if (this.x + this.radius + pad <= box.minX || this.x - this.radius - pad >= box.maxX) continue;
      if (this.z + this.radius + pad <= box.minZ || this.z - this.radius - pad >= box.maxZ) continue;
      if (this.y + this.height <= box.minY + 0.05 || this.y >= box.maxY - 0.02) continue;
      if (box.maxY > bestTop) {
        best = box;
        bestTop = box.maxY;
      }
    }
    return best;
  }
}

import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import type { CharacterBody } from '../physics/CharacterBody';

/** A small robot built from primitives, animated from the kinematic body. */
export class PlayerView {
  readonly group = new Group();
  private readonly torso: Mesh;
  private readonly head: Mesh;
  private readonly visor: Mesh;
  private readonly armL: Group;
  private readonly armR: Group;
  private readonly legL: Group;
  private readonly legR: Group;
  private phase = 0;
  private interact = 0;

  constructor() {
    const metal = new MeshStandardMaterial({ color: 0x8d97a8, metalness: 0.72, roughness: 0.32 });
    const dark = new MeshStandardMaterial({ color: 0x2a3140, metalness: 0.5, roughness: 0.45 });
    const glow = new MeshStandardMaterial({ color: 0x9af6ff, emissive: 0x39e7ff, emissiveIntensity: 1.6, roughness: 0.2 });
    this.torso = new Mesh(new BoxGeometry(0.38, 0.42, 0.22), metal);
    this.torso.position.y = 0.72;
    this.torso.castShadow = true;
    this.head = new Mesh(new BoxGeometry(0.28, 0.22, 0.22), metal);
    this.head.position.y = 1.02;
    this.visor = new Mesh(new BoxGeometry(0.2, 0.06, 0.04), glow);
    this.visor.position.set(0, 1.02, 0.12);
    this.armL = this.limb(0.08, 0.36, dark, -0.26, 0.78);
    this.armR = this.limb(0.08, 0.36, dark, 0.26, 0.78);
    this.legL = this.limb(0.1, 0.4, dark, -0.1, 0.4);
    this.legR = this.limb(0.1, 0.4, dark, 0.1, 0.4);
    this.group.add(this.torso, this.head, this.visor, this.armL, this.armR, this.legL, this.legR);
  }

  pulseInteract(): void {
    this.interact = 0.35;
  }

  update(dt: number, body: CharacterBody): void {
    this.group.position.set(body.x, body.y, body.z);
    this.group.rotation.y = body.facing;
    const speed = Math.hypot(body.vx, body.vz);
    if (body.grounded && speed > 0.4) this.phase += dt * speed * 2.4;
    const swing = body.grounded ? Math.sin(this.phase) * Math.min(0.8, speed * 0.14) : body.vy > 0 ? -0.5 : 0.35;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = body.climbing ? -2.4 : -swing * 0.7;
    this.armR.rotation.x = body.climbing ? -2.4 : swing * 0.7;
    const bob = body.grounded ? Math.abs(Math.sin(this.phase)) * Math.min(0.04, speed * 0.01) : 0;
    this.torso.position.y = 0.72 + bob;
    this.head.position.y = 1.02 + bob;
    this.visor.position.y = 1.02 + bob;
    this.interact = Math.max(0, this.interact - dt);
    this.torso.rotation.x = this.interact > 0 ? 0.35 : body.climbing ? 0.2 : 0;
    this.group.position.y = body.y + (body.grounded ? 0 : Math.min(0.05, Math.abs(body.vy) * 0.004));
  }

  private limb(w: number, h: number, material: MeshStandardMaterial, x: number, y: number): Group {
    const pivot = new Group();
    pivot.position.set(x, y, 0);
    const mesh = new Mesh(new BoxGeometry(w, h, w), material);
    mesh.position.y = -h / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }
}

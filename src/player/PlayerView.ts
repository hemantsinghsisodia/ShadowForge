import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
} from 'three';
import type { CharacterBody } from '../physics/CharacterBody';

/** A small robot built from primitives, animated from the kinematic body. */
export class PlayerView {
  readonly group = new Group();
  private readonly torso: Mesh;
  private readonly head: Mesh;
  private readonly visor: Mesh;
  private readonly core: Mesh;
  private readonly antenna: Group;
  private readonly armL: Group;
  private readonly armR: Group;
  private readonly legL: Group;
  private readonly legR: Group;
  private readonly lamp: PointLight;
  private phase = 0;
  private interact = 0;

  constructor() {
    const metal = new MeshStandardMaterial({ color: 0x5e6b7e, metalness: 0.62, roughness: 0.42 });
    const dark = new MeshStandardMaterial({ color: 0x2c3544, metalness: 0.55, roughness: 0.45 });
    const glow = new MeshStandardMaterial({ color: 0x9af6ff, emissive: 0x39e7ff, emissiveIntensity: 1.15, roughness: 0.25 });
    this.torso = new Mesh(new CylinderGeometry(0.16, 0.2, 0.42, 8), metal);
    this.torso.position.y = 0.72;
    this.torso.castShadow = true;
    this.core = new Mesh(new SphereGeometry(0.07, 10, 8), glow);
    this.core.position.set(0, 0.72, 0.16);
    this.head = new Mesh(new SphereGeometry(0.14, 12, 10), metal);
    this.head.scale.set(1, 0.86, 1);
    this.head.position.y = 1.04;
    this.head.castShadow = true;
    this.visor = new Mesh(new BoxGeometry(0.16, 0.045, 0.04), glow);
    this.visor.position.set(0, 1.04, 0.12);
    this.antenna = new Group();
    const mast = new Mesh(new CylinderGeometry(0.015, 0.015, 0.22, 6), dark);
    mast.position.y = 0.12;
    const tip = new Mesh(new SphereGeometry(0.035, 8, 8), glow);
    tip.position.y = 0.24;
    this.antenna.add(mast, tip);
    this.antenna.position.y = 1.16;
    this.armL = this.limb(0.05, 0.34, dark, -0.24, 0.78);
    this.armR = this.limb(0.05, 0.34, dark, 0.24, 0.78);
    this.legL = this.limb(0.055, 0.38, dark, -0.09, 0.4);
    this.legR = this.limb(0.055, 0.38, dark, 0.09, 0.4);
    this.lamp = new PointLight(0xffe2c0, 0, 6, 2);
    this.lamp.position.y = 0.35;
    this.group.add(
      this.torso,
      this.core,
      this.head,
      this.visor,
      this.antenna,
      this.armL,
      this.armR,
      this.legL,
      this.legR,
      this.lamp,
    );
  }

  setLamp(on: boolean): void {
    this.lamp.intensity = on ? 12 : 0;
    this.lamp.visible = on;
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
    this.core.position.y = 0.72 + bob;
    this.head.position.y = 1.04 + bob;
    this.visor.position.y = 1.04 + bob;
    this.antenna.position.y = 1.18 + bob;
    this.interact = Math.max(0, this.interact - dt);
    this.torso.rotation.x = this.interact > 0 ? 0.35 : body.climbing ? 0.2 : 0;
    this.group.position.y = body.y + (body.grounded ? 0 : Math.min(0.05, Math.abs(body.vy) * 0.004));
  }

  private limb(radius: number, h: number, material: MeshStandardMaterial, x: number, y: number): Group {
    const pivot = new Group();
    pivot.position.set(x, y, 0);
    const mesh = new Mesh(new CylinderGeometry(radius, radius * 0.85, h, 6), material);
    mesh.position.y = -h / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }
}

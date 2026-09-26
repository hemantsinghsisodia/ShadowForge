import {
  CanvasTexture,
  CapsuleGeometry,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type AnimationAction,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CharacterBody } from '../physics/CharacterBody';
import { loadHumanModel, type HumanClip, type HumanModel } from './HumanModel';

/** Real-size suit, scaled so the figure matches the 1.15 m collision body. */
const SUIT_SCALE = 0.66;

function weaveMap(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const n = (x + y) % 2 === 0 ? 214 : 196;
      ctx.fillStyle = `rgb(${n},${n},${n + 6})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.repeat.set(3, 3);
  return texture;
}

/** A suited figure built from primitives and posed from the kinematic body. */
export class PlayerView {
  readonly group = new Group();
  private readonly rig = new Group();
  private readonly pelvis: Group;
  private readonly torso: Group;
  private readonly shoulderL: Group;
  private readonly shoulderR: Group;
  private readonly elbowL: Group;
  private readonly elbowR: Group;
  private readonly hipL: Group;
  private readonly hipR: Group;
  private readonly kneeL: Group;
  private readonly kneeR: Group;
  private readonly lamp: PointLight;
  private phase = 0;
  private time = 0;
  private interact = 0;
  private human: HumanModel | null = null;
  private currentAction: AnimationAction | null = null;
  private humanInteract = false;
  private interactPulse = false;
  private jumpPhase: 'up' | 'air' | 'land' | null = null;
  private landLeft = 0;
  private wasGrounded = true;
  private readonly armLiftL = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -1.15);
  private readonly armLiftR = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.15);

  constructor() {
    const cloth = new MeshStandardMaterial({
      map: weaveMap(),
      color: 0x243040,
      roughness: 0.82,
      metalness: 0.08,
    });
    const plate = new MeshStandardMaterial({ color: 0x8b97a8, metalness: 0.62, roughness: 0.32 });
    const plateLight = new MeshStandardMaterial({ color: 0xd7dee8, metalness: 0.48, roughness: 0.38 });
    const seam = new MeshStandardMaterial({
      color: 0x8ef6ff,
      emissive: 0x1a7f96,
      emissiveIntensity: 0.85,
      roughness: 0.4,
    });
    const visor = new MeshStandardMaterial({ color: 0x101820, metalness: 0.92, roughness: 0.08 });

    this.rig.scale.setScalar(SUIT_SCALE);
    this.pelvis = new Group();
    this.pelvis.position.y = 0.96;
    this.torso = new Group();
    this.pelvis.add(this.torso);

    const jacket = new Mesh(new CapsuleGeometry(0.15, 0.34, 6, 12), cloth);
    jacket.position.y = 0.32;
    jacket.castShadow = true;
    this.torso.add(jacket);
    this.torso.add(this.plateMesh(0.26, 0.32, 0.06, plate, 0, 0.34, 0.13));
    this.torso.add(this.plateMesh(0.22, 0.28, 0.05, plate, 0, 0.32, -0.14));
    this.torso.add(this.plateMesh(0.2, 0.06, 0.16, plateLight, 0, 0.52, 0));
    this.torso.add(this.plateMesh(0.16, 0.22, 0.08, plate, 0, 0.28, -0.18));
    this.torso.add(this.seamMesh(seam, 0.012, 0.16, 0.012, 0, 0.3, -0.2));
    const buckle = this.seamMesh(seam, 0.06, 0.035, 0.02, 0, 0.08, 0.14);
    this.torso.add(buckle);
    this.torso.add(this.plateMesh(0.22, 0.04, 0.16, plateLight, 0, 0.06, 0));

    const pauldronL = this.plateMesh(0.12, 0.08, 0.12, plateLight, -0.2, 0.5, 0);
    const pauldronR = this.plateMesh(0.12, 0.08, 0.12, plateLight, 0.2, 0.5, 0);
    this.torso.add(pauldronL, pauldronR);

    const neck = new Mesh(new CapsuleGeometry(0.05, 0.04, 4, 8), cloth);
    neck.position.y = 0.58;
    neck.castShadow = true;
    this.torso.add(neck);
    const collar = new Mesh(new CapsuleGeometry(0.075, 0.02, 4, 8), plate);
    collar.position.y = 0.54;
    collar.castShadow = true;
    this.torso.add(collar);

    const helmet = new Mesh(new SphereGeometry(0.125, 20, 16), plate);
    helmet.scale.set(1, 1.08, 1.06);
    helmet.position.y = 0.74;
    helmet.castShadow = true;
    const glass = new Mesh(new SphereGeometry(0.078, 16, 12), visor);
    glass.scale.set(1.35, 0.55, 0.42);
    glass.position.set(0, 0.73, 0.07);
    const ear = new Mesh(new SphereGeometry(0.028, 8, 8), seam);
    ear.position.set(0.12, 0.74, 0.02);
    this.torso.add(helmet, glass, ear);

    this.shoulderL = this.pivot(-0.22, 0.48);
    this.shoulderR = this.pivot(0.22, 0.48);
    this.elbowL = this.pivot(0, -0.3);
    this.elbowR = this.pivot(0, -0.3);
    const glove = new MeshStandardMaterial({ color: 0x1c2633, roughness: 0.7, metalness: 0.15 });
    const bootMat = new MeshStandardMaterial({ color: 0x1a222e, roughness: 0.62, metalness: 0.25 });
    const soleMat = new MeshStandardMaterial({ color: 0xc5ced8, roughness: 0.45, metalness: 0.35 });
    this.shoulderL.add(this.hanging(new CapsuleGeometry(0.045, 0.2, 4, 8), cloth, 0.045, 0.2));
    this.shoulderL.add(this.seamMesh(seam, 0.01, 0.16, 0.01, 0.03, -0.16, 0.02));
    this.elbowL.add(this.hanging(new CapsuleGeometry(0.038, 0.16, 4, 8), cloth, 0.038, 0.16));
    this.elbowL.add(this.plateMesh(0.07, 0.1, 0.05, plate, 0, -0.1, 0.02));
    this.elbowL.add(this.hand(glove, -0.24));
    this.shoulderR.add(this.hanging(new CapsuleGeometry(0.045, 0.2, 4, 8), cloth, 0.045, 0.2));
    this.shoulderR.add(this.seamMesh(seam, 0.01, 0.16, 0.01, -0.03, -0.16, 0.02));
    this.elbowR.add(this.hanging(new CapsuleGeometry(0.038, 0.16, 4, 8), cloth, 0.038, 0.16));
    this.elbowR.add(this.plateMesh(0.07, 0.1, 0.05, plate, 0, -0.1, 0.02));
    this.elbowR.add(this.hand(glove, -0.24));
    this.shoulderL.add(this.elbowL);
    this.shoulderR.add(this.elbowR);
    this.torso.add(this.shoulderL, this.shoulderR);

    this.hipL = this.pivot(-0.09, 0);
    this.hipR = this.pivot(0.09, 0);
    this.kneeL = this.pivot(0, -0.44);
    this.kneeR = this.pivot(0, -0.44);
    this.hipL.add(this.hanging(new CapsuleGeometry(0.07, 0.28, 4, 8), cloth, 0.07, 0.28));
    this.hipL.add(this.seamMesh(seam, 0.012, 0.2, 0.012, -0.04, -0.22, 0.02));
    this.kneeL.add(this.hanging(new CapsuleGeometry(0.052, 0.26, 4, 8), cloth, 0.052, 0.26));
    this.kneeL.add(this.plateMesh(0.09, 0.08, 0.04, plate, 0, -0.06, 0.04));
    this.kneeL.add(this.boot(bootMat, soleMat, seam));
    this.hipR.add(this.hanging(new CapsuleGeometry(0.07, 0.28, 4, 8), cloth, 0.07, 0.28));
    this.hipR.add(this.seamMesh(seam, 0.012, 0.2, 0.012, 0.04, -0.22, 0.02));
    this.kneeR.add(this.hanging(new CapsuleGeometry(0.052, 0.26, 4, 8), cloth, 0.052, 0.26));
    this.kneeR.add(this.plateMesh(0.09, 0.08, 0.04, plate, 0, -0.06, 0.04));
    this.kneeR.add(this.boot(bootMat, soleMat, seam));
    this.hipL.add(this.kneeL);
    this.hipR.add(this.kneeR);
    this.pelvis.add(this.hipL, this.hipR);

    this.rig.add(this.pelvis);
    this.lamp = new PointLight(0xffe2c0, 0, 6, 2);
    this.lamp.position.y = 0.35;
    this.group.add(this.rig, this.lamp);
    void loadHumanModel().then((human) => {
      if (!human) return;
      this.human = human;
      this.rig.visible = false;
      this.group.add(human.object);
      human.mixer.addEventListener('finished', (event) => {
        const action = (event as { action?: AnimationAction }).action;
        if (action && action === human.action('interact')) this.humanInteract = false;
      });
    });
  }

  setLamp(on: boolean): void {
    this.lamp.intensity = on ? 12 : 0;
    this.lamp.visible = on;
  }

  pulseInteract(): void {
    this.interact = 0.35;
    this.humanInteract = true;
    this.interactPulse = true;
  }

  update(dt: number, body: CharacterBody): void {
    this.group.position.set(body.x, body.y, body.z);
    this.group.rotation.y = body.facing;
    this.time += dt;
    const speed = Math.hypot(body.vx, body.vz);
    if (this.human) {
      this.updateHuman(dt, body, speed);
      return;
    }
    const moving = body.grounded && speed > 0.35;
    if (moving) this.phase += dt * Math.min(speed, 6) * 2.1;
    this.interact = Math.max(0, this.interact - dt);

    const breath = Math.sin(this.time * 1.7);
    const stride = Math.sin(this.phase);
    const swing = moving ? Math.min(0.62, speed * 0.13) : 0;
    let hipL = 0;
    let hipR = 0;
    let kneeL = 0.08;
    let kneeR = 0.08;
    let armL = 0.08;
    let armR = 0.08;
    let elbowL = -0.28;
    let elbowR = -0.28;
    let lean = 0;
    let twist = 0;
    let hipDrop = 0.96 + breath * 0.01;

    if (moving) {
      hipL = stride * swing;
      hipR = -stride * swing;
      kneeL = 0.12 + Math.max(0, stride) * 1.2;
      kneeR = 0.12 + Math.max(0, -stride) * 1.2;
      armL = -stride * swing * 0.9;
      armR = stride * swing * 0.9;
      elbowL = -0.35 - Math.abs(stride) * 0.2;
      elbowR = -0.35 - Math.abs(stride) * 0.2;
      twist = -stride * 0.07;
      lean = 0.06;
      hipDrop = 0.96 + Math.abs(Math.cos(this.phase)) * Math.min(0.035, speed * 0.008);
    }

    if (!body.grounded && !body.climbing) {
      if (body.vy > 0.3) {
        hipL = hipR = -0.5;
        kneeL = kneeR = 1.35;
        armL = armR = -1.15;
        elbowL = elbowR = -0.7;
        lean = -0.15;
      } else {
        hipL = hipR = 0.2;
        kneeL = kneeR = 0.12;
        armL = armR = 0.45;
        elbowL = elbowR = -0.15;
        lean = 0.16;
      }
    }

    if (body.climbing) {
      const climb = Math.sin(this.time * 6);
      armL = -2.45 + climb * 0.28;
      armR = -2.45 - climb * 0.28;
      elbowL = elbowR = -0.15;
      hipL = 0.35 + Math.max(0, climb) * 0.55;
      hipR = 0.35 + Math.max(0, -climb) * 0.55;
      kneeL = kneeR = 0.9;
      lean = 0.28;
    }

    if (this.interact > 0) {
      armR = -1.4;
      elbowR = -0.35;
      lean = Math.max(lean, 0.18);
    }

    this.hipL.rotation.x = hipL;
    this.hipR.rotation.x = hipR;
    this.kneeL.rotation.x = kneeL;
    this.kneeR.rotation.x = kneeR;
    this.shoulderL.rotation.x = armL;
    this.shoulderR.rotation.x = armR;
    this.elbowL.rotation.x = elbowL;
    this.elbowR.rotation.x = elbowR;
    this.torso.rotation.x = lean;
    this.torso.rotation.y = twist;
    this.torso.rotation.z = moving ? stride * 0.04 : breath * 0.012;
    this.torso.scale.y = moving ? 1 : 1 + breath * 0.012;
    this.pelvis.position.y = hipDrop;
    this.shoulderL.rotation.z = -0.14;
    this.shoulderR.rotation.z = 0.14;
  }

  private updateHuman(dt: number, body: CharacterBody, speed: number): void {
    const human = this.human;
    if (!human) return;
    const airborne = !body.grounded && !body.climbing;
    if (this.wasGrounded && airborne && body.vy > 0.2) this.jumpPhase = 'up';
    else if (this.jumpPhase === 'up' && airborne && body.vy <= 0.2) this.jumpPhase = 'air';
    else if (this.jumpPhase && this.jumpPhase !== 'land' && !airborne) {
      this.jumpPhase = 'land';
      this.landLeft = 0.32;
    }
    if (this.jumpPhase === 'land') {
      this.landLeft -= dt;
      if (this.landLeft <= 0) this.jumpPhase = null;
    }
    this.wasGrounded = body.grounded;

    let kind: HumanClip = 'idle';
    let clipSpeed = 1;
    let once = false;
    if (this.humanInteract) {
      kind = 'interact';
      once = true;
    } else if (body.climbing) {
      kind = 'climb';
      clipSpeed = human.hasClimb ? 1 : 0.55;
    } else if (this.jumpPhase === 'up') {
      kind = 'jump';
      once = human.dedicated('jump');
    } else if (this.jumpPhase === 'air') {
      kind = 'jumpIdle';
    } else if (this.jumpPhase === 'land') {
      kind = 'jumpLand';
      once = human.dedicated('jumpLand');
    } else if (body.grounded && speed > 3) {
      kind = 'run';
      clipSpeed = Math.min(1.45, Math.max(0.75, speed / 3.2));
    } else if (body.grounded && speed > 0.35) {
      kind = 'walk';
      clipSpeed = Math.min(1.45, Math.max(0.75, speed / 1.6));
    }

    this.playHuman(kind, clipSpeed, once);
    human.mixer.update(dt);
    if (body.climbing && !human.hasClimb) {
      human.armL?.quaternion.multiply(this.armLiftL);
      human.armR?.quaternion.multiply(this.armLiftR);
    }
  }

  private playHuman(kind: HumanClip, speed: number, once: boolean): void {
    const human = this.human;
    if (!human) return;
    const action = human.action(kind);
    if (!action) return;
    const restart = this.interactPulse && kind === 'interact';
    if (restart) this.interactPulse = false;
    if (!restart && this.currentAction === action) {
      action.setEffectiveTimeScale(speed);
      return;
    }
    const previous = this.currentAction;
    action.reset();
    action.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = once;
    action.setEffectiveTimeScale(speed);
    action.enabled = true;
    if (previous && previous !== action) {
      previous.fadeOut(0.2);
      action.setEffectiveWeight(1).fadeIn(0.2).play();
    } else {
      action.setEffectiveWeight(1).play();
    }
    this.currentAction = action;
  }

  private pivot(x: number, y: number, z = 0): Group {
    const joint = new Group();
    joint.position.set(x, y, z);
    return joint;
  }

  private hanging(
    geometry: CapsuleGeometry,
    material: MeshStandardMaterial,
    radius: number,
    length: number,
    x = 0,
    y = 0,
    z = 0,
  ): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y - (length / 2 + radius), z);
    mesh.castShadow = true;
    return mesh;
  }

  private plateMesh(
    width: number,
    height: number,
    depth: number,
    material: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
  ): Mesh {
    const mesh = new Mesh(new RoundedBoxGeometry(width, height, depth, 2, 0.02), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  }

  private seamMesh(
    material: MeshStandardMaterial,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
  ): Mesh {
    const mesh = new Mesh(new RoundedBoxGeometry(width, height, depth, 1, 0.004), material);
    mesh.position.set(x, y, z);
    return mesh;
  }

  private hand(material: MeshStandardMaterial, y: number): Mesh {
    const mesh = new Mesh(new SphereGeometry(0.042, 10, 8), material);
    mesh.position.y = y;
    mesh.castShadow = true;
    return mesh;
  }

  private boot(upperMat: MeshStandardMaterial, soleMat: MeshStandardMaterial, heelMat: MeshStandardMaterial): Group {
    const boot = new Group();
    const upper = new Mesh(new RoundedBoxGeometry(0.11, 0.1, 0.16, 2, 0.02), upperMat);
    upper.position.set(0, -0.4, 0.03);
    upper.castShadow = true;
    const sole = new Mesh(new RoundedBoxGeometry(0.12, 0.035, 0.24, 2, 0.012), soleMat);
    sole.position.set(0, -0.46, 0.04);
    sole.castShadow = true;
    const heel = new Mesh(new RoundedBoxGeometry(0.06, 0.015, 0.03, 1, 0.004), heelMat);
    heel.position.set(0, -0.45, -0.06);
    boot.add(upper, sole, heel);
    return boot;
  }
}

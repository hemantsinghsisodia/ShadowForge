import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  SpotLight,
  TorusGeometry,
  Vector3,
  type Scene,
} from 'three';
import { resolveCaster, resolveLight, surfaceDef } from '../levels/evaluate';
import type { CasterConfig, EntityState, LevelConfig, LightConfig } from '../levels/LevelData';
import type { CasterVolume } from '../shadows/types';
import { ForgeSurface } from '../shadows/ForgeSurface';
import { maskToBoxes } from '../shadows/math';
import type { ShadowManager } from '../shadows/ShadowManager';

interface LampView {
  cfg: LightConfig;
  group: Group;
  pole: Mesh;
  head: Mesh;
  beam: Mesh | null;
  light: PointLight | SpotLight;
  target: Object3D | null;
}

const sharedMaterials = new Set<Material>();

const stone = new MeshStandardMaterial({ color: 0x6e7684, metalness: 0.25, roughness: 0.55 });
const floorMat = new MeshStandardMaterial({ color: 0x161b27, metalness: 0.42, roughness: 0.68 });
const trimMat = new MeshStandardMaterial({ color: 0x123846, emissive: 0x14586e, emissiveIntensity: 0.8, roughness: 0.4 });
const lampMat = new MeshStandardMaterial({ color: 0xd8dee8, metalness: 0.8, roughness: 0.25 });
const nodeMat = new MeshStandardMaterial({ color: 0x8ee9ff, emissive: 0x39d7ff, emissiveIntensity: 0.8, roughness: 0.3 });
const nodeHot = new MeshStandardMaterial({ color: 0xffd2a1, emissive: 0xffb15a, emissiveIntensity: 1.3, roughness: 0.3 });
const solidMat = new MeshStandardMaterial({
  color: 0xb8fbff,
  emissive: 0x147a90,
  emissiveIntensity: 0.45,
  roughness: 0.28,
  metalness: 0.15,
  transparent: true,
  opacity: 0.9,
});
sharedMaterials.add(stone);
sharedMaterials.add(floorMat);
sharedMaterials.add(trimMat);
sharedMaterials.add(lampMat);
sharedMaterials.add(nodeMat);
sharedMaterials.add(nodeHot);
sharedMaterials.add(solidMat);

export class LevelWorld {
  readonly root = new Group();
  readonly menu = new Group();
  readonly forges: ForgeSurface[] = [];
  readonly guideMeshes: Mesh[] = [];
  readonly consoles: { id: string; surfaceId: string; group: Group }[] = [];
  private readonly lamps = new Map<string, LampView>();
  private readonly casterGroups = new Map<string, Group>();
  private readonly casterKeys = new Map<string, string>();
  private readonly guides = new Group();
  private readonly solidGroup = new Group();
  private exit: Mesh | null = null;
  private sun: DirectionalLight | null = null;
  private config: LevelConfig | null = null;
  time = 0;

  constructor(private scene: Scene) {
    this.scene.add(this.root);
    this.scene.add(this.menu);
    this.root.add(this.guides, this.solidGroup);
    this.buildMenu();
  }

  showMenu(on: boolean): void {
    this.menu.visible = on;
    this.root.visible = !on;
  }

  load(config: LevelConfig, shadowMapSize: number): void {
    this.clearLevel();
    this.config = config;
    this.scene.background = new Color(0x07080e);
    this.scene.fog = new FogExp2(0x07080e, config.id >= 8 ? 0.02 : 0.035);
    const hemi = new HemisphereLight(0xb7c6dc, 0x243044, 2.1);
    this.root.add(hemi);
    this.sun = new DirectionalLight(0xe7eef8, 4.5);
    this.sun.position.set(-12, 22, 8);
    this.applyShadowSize(shadowMapSize);
    this.root.add(this.sun, this.sun.target);

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const platform of config.platforms) {
      const mesh = new Mesh(new BoxGeometry(platform.size[0], platform.size[1], platform.size[2]), floorMat);
      mesh.position.set(platform.position[0], platform.position[1], platform.position[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      const top = platform.position[1] + platform.size[1] / 2;
      if (platform.size[1] < 2) {
        const strip = new Mesh(new BoxGeometry(Math.max(0.2, platform.size[0] - 0.2), 0.045, 0.07), trimMat);
        strip.position.set(platform.position[0], top + 0.02, platform.position[2] - platform.size[2] / 2 + 0.08);
        this.root.add(strip);
      }
      minX = Math.min(minX, platform.position[0] - platform.size[0] / 2);
      maxX = Math.max(maxX, platform.position[0] + platform.size[0] / 2);
      minZ = Math.min(minZ, platform.position[2] - platform.size[2] / 2);
      maxZ = Math.max(maxZ, platform.position[2] + platform.size[2] / 2);
    }
    this.dress(minX, maxX, minZ, maxZ);

    for (const cfg of config.lights) {
      const view = this.makeLamp(cfg);
      this.lamps.set(cfg.id, view);
      this.root.add(view.group);
    }
    for (const cfg of config.casters) {
      const group = new Group();
      this.casterGroups.set(cfg.id, group);
      this.root.add(group);
    }
    for (const surface of config.surfaces) {
      const forge = new ForgeSurface(surfaceDef(surface));
      this.forges.push(forge);
      this.root.add(forge.mesh);
    }
    for (const console of config.consoles) {
      const group = this.makeConsole();
      group.position.set(console.position[0], console.position[1], console.position[2]);
      this.consoles.push({ id: console.id, surfaceId: console.surfaceId, group });
      this.root.add(group);
    }
    const ring = new Mesh(
      new TorusGeometry(config.exit.radius, 0.055, 8, 28),
      new MeshStandardMaterial({ color: 0xb6fff2, emissive: 0x3ee0c8, emissiveIntensity: 1.1, roughness: 0.25 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(config.exit.position[0], config.exit.position[1] + 0.08, config.exit.position[2]);
    this.exit = ring;
    this.root.add(ring);
    const pit = new Mesh(new BoxGeometry(Math.max(40, maxX - minX + 30), 0.2, Math.max(20, maxZ - minZ + 20)), floorMat);
    pit.position.set((minX + maxX) / 2, -8, (minZ + maxZ) / 2);
    this.root.add(pit);
  }

  sync(shadows: ShadowManager): void {
    if (!this.config) return;
    for (const cfg of this.config.lights) {
      const view = this.lamps.get(cfg.id);
      if (!view) continue;
      const volume = resolveLight(cfg, shadows.states[cfg.id] ?? cfg.initial);
      view.group.position.set(volume.x, volume.y, volume.z);
      view.pole.scale.y = Math.max(0.35, volume.y);
      view.pole.position.y = -view.pole.scale.y / 2;
      view.light.intensity = volume.enabled ? cfg.intensity * (cfg.type === 'spotlight' ? 40 : 55) : 0;
      view.light.distance = volume.range;
      const emissive = view.head.material as MeshStandardMaterial;
      emissive.emissiveIntensity = volume.enabled ? 1.4 : 0.12;
      if (view.target && volume.spot) {
        view.target.position.set(volume.spot.dx * 5, volume.spot.dy * 5, volume.spot.dz * 5);
        if (view.beam) view.beam.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), new Vector3(volume.spot.dx, volume.spot.dy, volume.spot.dz).normalize());
      }
    }
    for (const cfg of this.config.casters) {
      const group = this.casterGroups.get(cfg.id);
      if (!group) continue;
      const volume = resolveCaster(cfg, shadows.states[cfg.id] ?? cfg.initial);
      const key = `${volume.kind}:${volume.cx.toFixed(3)}:${volume.cy.toFixed(3)}:${volume.cz.toFixed(3)}:${volume.yaw.toFixed(3)}:${volume.sx}:${volume.sy}:${volume.sz}`;
      if (this.casterKeys.get(cfg.id) !== key) {
        this.casterKeys.set(cfg.id, key);
        this.fillCaster(group, volume);
      }
    }
    for (const forge of this.forges) {
      const preview = shadows.preview.get(forge.def.id);
      const solid = shadows.solid.get(forge.def.id);
      const stab = shadows.stability.get(forge.def.id);
      if (!preview || !solid || !stab) continue;
      forge.write(preview, solid, stab.forged ? stab.value : 0);
      forge.setTime(this.time);
    }
    this.rebuildSolid(shadows);
  }

  showGuides(id: string, index: number): void {
    this.hideGuides();
    if (!this.config) return;
    const light = this.config.lights.find((entry) => entry.id === id);
    const caster = this.config.casters.find((entry) => entry.id === id);
    const cfg = light ?? caster;
    if (!cfg) return;
    const states = cfg.states;
    const points = states.map((state, i) => this.statePoint(cfg, state, i, states.length));
    if (cfg.guide === 'rail' && points.length > 1) this.guides.add(railLine(points));
    points.forEach((point, i) => {
      const mesh = new Mesh(new CylinderGeometry(0.16, 0.16, 0.08, 16), i === index ? nodeHot : nodeMat);
      mesh.position.copy(point);
      mesh.position.y = Math.max(point.y, 0.2);
      mesh.userData = { index: i };
      this.guides.add(mesh);
      this.guideMeshes.push(mesh);
    });
  }

  hideGuides(): void {
    for (const child of [...this.guides.children]) {
      this.guides.remove(child);
      disposeObject(child);
    }
    this.guideMeshes.length = 0;
  }

  applyShadowSize(size: number): void {
    if (!this.sun) return;
    const enabled = size > 0;
    this.sun.castShadow = enabled;
    if (!enabled) return;
    this.sun.shadow.mapSize.set(size, size);
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 80;
    cam.left = -40;
    cam.right = 40;
    cam.top = 40;
    cam.bottom = -40;
    cam.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    if (this.exit) this.exit.rotation.z = this.time * 0.6;
    for (const console of this.consoles) {
      const button = console.group.children[1] as Mesh;
      const mat = button.material as MeshStandardMaterial;
      mat.emissiveIntensity = 0.7 + Math.sin(this.time * 3) * 0.45;
    }
    this.menu.rotation.y = this.time * 0.15;
    for (const forge of this.forges) forge.setTime(this.time);
  }

  private rebuildSolid(shadows: ShadowManager): void {
    for (const child of [...this.solidGroup.children]) {
      this.solidGroup.remove(child);
      const mesh = child as Mesh;
      mesh.geometry.dispose();
    }
    for (const [id, frozen] of shadows.solid) {
      const def = shadows.defs.get(id);
      const stab = shadows.stability.get(id);
      if (!def || !stab?.forged) continue;
      for (const box of maskToBoxes(def, frozen)) {
        const width = Math.max(0.05, box.maxX - box.minX);
        const height = Math.max(0.08, box.maxY - box.minY);
        const depth = Math.max(0.05, box.maxZ - box.minZ);
        const mesh = new Mesh(new BoxGeometry(width, height, depth), solidMat);
        mesh.position.set((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2, (box.minZ + box.maxZ) / 2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.solidGroup.add(mesh);
      }
    }
  }

  private clearLevel(): void {
    this.hideGuides();
    for (const child of [...this.solidGroup.children]) {
      this.solidGroup.remove(child);
      (child as Mesh).geometry.dispose();
    }
    for (const forge of this.forges) {
      this.root.remove(forge.mesh);
      forge.dispose();
    }
    this.forges.length = 0;
    this.consoles.length = 0;
    this.lamps.clear();
    this.casterGroups.clear();
    this.casterKeys.clear();
    this.exit = null;
    this.sun = null;
    for (const child of [...this.root.children]) {
      if (child === this.guides || child === this.solidGroup) continue;
      this.root.remove(child);
      disposeObject(child);
    }
  }

  private makeLamp(cfg: LightConfig): LampView {
    const group = new Group();
    const pole = new Mesh(new CylinderGeometry(0.06, 0.08, 1, 8), lampMat);
    pole.castShadow = true;
    const head = new Mesh(
      new BoxGeometry(0.34, 0.18, 0.34),
      new MeshStandardMaterial({ color: cfg.color, emissive: new Color(cfg.color), emissiveIntensity: 1.4, roughness: 0.35 }),
    );
    head.castShadow = true;
    let beam: Mesh | null = null;
    let light: PointLight | SpotLight;
    let target: Object3D | null = null;
    if (cfg.type === 'spotlight') {
      const spot = new SpotLight(new Color(cfg.color), cfg.intensity * 40, cfg.range, ((cfg.cone ?? 18) * Math.PI) / 180, 0.35, 1);
      target = new Object3D();
      group.add(target);
      spot.target = target;
      light = spot;
      beam = new Mesh(
        new ConeGeometry(0.16, 0.5, 10),
        new MeshStandardMaterial({ color: cfg.color, emissive: new Color(cfg.color), emissiveIntensity: 0.6, roughness: 0.4 }),
      );
      group.add(beam);
    } else {
      light = new PointLight(new Color(cfg.color), cfg.intensity * 55, cfg.range, 2);
    }
    group.add(pole, head, light);
    pole.scale.y = Math.max(0.4, cfg.position[1]);
    pole.position.y = -pole.scale.y / 2;
    return { cfg, group, pole, head, beam, light, target };
  }

  private fillCaster(group: Group, volume: CasterVolume): void {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeObject(child);
    }
    group.position.set(volume.cx, volume.cy, volume.cz);
    group.rotation.y = volume.yaw;
    const add = (geometry: BufferGeometry, x = 0, y = 0, z = 0) => {
      const mesh = new Mesh(geometry, stone);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    };
    if (volume.kind === 'cylinder') {
      const radius = Math.max(volume.sx, volume.sz) / 2;
      add(new CylinderGeometry(radius, radius, volume.sy, 18));
      return;
    }
    if (volume.kind === 'prism') {
      add(new CylinderGeometry(0.05, Math.max(volume.sx, volume.sz) / 2, volume.sy, 3));
      return;
    }
    if (volume.kind === 'lshape') {
      const t = Math.min(volume.sx, volume.sz) * 0.42;
      const hx = volume.sx / 2;
      const hz = volume.sz / 2;
      add(new BoxGeometry(t, volume.sy, volume.sz), -hx + t / 2, 0, 0);
      add(new BoxGeometry(volume.sx, volume.sy, t), 0, 0, -hz + t / 2);
      return;
    }
    add(new BoxGeometry(volume.sx, volume.sy, volume.sz));
  }

  private makeConsole(): Group {
    const group = new Group();
    const base = new Mesh(new CylinderGeometry(0.28, 0.34, 0.9, 8), lampMat);
    base.position.y = 0.45;
    base.castShadow = true;
    const button = new Mesh(
      new BoxGeometry(0.28, 0.08, 0.28),
      new MeshStandardMaterial({ color: 0xffb15a, emissive: 0xffb15a, emissiveIntensity: 1, roughness: 0.3 }),
    );
    button.position.y = 0.94;
    group.add(base, button);
    return group;
  }

  private statePoint(cfg: LightConfig | CasterConfig, state: EntityState, index: number, count: number): Vector3 {
    if (state.position) return new Vector3(state.position[0], state.position[1], state.position[2]);
    if (state.yaw !== undefined) {
      const yaw = state.yaw;
      return new Vector3(cfg.position[0] + Math.sin(yaw) * 1.7, 0.35, cfg.position[2] + Math.cos(yaw) * 1.7);
    }
    const spread = (index - (count - 1) / 2) * 0.6;
    return new Vector3(cfg.position[0] + spread, 0.45, cfg.position[2] + 1.15);
  }

  private dress(minX: number, maxX: number, minZ: number, maxZ: number): void {
    if (!Number.isFinite(minX)) return;
    const beamMat = new MeshStandardMaterial({ color: 0x121722, metalness: 0.65, roughness: 0.35 });
    const y = 6.2;
    const span = Math.max(4, maxZ - minZ);
    for (let x = minX + 2; x < maxX; x += 7) {
      const beam = new Mesh(new BoxGeometry(0.18, 0.18, span), beamMat);
      beam.position.set(x, y, (minZ + maxZ) / 2);
      this.root.add(beam);
    }
  }

  private buildMenu(): void {
    const floor = new Mesh(new BoxGeometry(8, 0.4, 5), floorMat);
    floor.position.y = -0.2;
    const cube = new Mesh(new BoxGeometry(0.8, 1.6, 0.8), stone);
    cube.position.set(0.2, 0.8, 0);
    const lamp = new Mesh(new BoxGeometry(0.3, 0.16, 0.3), new MeshStandardMaterial({ color: 0xffd2a1, emissive: 0xffb15a, emissiveIntensity: 1.5 }));
    lamp.position.set(-1.4, 2.2, 0);
    const light = new PointLight(0xffd2a1, 2800, 14, 2);
    light.position.copy(lamp.position);
    const strip = new Mesh(new BoxGeometry(3.2, 0.05, 1.2), trimMat);
    strip.position.set(1.6, 0.04, 0);
    this.menu.add(floor, cube, lamp, light, strip);
    this.menu.position.set(0, 0.2, 0);
  }
}

function railLine(points: Vector3[]): Line {
  return new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: 0x5ce1ff }));
}

function disposeObject(object: Object3D): void {
  object.traverse((child: Object3D) => {
    const mesh = child as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const entry of list) {
      if (!sharedMaterials.has(entry)) entry.dispose();
    }
  });
}

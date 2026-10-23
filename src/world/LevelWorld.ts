import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  ShaderMaterial,
  SpotLight,
  TorusGeometry,
  Vector3,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { aimBeam, createBeam, type BeamView } from '../effects/LightBeams';
import { RISE_DELAY, collapseTimeFor, riseProgress } from '../effects/ForgeTimeline';
import { buildObsidianMesh, createObsidianMaterial, stepSolid, type SolidMode } from '../effects/Obsidian';
import { resolveCaster, resolveLight, surfaceDef } from '../levels/evaluate';
import type { CasterConfig, EntityState, LevelConfig, LightConfig } from '../levels/LevelData';
import type { QualityProfile } from '../settings/Settings';
import type { CasterVolume } from '../shadows/types';
import { FORGE_LIGHT_PEAK, ForgeSurface, forgeLightPoint } from '../shadows/ForgeSurface';
import { maskToBoxes } from '../shadows/math';
import type { ShadowManager } from '../shadows/ShadowManager';
import { envKit, loadEnvKit, setKitScale, type EnvKit } from './EnvKit';
import { forgeKit, loadForgeKit } from './ForgeKit';
import { ForgeCavern, MENU_BOUNDS } from './ForgeCavern';
import { levelAtmosphere, moltenPulse } from './ForgePalette';
import { LIGHTING, hemiIntensity, type LightingConfig } from './Lighting';
import { levelBounds, sunShadowFrame } from './CavernLayout';
import { LAMP_SHADOW, disposeLightShadows, pickShadowLamp } from './LampShadow';
import { buildDressing, buildForgeRims, buildKitFloor, tuckUnderTile, type RoomBounds } from './LabDressing';
import { installHeightFog } from './HeightFog';
import { accentFor, buildEnvMap, createLabMaterials, worldUvBox } from './Materials';

installHeightFog();

interface LampView {
  cfg: LightConfig;
  group: Group;
  pole: Mesh;
  head: Mesh;
  beam: Mesh | null;
  glow: BeamView;
  light: PointLight | SpotLight;
  target: Object3D | null;
}

/** One surface's obsidian: a single instanced mesh plus its rise / idle / collapse clock. */
interface SolidView {
  key: string;
  mesh: InstancedMesh;
  material: ShaderMaterial;
  mode: SolidMode;
  t: number;
}

const lab = createLabMaterials();
const sharedMaterials = lab.shared;
const stone = lab.stone;
const floorMat = lab.floor;
const trimMat = lab.trim;
const lampMat = lab.lamp;
const nodeMat = lab.node;
const nodeHot = lab.nodeHot;

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
  private column: Mesh | null = null;
  private sun: DirectionalLight | null = null;
  private hemi: HemisphereLight | null = null;
  private underLight: DirectionalLight | null = null;
  private config: LevelConfig | null = null;
  private dressing: Group | null = null;
  private rims: Group | null = null;
  private pillars: Mesh[] = [];
  private bounds: RoomBounds | null = null;
  /** X range the sun's shadow camera covers; follows the level, restored by every `applyShadowSize`. */
  private shadowFrame = { centreX: 0, halfX: 40 };
  private accent = new Color(0x5ce1ff);
  /** The one light that swells at the plate during a forge. Medium / high cavern tiers only; never added or removed per frame. */
  private forgeLight: PointLight | null = null;
  private readonly forgePoint = { x: 0, y: 0, z: 0 };
  /** Id of the one lamp that may cast a real shadow (High only); chosen at load. */
  private shadowLampId: string | null = null;
  private beamsOn = true;
  private dressingDetail: 'low' | 'high' = 'high';
  private gl: WebGLRenderer | null = null;
  private env: Texture | null = null;
  private profile: QualityProfile | null = null;
  private readonly solidViews = new Map<string, SolidView>();
  private solidDt = 0;
  /** Tiny obsidian mesh drawn for one frame after load so the instanced program compiles before the first forge. */
  private prewarm: InstancedMesh | null = null;
  private prewarmFrames = 0;
  private readonly risePending = new Set<string>();
  private readonly collapsePending = new Set<string>();
  private platformViews: Mesh[][] = [];
  private loadToken = 0;
  private dressingKit = false;
  readonly cavern = new ForgeCavern();
  time = 0;

  constructor(private scene: Scene) {
    this.scene.add(this.root);
    this.scene.add(this.menu);
    this.scene.add(this.cavern.group, this.cavern.dome);
    this.root.add(this.guides, this.solidGroup);
    this.buildMenu();
  }

  showMenu(on: boolean): void {
    this.menu.visible = on;
    this.root.visible = !on;
    if (on || !this.bounds) this.cavern.mount(MENU_BOUNDS, [], 0);
    else this.cavern.mount(this.bounds, this.config?.platforms ?? [], this.config?.id ?? 0);
  }

  bindRenderer(renderer: WebGLRenderer): void {
    this.gl = renderer;
    lab.setAnisotropy(renderer.capabilities.getMaxAnisotropy());
    this.ensureEnv();
    // Load the forge kit now so the menu has towers on first boot; load() calls it again (cached, idempotent).
    void loadForgeKit().then((kit) => {
      if (kit) this.cavern.setKit(kit);
    });
  }

  applyProfile(profile: QualityProfile): void {
    const detailChanged = this.dressingDetail !== profile.dressingDetail;
    this.profile = profile;
    if (this.hemi) this.hemi.intensity = hemiIntensity(profile.envMap);
    this.beamsOn = profile.beams;
    this.dressingDetail = profile.dressingDetail;
    if (profile.envMap) {
      this.ensureEnv();
      if (this.env) {
        lab.applyEnv(this.env);
        this.scene.environment = this.env;
        this.scene.environmentIntensity = LIGHTING.env;
      }
    } else {
      this.scene.environment = null;
      lab.applyEnv(null);
    }
    if (detailChanged && this.bounds) {
      this.mountDressing();
      this.mountRims();
    }
    this.cavern.setDetail(profile.cavern, profile.embers);
    this.syncForgeLight();
    this.syncLampShadow();
  }

  /** Turns the shadow lamp's shadow on or off to match the tier. The shadow parameters are set once in makeLamp. */
  private syncLampShadow(): void {
    const view = this.shadowLampId === null ? undefined : this.lamps.get(this.shadowLampId);
    if (view) view.light.castShadow = this.profile?.lampShadows ?? false;
  }

  /** Adds or removes the forge light to match the tier. Runs on load and on a tier change only. */
  private syncForgeLight(): void {
    const want = this.config !== null && this.profile !== null && this.profile.forgeLight;
    if (want && !this.forgeLight) {
      this.forgeLight = new PointLight(this.accent, 0, 7, 2);
      this.forgeLight.castShadow = false;
      this.root.add(this.forgeLight);
    } else if (!want && this.forgeLight) {
      this.root.remove(this.forgeLight);
      this.forgeLight = null;
    }
  }

  /** Plate charge-up on one surface, 0..1. A null id applies to every surface (use it to reset). */
  setForgeCharge(surfaceId: string | null, c: number): void {
    const clamped = Math.max(0, Math.min(1, c));
    for (const forge of this.forges) {
      if (surfaceId === null || forge.def.id === surfaceId) forge.setCharge(clamped);
    }
  }

  /** Swells the forge light at `surfaceId`'s plate: centre + normal * 0.6, intensity k * FORGE_LIGHT_PEAK. A null id (or Low tier) leaves it dark. */
  setForgeLight(surfaceId: string | null, k: number): void {
    const light = this.forgeLight;
    if (!light) return;
    const forge = surfaceId === null ? undefined : this.forges.find((f) => f.def.id === surfaceId);
    if (!forge) {
      light.intensity = 0;
      return;
    }
    forgeLightPoint(forge.def, 0.6, this.forgePoint);
    light.position.set(this.forgePoint.x, this.forgePoint.y, this.forgePoint.z);
    light.intensity = k * FORGE_LIGHT_PEAK;
  }

  /** Marks `surfaceId` so the next `sync` raises its new obsidian out of the plate instead of popping it in. */
  beginRise(surfaceId: string): void {
    this.risePending.add(surfaceId);
  }

  /** Marks `surfaceId` so the next `sync` recedes its obsidian, glowing hot, instead of removing it at once. */
  beginCollapse(surfaceId: string): void {
    this.collapsePending.add(surfaceId);
  }

  /** Live tuning hook (__SF.light): merges into LIGHTING and pushes the values to every live light and material. */
  applyLighting(partial: Partial<LightingConfig>): void {
    const target = LIGHTING as unknown as Record<string, number>;
    for (const [key, value] of Object.entries(partial)) {
      if (typeof value === 'number' && Number.isFinite(value)) target[key] = value;
    }
    if (this.sun) {
      this.sun.intensity = LIGHTING.sun;
      this.sun.color.setHex(LIGHTING.sunColor);
    }
    if (this.hemi) {
      this.hemi.intensity = hemiIntensity(this.profile?.envMap ?? true);
      this.hemi.groundColor.setHex(LIGHTING.hemiGround);
    }
    if (this.underLight) {
      this.underLight.color.setHex(LIGHTING.underColor);
      this.underLight.intensity = LIGHTING.under * moltenPulse(this.time);
    }
    const envOn = this.env !== null && this.scene.environment === this.env;
    if (envOn) this.scene.environmentIntensity = LIGHTING.env;
    lab.floor.color.setHex(LIGHTING.floorTint);
    lab.wall.color.setHex(LIGHTING.wallTint);
    const kitMaterials = new Set<Material>(envKit()?.allMaterials());
    for (const material of forgeKit()?.allMaterials() ?? []) kitMaterials.add(material);
    this.root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (typeof material.userData.baseColor === 'number') kitMaterials.add(material);
        // Lab materials and their clones (pillar stone) carry the env map with a per-material intensity.
        const standard = material as MeshStandardMaterial;
        if (envOn && standard.envMap === this.env) standard.envMapIntensity = LIGHTING.env;
      }
    });
    for (const material of lab.shared) {
      const standard = material as MeshStandardMaterial;
      if (envOn && standard.envMap === this.env) standard.envMapIntensity = LIGHTING.env;
    }
    setKitScale(kitMaterials, LIGHTING.kitScale);
  }

  /** The level's accent colour as sRGB hex, for sparks that should match the forge. */
  accentHex(): number {
    return this.accent.getHex();
  }

  pulseForge(id: string): void {
    this.forges.find((forge) => forge.def.id === id)?.pulse();
  }

  load(config: LevelConfig, shadowMapSize: number): void {
    this.clearLevel();
    this.config = config;
    this.accent = accentFor(config.id);
    const atmosphere = levelAtmosphere(config.id);
    this.scene.background = new Color(atmosphere.background);
    this.scene.fog = new FogExp2(atmosphere.fog, atmosphere.density);
    this.hemi = new HemisphereLight(0xb7c6dc, LIGHTING.hemiGround, hemiIntensity(this.profile?.envMap ?? true));
    this.root.add(this.hemi);
    this.sun = new DirectionalLight(LIGHTING.sunColor, LIGHTING.sun);
    this.bounds = levelBounds(config.platforms);
    this.shadowFrame = sunShadowFrame(this.bounds);
    this.sun.position.set(-12 + this.shadowFrame.centreX, 22, 8);
    this.sun.target.position.set(this.shadowFrame.centreX, 0, 0);
    this.applyShadowSize(shadowMapSize);
    this.root.add(this.sun, this.sun.target);

    for (const platform of config.platforms) {
      const mesh = new Mesh(worldUvBox(platform.size[0], platform.size[1], platform.size[2], 2), floorMat);
      mesh.position.set(platform.position[0], platform.position[1], platform.position[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      const views = [mesh];
      const top = platform.position[1] + platform.size[1] / 2;
      if (platform.size[1] < 2) {
        const strip = new Mesh(new BoxGeometry(Math.max(0.2, platform.size[0] - 0.2), 0.045, 0.07), trimMat);
        strip.position.set(platform.position[0], top + 0.02, platform.position[2] - platform.size[2] / 2 + 0.08);
        this.root.add(strip);
        views.push(strip);
      }
      this.platformViews.push(views);
    }
    const { minX, maxX } = this.bounds;
    this.cavern.mount(this.bounds, config.platforms, config.id);
    const midX = (minX + maxX) / 2;
    this.underLight = new DirectionalLight(LIGHTING.underColor, LIGHTING.under);
    this.underLight.position.set(midX + 3, -12, 4);
    this.underLight.target.position.set(midX, 0, 0);
    this.underLight.castShadow = false;
    this.root.add(this.underLight, this.underLight.target);
    this.mountDressing();
    const token = ++this.loadToken;
    const forge = forgeKit();
    if (forge) {
      this.cavern.setKit(forge);
      this.mountRims();
    } else
      void loadForgeKit().then((loaded) => {
        if (!loaded) return;
        this.cavern.setKit(loaded);
        if (token === this.loadToken) this.mountRims();
      });
    const kit = envKit();
    if (kit) this.applyKit(kit);
    else
      void loadEnvKit().then((loaded) => {
        if (loaded && token === this.loadToken) this.applyKit(loaded);
      });

    this.shadowLampId = pickShadowLamp(config);
    for (const cfg of config.lights) {
      const view = this.makeLamp(cfg);
      this.lamps.set(cfg.id, view);
      this.root.add(view.group);
    }
    this.syncLampShadow();
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
    this.syncForgeLight();
    for (const console of config.consoles) {
      const group = this.makeConsole();
      group.position.set(console.position[0], console.position[1], console.position[2]);
      this.consoles.push({ id: console.id, surfaceId: console.surfaceId, group });
      this.root.add(group);
    }
    const ring = new Mesh(
      new TorusGeometry(config.exit.radius, 0.055, 8, 28),
      new MeshStandardMaterial({ color: 0xb6fff2, emissive: 0x3ee0c8, emissiveIntensity: 2.6, roughness: 0.25 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(config.exit.position[0], config.exit.position[1] + 0.08, config.exit.position[2]);
    this.exit = ring;
    this.root.add(ring);
    const column = new Mesh(
      new CylinderGeometry(0.08, 0.42, 3.4, 12, 1, true),
      new MeshBasicMaterial({
        color: 0x7dffe1,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    );
    column.position.set(config.exit.position[0], 1.8, config.exit.position[2]);
    this.column = column;
    this.root.add(column);
    this.mountPrewarm(config);
  }

  /**
   * Medium / High only: keeps one tiny obsidian instance (the same material and shadow flags as a real one) in the
   * scene for a couple of frames, so the instanced program compiles during load instead of hitching the first forge.
   * `renderer.compile` is not used: it needs a camera and renders to the canvas, while the game draws into the
   * composer's target, so the program it built would not be the one the first forge needs.
   */
  private mountPrewarm(config: LevelConfig): void {
    this.dropPrewarm();
    if (!this.profile || this.profile.cavern === 'low') return;
    const p = config.platforms[0]?.position ?? [0, 0, 0];
    const box = { minX: p[0], minY: p[1], minZ: p[2], maxX: p[0], maxY: p[1], maxZ: p[2], climbable: false, nx: 0, ny: 0, nz: 0 };
    const material = createObsidianMaterial(1, this.accent);
    material.uniforms.rise.value = 0;
    const mesh = buildObsidianMesh([box], material);
    mesh.scale.setScalar(0.0001);
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.prewarm = mesh;
    this.prewarmFrames = 2;
  }

  private dropPrewarm(): void {
    const mesh = this.prewarm;
    if (!mesh) return;
    this.prewarm = null;
    this.root.remove(mesh);
    mesh.geometry.dispose();
    mesh.dispose();
    (mesh.material as ShaderMaterial).dispose();
  }

  sync(shadows: ShadowManager): void {
    if (!this.config) return;
    for (const cfg of this.config.lights) {
      const view = this.lamps.get(cfg.id);
      if (!view) continue;
      const volume = resolveLight(cfg, shadows.states[cfg.id] ?? cfg.initial);
      view.group.position.set(volume.x, volume.y, volume.z);
      view.pole.scale.y = Math.max(0.4, volume.y) - 0.09;
      view.pole.position.y = -view.pole.scale.y / 2;
      view.light.intensity = volume.enabled ? cfg.intensity * (cfg.type === 'spotlight' ? 40 : 55) : 0;
      view.light.distance = volume.range;
      if (cfg.id === this.shadowLampId) {
        // A lamp that is off skips its shadow pass (toggling castShadow would recompile materials); one refresh when it comes back.
        if (volume.enabled && !view.light.shadow.autoUpdate) view.light.shadow.needsUpdate = true;
        view.light.shadow.autoUpdate = volume.enabled;
      }
      const headMat = view.head.material as MeshBasicMaterial;
      headMat.color.set(cfg.color).multiplyScalar(volume.enabled ? 4.0 : 0.12);
      const dir =
        view.target && volume.spot
          ? new Vector3(volume.spot.dx, volume.spot.dy, volume.spot.dz)
          : new Vector3(0, -1, 0.05);
      aimBeam(view.glow, dir, Math.min(volume.range, 9), volume.enabled && this.beamsOn ? 1 : 0);
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
    cam.left = -this.shadowFrame.halfX;
    cam.right = this.shadowFrame.halfX;
    cam.top = 40;
    cam.bottom = -40;
    cam.updateProjectionMatrix();
  }

  update(dt: number, px = 0, pz = 0): void {
    this.time += dt;
    this.cavern.update(this.time);
    if (this.underLight) this.underLight.intensity = LIGHTING.under * moltenPulse(this.time);
    if (this.exit) this.exit.rotation.z = this.time * 0.6;
    if (this.column) {
      const mat = this.column.material as MeshBasicMaterial;
      mat.opacity = 0.16 + Math.sin(this.time * 2.2) * 0.08;
      this.column.scale.y = 1 + Math.sin(this.time * 1.6) * 0.04;
    }
    for (const console of this.consoles) {
      const button = console.group.children[1] as Mesh;
      const ring = console.group.children[2] as Mesh;
      const dist = Math.hypot(console.group.position.x - px, console.group.position.z - pz);
      const near = dist < 3.2;
      const mat = button.material as MeshStandardMaterial;
      mat.emissiveIntensity = near ? 1.3 + Math.sin(this.time * 8) * 0.55 : 0.65 + Math.sin(this.time * 3) * 0.3;
      if (ring) ring.rotation.y = this.time * (near ? 2.2 : 0.7);
    }
    this.menu.rotation.y = Math.sin(this.time * 0.15) * 0.18;
    for (const forge of this.forges) forge.setTime(this.time);
    this.solidDt = dt;
    this.solidViews.forEach(this.tickSolid);
    if (this.prewarm && this.root.visible && --this.prewarmFrames <= 0) this.dropPrewarm();
  }

  /** Bound once so the per-frame `forEach` allocates nothing. */
  private readonly tickSolid = (view: SolidView, id: string): void => {
    if (view.mode === 'idle') return;
    const step = stepSolid(view, this.solidDt);
    view.material.uniforms.rise.value = step.rise;
    view.material.uniforms.hot.value = step.hot;
    if (step.done) this.removeSolid(id, view);
  };

  private rebuildSolid(shadows: ShadowManager): void {
    for (const [id, frozen] of shadows.solid) {
      const def = shadows.defs.get(id);
      const stab = shadows.stability.get(id);
      const view = this.solidViews.get(id);
      if (!def || !stab?.forged) {
        // Collapsing views live on until they finish; anything else goes now, or starts collapsing if marked.
        if (view && view.mode !== 'collapse') {
          if (this.collapsePending.has(id)) {
            // A surface still rising recedes from where it stands instead of popping to full height first.
            view.t = collapseTimeFor(view.mode === 'rise' ? riseProgress(view.t) : 1);
            view.mode = 'collapse';
            view.material.uniforms.hot.value = 1;
          } else this.removeSolid(id, view);
        }
        continue;
      }
      const key = `${frozen.join('')}:forged`;
      if (view && view.mode !== 'collapse' && view.key === key) {
        view.material.uniforms.stab.value = stab.value;
        continue;
      }
      if (view) this.removeSolid(id, view);
      const boxes = maskToBoxes(def, frozen);
      if (boxes.length === 0) continue;
      const rising = this.risePending.has(id);
      const material = createObsidianMaterial(stab.value, this.accent);
      material.uniforms.rise.value = rising ? 0 : 1;
      const mesh = buildObsidianMesh(boxes, material);
      this.solidGroup.add(mesh);
      this.solidViews.set(id, { key, mesh, material, mode: rising ? 'rise' : 'idle', t: rising ? -RISE_DELAY : 0 });
    }
    this.risePending.clear();
    this.collapsePending.clear();
  }

  private removeSolid(id: string, view: SolidView): void {
    this.solidViews.delete(id);
    this.solidGroup.remove(view.mesh);
    view.mesh.geometry.dispose();
    view.mesh.dispose();
    view.material.dispose();
  }

  private clearLevel(): void {
    this.hideGuides();
    this.dropPrewarm();
    for (const [id, view] of [...this.solidViews]) this.removeSolid(id, view);
    this.risePending.clear();
    this.collapsePending.clear();
    for (const forge of this.forges) {
      this.root.remove(forge.mesh);
      forge.dispose();
    }
    this.forges.length = 0;
    this.consoles.length = 0;
    // three never frees a light's shadow map when the light is removed, so free the shadow lamp's and the sun's here.
    const shadowView = this.shadowLampId === null ? undefined : this.lamps.get(this.shadowLampId);
    disposeLightShadows([shadowView?.light, this.sun]);
    this.lamps.clear();
    this.shadowLampId = null;
    this.casterGroups.clear();
    this.casterKeys.clear();
    this.exit = null;
    this.column = null;
    this.sun = null;
    this.hemi = null;
    this.underLight = null;
    this.forgeLight = null;
    this.bounds = null;
    this.pillars = [];
    this.platformViews = [];
    if (this.dressing) {
      this.root.remove(this.dressing);
      disposeObject(this.dressing);
      this.dressing = null;
    }
    this.clearRims();
    for (const child of [...this.root.children]) {
      if (child === this.guides || child === this.solidGroup) continue;
      this.root.remove(child);
      disposeObject(child);
    }
  }

  /**
   * Swaps the procedural floor visuals for kit tiles once the kit is available. The procedural
   * boxes stay in place (tucked under the kit tile) and collision never reads either, so a failure leaves the level as it was.
   */
  private applyKit(kit: EnvKit): void {
    if (!this.config) return;
    try {
      const floor = buildKitFloor(kit, this.config.platforms);
      if (floor) {
        this.root.add(floor.group);
        for (const index of floor.covered) {
          const [slab, ...trim] = this.platformViews[index] ?? [];
          const platform = this.config.platforms[index];
          // The slab stays visible so its sides read as thickness under the kit tile; trim strips would poke through.
          if (slab && platform) {
            const { scaleY, offsetY } = tuckUnderTile(platform.size[1]);
            slab.scale.y = scaleY;
            slab.position.y = platform.position[1] + offsetY;
          }
          for (const view of trim) view.visible = false;
        }
      }
      if (!this.dressingKit) this.mountDressing();
    } catch (error) {
      console.error('[EnvKit] failed to dress the level; keeping procedural visuals.', error);
    }
  }

  private makeLamp(cfg: LightConfig): LampView {
    const group = new Group();
    // The shadow lamp must never sit inside its own occluder, so its pole and head never cast.
    const shadowLamp = cfg.id === this.shadowLampId;
    const pole = new Mesh(new CylinderGeometry(0.06, 0.08, 1, 8), lampMat);
    pole.castShadow = !shadowLamp;
    const lampColor = new Color(cfg.color);
    const head = new Mesh(
      new BoxGeometry(0.34, 0.18, 0.34),
      new MeshBasicMaterial({ color: lampColor.clone().multiplyScalar(1.4) }),
    );
    head.castShadow = !shadowLamp;
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
        new MeshBasicMaterial({ color: lampColor.clone().multiplyScalar(4.2) }),
      );
      group.add(beam);
    } else {
      light = new PointLight(new Color(cfg.color), cfg.intensity * 55, cfg.range, 2);
    }
    if (shadowLamp) {
      // Set once; applyProfile only toggles castShadow. A spotlight derives its shadow camera angle from the cone.
      light.shadow.mapSize.set(LAMP_SHADOW.mapSize, LAMP_SHADOW.mapSize);
      light.shadow.bias = LAMP_SHADOW.bias;
      light.shadow.normalBias = LAMP_SHADOW.normalBias;
      light.shadow.radius = LAMP_SHADOW.radius;
      // The shadow camera's far plane is not set here: three rewrites it from light.distance every frame.
      light.shadow.camera.near = 0.1;
    }
    const glow = createBeam(new Color(cfg.color));
    group.add(pole, head, light, glow.cone, glow.halo);
    pole.scale.y = Math.max(0.4, cfg.position[1]) - 0.09;
    pole.position.y = -pole.scale.y / 2;
    return { cfg, group, pole, head, beam, glow, light, target };
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
    const ring = new Mesh(
      new TorusGeometry(0.22, 0.012, 8, 28),
      new MeshBasicMaterial({
        color: 0x5ce1ff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.14;
    const icon = new Mesh(
      new BoxGeometry(0.08, 0.08, 0.02),
      new MeshStandardMaterial({ color: 0x9af6ff, emissive: 0x39e7ff, emissiveIntensity: 3.0, roughness: 0.25 }),
    );
    icon.position.y = 1.14;
    group.add(base, button, ring, icon);
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

  private ensureEnv(): void {
    if (!this.profile?.envMap || this.env || !this.gl) return;
    this.env = buildEnvMap(this.gl);
    lab.applyEnv(this.env);
    this.scene.environment = this.env;
    this.scene.environmentIntensity = LIGHTING.env;
  }

  private mountDressing(): void {
    if (this.dressing) {
      this.root.remove(this.dressing);
      disposeObject(this.dressing);
      this.dressing = null;
    }
    this.pillars = [];
    if (!this.bounds || !Number.isFinite(this.bounds.minX)) return;
    const kit = envKit();
    this.dressingKit = kit !== null;
    this.dressing = buildDressing(this.bounds, this.dressingDetail, lab, kit, this.config);
    this.root.add(this.dressing);
    this.dressing.traverse((child) => {
      if (child.userData.pillar) this.pillars.push(child as Mesh);
    });
  }

  /** Slab-edge lips with accent-tinted trim: high dressing detail and a loaded forge kit only. Rebuilt on detail and kit changes. */
  private mountRims(): void {
    this.clearRims();
    const forge = forgeKit();
    if (!this.config || !forge || this.dressingDetail !== 'high') return;
    try {
      this.rims = buildForgeRims(forge, this.config.platforms, this.accent);
    } catch (error) {
      console.error('[ForgeKit] failed to build the slab rims; leaving the slab edges bare.', error);
    }
    if (this.rims) this.root.add(this.rims);
  }

  /** Disposes the merged rim geometry and the per-level trim clone; the kit's own resources are skipped. */
  private clearRims(): void {
    if (!this.rims) return;
    this.root.remove(this.rims);
    disposeObject(this.rims);
    this.rims = null;
  }

  /** Hide a pillar that sits between the camera and the player, so it cannot fill the screen. */
  fadeOccluders(cam: Vector3, fx: number, fz: number, dt: number): void {
    const ax = fx - cam.x;
    const az = fz - cam.z;
    const len2 = ax * ax + az * az;
    for (const pillar of this.pillars) {
      const mats = (Array.isArray(pillar.material) ? pillar.material : [pillar.material]) as MeshStandardMaterial[];
      const mat = mats[0];
      let t = 0;
      if (len2 > 1e-6) {
        t = ((pillar.position.x - cam.x) * ax + (pillar.position.z - cam.z) * az) / len2;
        t = Math.max(0, Math.min(1, t));
      }
      const dist = Math.hypot(pillar.position.x - (cam.x + ax * t), pillar.position.z - (cam.z + az * t));
      const target = dist < 0.73 ? 0 : 1;
      const delta = target - mat.opacity;
      const opacity = mat.opacity + Math.sign(delta) * Math.min(Math.abs(delta), 8 * dt);
      const solid = opacity > 0.99;
      for (const entry of mats) {
        entry.opacity = opacity;
        if (entry.transparent === solid) {
          entry.transparent = !solid;
          entry.needsUpdate = true;
        }
        entry.depthWrite = solid;
      }
      const shown = opacity > 0.02;
      pillar.visible = shown;
      pillar.castShadow = shown;
    }
  }

  private buildMenu(): void {
    const floor = new Mesh(worldUvBox(9, 0.4, 6, 2), floorMat);
    floor.position.y = -0.2;
    floor.receiveShadow = true;
    const monument = new Mesh(new BoxGeometry(0.72, 1.7, 0.72), stone);
    monument.position.set(-0.15, 0.85, 0.15);
    monument.castShadow = true;
    const plateMat = trimMat.clone();
    plateMat.emissive = new Color(0x39e7ff);
    plateMat.emissiveIntensity = 1.5;
    const plate = new Mesh(new BoxGeometry(2.6, 0.06, 1.35), plateMat);
    plate.position.set(1.45, 0.05, 0);
    const rig = new Group();
    rig.position.set(-1.7, 2.45, 0.35);
    const lamp = new Mesh(
      new BoxGeometry(0.28, 0.14, 0.28),
      new MeshStandardMaterial({ color: 0xffd2a1, emissive: 0xffb15a, emissiveIntensity: 2, roughness: 0.3 }),
    );
    const light = new PointLight(0xffd2a1, 1600, 12, 2);
    const glow = createBeam(new Color(0xffb15a));
    rig.add(lamp, light, glow.cone, glow.halo);
    aimBeam(glow, new Vector3(3.15, -2.35, -0.35), 3.8, 1);
    const underglow = new DirectionalLight(LIGHTING.underColor, LIGHTING.under);
    underglow.position.set(3, -12, 4);
    underglow.castShadow = false;
    this.menu.add(floor, monument, plate, rig, underglow);
    this.menu.position.set(0, 0.15, 0);
  }
}

function railLine(points: Vector3[]): Line {
  return new Line(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: 0x5ce1ff }));
}

function disposeObject(object: Object3D): void {
  const kit = envKit();
  const forge = forgeKit();
  const owned = (resource: BufferGeometry | Material) => kit?.owns(resource) || forge?.owns(resource);
  object.traverse((child: Object3D) => {
    const mesh = child as Mesh;
    if ((mesh as InstancedMesh).isInstancedMesh) (mesh as InstancedMesh).dispose();
    if (mesh.geometry && !owned(mesh.geometry)) mesh.geometry.dispose();
    const material = mesh.material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const entry of list) {
      if (!sharedMaterials.has(entry) && !owned(entry)) entry.dispose();
    }
  });
}

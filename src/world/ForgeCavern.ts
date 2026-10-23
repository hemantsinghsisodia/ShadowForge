import { BackSide, Color, Group, Mesh, PlaneGeometry, ShaderMaterial, SphereGeometry, type BufferGeometry, type Vector3 } from 'three';
import { Embers, seedEmbers } from '../effects/Embers';
import { DOME_FRAG, DOME_VERT, MOLTEN_FRAG, MOLTEN_VERT } from './CavernShaders';
import { ABYSS_Y, CAVERN, FORGE, moltenPulse } from './ForgePalette';

export type CavernDetail = 'low' | 'medium' | 'high';
export interface CavernBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const MENU_BOUNDS: CavernBounds = { minX: -4.5, maxX: 4.5, minZ: -3, maxZ: 3 };
export { ABYSS_Y };

const DOME_RADIUS = 150;
const EMBER_SEED = 1337;
const NUMERIC_KEYS = ['crackHdr', 'glow', 'flow', 'fogDensity'] as const;

/** The forge cavern around the level: a dome that rides the camera and a molten abyss under the floor. */
export class ForgeCavern {
  /** World space: the abyss (and later embers and structures). */
  readonly group = new Group();
  /** Follows the camera. */
  readonly dome = new Group();
  private detail: CavernDetail;
  private bounds: CavernBounds = MENU_BOUNDS;
  private readonly domeMesh: Mesh;
  private readonly abyssMesh: Mesh;
  private embers: Embers | null = null;
  private emberCount = 0;
  private emberBounds: CavernBounds | null = null;
  private time = 0;
  private pixelRatio = 1;
  // Shared by every material the tiers build, so time, pulse and tuning survive a rebuild.
  private readonly uniforms = {
    uTime: { value: 0 },
    uPulse: { value: 1 },
    uFlow: { value: CAVERN.flow },
    uGlow: { value: CAVERN.glow },
    uCrackHdr: { value: CAVERN.crackHdr },
    uCrust: { value: new Color(FORGE.crust) },
    uGlowCol: { value: new Color(FORGE.glow) },
    uCrackCol: { value: new Color(FORGE.crack) },
    uHaze: { value: new Color(FORGE.haze) },
    uTop: { value: new Color(FORGE.top) },
  };

  constructor() {
    this.group.name = 'cavern';
    this.dome.name = 'cavern-dome';
    this.detail = 'medium';

    this.domeMesh = new Mesh(this.domeGeometry(this.detail), this.domeMaterial(this.detail));
    this.domeMesh.frustumCulled = false;
    this.domeMesh.renderOrder = -1;
    this.dome.add(this.domeMesh);

    this.abyssMesh = new Mesh(new PlaneGeometry(1, 1), this.abyssMaterial(this.detail));
    this.abyssMesh.name = 'abyss';
    this.group.add(this.abyssMesh);
    this.mount(this.bounds);
  }

  /** Rebuilds the tier-dependent resources only when the detail changes. */
  setDetail(detail: CavernDetail, embers: number): void {
    this.emberCount = Math.max(0, Math.floor(embers));
    this.syncEmbers();
    if (detail === this.detail) return;
    this.detail = detail;
    this.domeMesh.geometry.dispose();
    (this.domeMesh.material as ShaderMaterial).dispose();
    this.domeMesh.geometry = this.domeGeometry(detail);
    this.domeMesh.material = this.domeMaterial(detail);
    (this.abyssMesh.material as ShaderMaterial).dispose();
    this.abyssMesh.material = this.abyssMaterial(detail);
  }

  /** Sizes and centres the abyss for a level, or for the menu. */
  mount(bounds: CavernBounds): void {
    const { minX, maxX, minZ, maxZ } = bounds;
    if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) return;
    this.bounds = bounds;
    this.abyssMesh.geometry.dispose();
    const geometry = new PlaneGeometry(maxX - minX + 120, maxZ - minZ + 100);
    geometry.rotateX(-Math.PI / 2);
    this.abyssMesh.geometry = geometry;
    this.abyssMesh.position.set((minX + maxX) / 2, ABYSS_Y, (minZ + maxZ) / 2);
    this.syncEmbers();
  }

  follow(camera: Vector3): void {
    this.dome.position.copy(camera);
  }

  setPixelRatio(dpr: number): void {
    this.pixelRatio = dpr;
    this.embers?.setPixelRatio(dpr);
  }

  update(time: number): void {
    this.time = time;
    this.embers?.setTime(time);
    this.uniforms.uTime.value = time % 600;
    this.uniforms.uPulse.value = moltenPulse(time);
  }

  /** Live tuning hook (__SF.cavern): merges finite numbers and booleans into CAVERN and pushes the uniforms. */
  tune(partial: Partial<typeof CAVERN>): typeof CAVERN {
    for (const key of NUMERIC_KEYS) {
      const value = partial[key];
      if (typeof value === 'number' && Number.isFinite(value)) CAVERN[key] = value;
    }
    if (typeof partial.embers === 'boolean') CAVERN.embers = partial.embers;
    if (this.embers) this.embers.points.visible = CAVERN.embers;
    this.uniforms.uCrackHdr.value = CAVERN.crackHdr;
    this.uniforms.uGlow.value = CAVERN.glow;
    this.uniforms.uFlow.value = CAVERN.flow;
    return { ...CAVERN };
  }

  /** Rebuilds the embers only when the count or the bounds they were seeded for have changed. */
  private syncEmbers(): void {
    const b = this.bounds;
    const e = this.emberBounds;
    const same = e !== null && e.minX === b.minX && e.maxX === b.maxX && e.minZ === b.minZ && e.maxZ === b.maxZ;
    const built = this.embers ? this.embers.points.geometry.getAttribute('position').count : 0;
    if (same && built === this.emberCount) return;
    if (this.embers) {
      this.group.remove(this.embers.points);
      this.embers.dispose();
      this.embers = null;
    }
    this.emberBounds = { ...b };
    if (this.emberCount <= 0) return;
    this.embers = new Embers(seedEmbers(this.emberCount, b, EMBER_SEED));
    this.embers.setTime(this.time);
    this.embers.setPixelRatio(this.pixelRatio);
    this.embers.points.visible = CAVERN.embers;
    this.group.add(this.embers.points);
  }

  private domeGeometry(detail: CavernDetail): BufferGeometry {
    return detail === 'low' ? new SphereGeometry(DOME_RADIUS, 24, 12) : new SphereGeometry(DOME_RADIUS, 32, 16);
  }

  private domeMaterial(detail: CavernDetail): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: this.uniforms,
      defines: detail === 'low' ? {} : { ROCK: 1 },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
  }

  private abyssMaterial(detail: CavernDetail): ShaderMaterial {
    const defines: Record<string, number> = { OCTAVES: detail === 'low' ? 1 : detail === 'medium' ? 2 : 3 };
    if (detail === 'high') defines.WARP = 1;
    return new ShaderMaterial({
      uniforms: this.uniforms,
      defines,
      vertexShader: MOLTEN_VERT,
      fragmentShader: MOLTEN_FRAG,
      fog: false,
    });
  }
}

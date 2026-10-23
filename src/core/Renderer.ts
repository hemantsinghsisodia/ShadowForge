import {
  ACESFilmicToneMapping,
  HalfFloatType,
  PCFSoftShadowMap,
  SRGBColorSpace,
  WebGLRenderTarget,
  WebGLRenderer,
  type Scene,
  type Camera,
  type ShaderMaterial,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Vector2 } from 'three';
import { applyPunch, gradeShader, ZERO_PUNCH, type Punch, type PunchResult } from '../effects/PostFX';
import type { QualityProfile } from '../settings/Settings';
import { FORGE } from '../world/ForgePalette';

/** Soft knee of the bloom high-pass; wide enough that the cut-off does not pop. */
const BLOOM_KNEE = 0.8;

export class Renderer {
  readonly renderer: WebGLRenderer;
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private base = { exposure: 1.08, bloom: 0, ca: 0 };
  private punchState: Readonly<Punch> = ZERO_PUNCH;
  private readonly scratch: PunchResult = { exposure: 0, bloom: 0, ca: 0, flash: 0 };
  private bloomScale = 1;
  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    const probe = document.createElement('canvas');
    const supported = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!supported) throw new Error('webgl-unavailable');
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!this.renderer.getContext()) throw new Error('webgl-unavailable');
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(FORGE.top, 1);
  }

  applyQuality(profile: QualityProfile): void {
    const dpr = Math.min(window.devicePixelRatio || 1, profile.dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = profile.shadowMapSize > 0;
    this.base.exposure = profile.exposure;
    this.renderer.toneMappingExposure = profile.exposure;
    this.resize();
  }

  /** Pixel ratio the scene is actually rendered at: the composer runs at reduced scale when bloom uses it. */
  effectivePixelRatio(): number {
    const dpr = this.renderer.getPixelRatio();
    return this.composer ? dpr * this.bloomScale : dpr;
  }

  resize(): void {
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.renderer.setSize(this.width, this.height, false);
    if (!this.composer) return;
    this.composer.setSize(this.width, this.height);
    this.composer.setPixelRatio(this.renderer.getPixelRatio() * this.bloomScale);
  }

  /** Bloom plus the vignette grade. Either one turns the composer on. */
  setPresentation(profile: QualityProfile, scene: Scene, camera: Camera): void {
    this.bloomScale = profile.bloom ? profile.bloomScale : 1;
    this.base.bloom = profile.bloomStrength;
    this.base.ca = profile.chromatic;
    this.punchState = ZERO_PUNCH;
    if (this.composer) {
      // EffectComposer.dispose() does not dispose its passes in r170.
      for (const pass of this.composer.passes) (pass as { dispose?: () => void }).dispose?.();
      this.composer.dispose();
    }
    this.bloom = null;
    if (!profile.bloom && !profile.postFx) {
      this.composer = null;
      this.grade = null;
      return;
    }
    const target = new WebGLRenderTarget(this.width, this.height, { type: HalfFloatType });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    if (profile.bloom) {
      const bloom = new UnrealBloomPass(
        new Vector2(this.width, this.height),
        profile.bloomStrength,
        profile.bloomRadius,
        profile.bloomThreshold,
      );
      bloom.materialHighPassFilter.uniforms.smoothWidth.value = BLOOM_KNEE;
      const high = (bloom as unknown as { materialHighPassFilter: ShaderMaterial }).materialHighPassFilter;
      high.fragmentShader = high.fragmentShader.replace(
        'vec4 texel = texture2D( tDiffuse, vUv );',
        `vec4 texel = texture2D( tDiffuse, vUv );
        texel.rgb = vec3(
          texel.r == texel.r ? texel.r : 0.0,
          texel.g == texel.g ? texel.g : 0.0,
          texel.b == texel.b ? texel.b : 0.0);
        texel.rgb = min(max(texel.rgb, vec3(0.0)), vec3(64.0));`,
      );
      high.needsUpdate = true;
      composer.addPass(bloom);
      this.bloom = bloom;
    }
    // Always present with a composer: the flash and chromatic aberration live here, and it keeps the swap count even.
    this.grade = new ShaderPass(gradeShader);
    this.grade.uniforms.amount.value = profile.postFx ? 1 : 0;
    this.grade.uniforms.ca.value = profile.chromatic;
    composer.addPass(this.grade);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.resize();
    const dpr = this.renderer.getPixelRatio();
    const samples = Math.min(dpr >= 2 ? Math.min(profile.msaa, 2) : profile.msaa, this.renderer.capabilities.maxSamples);
    if (samples > 0) {
      // The grade pass is always present and, with the output pass, swaps buffers twice, so every frame starts on the multisampled buffer.
      const current = composer.renderTarget2;
      const sampled = new WebGLRenderTarget(current.width, current.height, { type: HalfFloatType, samples });
      current.dispose();
      composer.renderTarget2 = sampled;
      composer.readBuffer = sampled;
    }
  }

  /**
   * Add a transient hit on top of the tier base. It lasts until the next punch or presentation rebuild.
   * The reference is kept and read every frame, so pass a fresh object or a frozen one; never mutate it afterwards.
   */
  punch(p: Readonly<Punch>): void {
    this.punchState = p;
  }

  /** Debug: retune the live bloom pass. Later punches add to the tuned strength. */
  tuneBloom(strength: number, radius: number, threshold: number): void {
    this.base.bloom = strength;
    if (!this.bloom) return;
    this.bloom.strength = strength;
    this.bloom.radius = radius;
    this.bloom.threshold = threshold;
  }

  render(scene: Scene, camera: Camera): void {
    const out = applyPunch(this.base, this.punchState, this.scratch);
    this.renderer.toneMappingExposure = out.exposure;
    if (this.bloom) this.bloom.strength = out.bloom;
    if (this.grade) {
      const u = this.grade.uniforms;
      u.time.value = performance.now() * 0.001;
      u.ca.value = out.ca;
      u.flash.value = out.flash;
      u.flashColor.value.setHex(this.punchState.flashColor ?? 0xffffff);
    }
    if (this.composer) {
      const pass = this.composer.passes[0];
      if (pass && 'camera' in pass) (pass as { camera: Camera }).camera = camera;
      this.composer.render();
      return;
    }
    this.renderer.render(scene, camera);
  }
}

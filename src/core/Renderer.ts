import {
  ACESFilmicToneMapping,
  HalfFloatType,
  PCFSoftShadowMap,
  SRGBColorSpace,
  WebGLRenderTarget,
  WebGLRenderer,
  type Scene,
  type Camera,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Vector2 } from 'three';
import { gradeShader } from '../effects/PostFX';
import type { QualityProfile } from '../settings/Settings';

export class Renderer {
  readonly renderer: WebGLRenderer;
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
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
    this.renderer.setClearColor(0x07080e, 1);
  }

  applyQuality(profile: QualityProfile): void {
    const dpr = Math.min(window.devicePixelRatio || 1, profile.dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = profile.shadowMapSize > 0;
    this.renderer.toneMappingExposure = profile.postFx ? 1.08 : 1.02;
    this.resize();
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
    this.composer?.dispose();
    if (!profile.bloom && !profile.postFx) {
      this.composer = null;
      this.grade = null;
      return;
    }
    const target = new WebGLRenderTarget(this.width, this.height, { type: HalfFloatType });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    if (profile.bloom) {
      composer.addPass(new UnrealBloomPass(new Vector2(this.width, this.height), 0.12, 0.4, 0.94));
    }
    if (profile.postFx) {
      this.grade = new ShaderPass(gradeShader);
      composer.addPass(this.grade);
    } else {
      this.grade = null;
    }
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.resize();
    const dpr = this.renderer.getPixelRatio();
    const samples = Math.min(dpr >= 2 ? Math.min(profile.msaa, 2) : profile.msaa, this.renderer.capabilities.maxSamples);
    if (samples > 0) {
      // The grade pass and the output pass each swap buffers once, so every frame starts on the multisampled buffer.
      const current = composer.renderTarget2;
      const sampled = new WebGLRenderTarget(current.width, current.height, { type: HalfFloatType, samples });
      current.dispose();
      composer.renderTarget2 = sampled;
      composer.readBuffer = sampled;
    }
  }

  render(scene: Scene, camera: Camera): void {
    if (this.grade) this.grade.uniforms.time.value = performance.now() * 0.001;
    if (this.composer) {
      const pass = this.composer.passes[0];
      if (pass && 'camera' in pass) (pass as { camera: Camera }).camera = camera;
      this.composer.render();
      return;
    }
    this.renderer.render(scene, camera);
  }
}

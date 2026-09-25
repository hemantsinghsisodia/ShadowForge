import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
  type Scene,
  type Camera,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Vector2 } from 'three';
import type { QualityProfile } from '../settings/Settings';

export class Renderer {
  readonly renderer: WebGLRenderer;
  private composer: EffectComposer | null = null;
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
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(0x07080e, 1);
  }

  applyQuality(profile: QualityProfile): void {
    const dpr = Math.min(window.devicePixelRatio || 1, profile.dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = profile.shadowMapSize > 0;
    this.resize();
  }

  resize(): void {
    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer) this.composer.setSize(this.width, this.height);
  }

  setBloom(enabled: boolean, scene: Scene, camera: Camera): void {
    if (!enabled) {
      this.composer = null;
      return;
    }
    const size = new Vector2(this.width, this.height);
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(size, 0.12, 0.4, 0.94));
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.resize();
  }

  render(scene: Scene, camera: Camera): void {
    if (this.composer) {
      const pass = this.composer.passes[0];
      if (pass && 'camera' in pass) (pass as { camera: Camera }).camera = camera;
      this.composer.render();
      return;
    }
    this.renderer.render(scene, camera);
  }
}

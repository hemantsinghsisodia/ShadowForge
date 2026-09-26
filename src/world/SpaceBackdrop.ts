import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  Points,
  RepeatWrapping,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from 'three';

export type SkyDetail = 'low' | 'medium' | 'high';

const SKY_RADIUS = 150;
const PLANET_DISTANCE = 120;
// The resting camera looks down, so this sits in the sky it can see and still clears the far walls.
const PLANET_ELEVATION = (8 * Math.PI) / 180;
const PLANET_RADIUS = 30;

const skyShader = {
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vDir;
    void main() {
      vUv = uv;
      vDir = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    varying vec3 vDir;
    uniform sampler2D map;
    uniform vec3 horizon;
    void main() {
      vec3 sky = texture2D(map, vUv).rgb;
      float above = smoothstep(-0.12, 0.05, normalize(vDir).y);
      gl_FragColor = vec4(mix(horizon, sky, above), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

const bodyShader = {
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormalW;
    varying vec3 vWorld;
    void main() {
      vUv = uv;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      vNormalW = mat3(modelMatrix) * normal;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    varying vec3 vNormalW;
    varying vec3 vWorld;
    uniform sampler2D bands;
    uniform vec3 accent;
    uniform float rim;
    void main() {
      vec3 n = normalize(vNormalW);
      float ndl = dot(n, normalize(vec3(-0.55, 0.62, 0.28)));
      float light = smoothstep(-0.05, 0.4, ndl);
      vec3 albedo = texture2D(bands, vUv).rgb;
      vec3 col = albedo * (0.1 + 0.9 * light);
      vec3 viewDir = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 2.4);
      col += accent * fres * rim;
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

const starShader = {
  vertexShader: `
    attribute float aSize;
    attribute float aPhase;
    attribute float aSpeed;
    varying float vPhase;
    varying float vSpeed;
    void main() {
      vPhase = aPhase;
      vSpeed = aSpeed;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * (170.0 / max(-mv.z, 1.0));
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying float vPhase;
    varying float vSpeed;
    uniform float time;
    void main() {
      vec2 p = gl_PointCoord - 0.5;
      float d = dot(p, p);
      if (d > 0.25) discard;
      float tw = 0.55 + 0.45 * sin(time * vSpeed + vPhase);
      float glow = smoothstep(0.25, 0.02, d);
      gl_FragColor = vec4(vec3(0.75, 0.84, 1.0) * tw * glow * 0.36, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

const ringShader = {
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D bands;
    uniform vec3 accent;
    void main() {
      vec4 band = texture2D(bands, vUv);
      gl_FragColor = vec4(mix(vec3(0.72, 0.66, 0.55), accent, 0.25), band.a * 0.55);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

function rand(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  paint(ctx, width, height);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function paintSky(ctx: CanvasRenderingContext2D, w: number, h: number, denseStars: boolean): void {
  const wash = ctx.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, '#100818');
  wash.addColorStop(0.35, '#12102a');
  wash.addColorStop(0.62, '#0c1428');
  wash.addColorStop(1, '#080a10');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);
  const clouds: [number, number, number, string][] = [
    [0.18, 0.46, 0.22, '110, 70, 190'],
    [0.4, 0.4, 0.2, '40, 110, 200'],
    [0.62, 0.48, 0.18, '40, 170, 170'],
    [0.84, 0.43, 0.16, '140, 80, 170'],
  ];
  for (const [u, v, radius, rgb] of clouds) {
    const blob = ctx.createRadialGradient(u * w, v * h, 0, u * w, v * h, radius * w);
    blob.addColorStop(0, `rgba(${rgb}, 0.72)`);
    blob.addColorStop(0.4, `rgba(${rgb}, 0.28)`);
    blob.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = blob;
    ctx.fillRect(0, 0, w, h);
  }
  const next = rand(denseStars ? 11 : 29);
  const count = denseStars ? 1400 : 700;
  for (let i = 0; i < count; i++) {
    const x = next() * w;
    const y = next() * h * 0.72;
    const bright = next();
    const size = bright > 0.96 ? 2 : 1;
    const g = Math.floor(180 + bright * 70);
    ctx.fillStyle = `rgba(${g}, ${g + 8}, 255, ${0.35 + bright * 0.6})`;
    ctx.fillRect(x, y, size, size);
  }
}

function paintBands(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const next = rand(7);
  const wash = ctx.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, '#1f6f96');
  wash.addColorStop(0.14, '#f0c14a');
  wash.addColorStop(0.27, '#d2652e');
  wash.addColorStop(0.4, '#f3d7a2');
  wash.addColorStop(0.52, '#6a3d96');
  wash.addColorStop(0.66, '#e8b15a');
  wash.addColorStop(0.8, '#1e7a78');
  wash.addColorStop(1, '#245f92');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const band = 0.5 + 0.5 * Math.sin(t * 48);
    ctx.fillStyle = `rgba(20, 12, 8, ${band * 0.14})`;
    ctx.fillRect(0, y, w, 1);
  }
  for (let i = 0; i < 28; i++) {
    ctx.fillStyle = `rgba(255, 244, 220, ${0.08 + next() * 0.12})`;
    ctx.fillRect(next() * w, next() * h, 16 + next() * 70, 1 + next() * 2);
  }
}

function paintMoon(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const next = rand(3);
  ctx.fillStyle = '#9aa3b0';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 18; i++) {
    const shade = Math.floor(90 + next() * 50);
    ctx.fillStyle = `rgb(${shade}, ${shade + 4}, ${shade + 10})`;
    ctx.beginPath();
    ctx.arc(next() * w, next() * h, 2 + next() * 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintRing(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const band = 0.5 + Math.sin(t * 34) * 0.5;
    const gap = t > 0.42 && t < 0.5 ? 0.15 : 1;
    const alpha = (0.2 + band * 0.65) * gap;
    ctx.fillStyle = `rgba(230, 214, 186, ${alpha})`;
    ctx.fillRect(0, y, w, 1);
  }
}

/** Distant sky, planet and stars. The group is kept on the camera so it never gets closer. */
export class SpaceBackdrop {
  readonly group = new Group();
  private detail: SkyDetail | null = null;
  private readonly horizon = new Color(0x07080e);
  private readonly accent = new Color(0x9eb6ff);
  private readonly disposable: { dispose(): void }[] = [];
  private planet: Mesh | null = null;
  private rings: Mesh | null = null;
  private moonPivot: Group | null = null;
  private starMat: ShaderMaterial | null = null;

  constructor() {
    this.group.frustumCulled = false;
    this.group.name = 'space';
  }

  setDetail(detail: SkyDetail): void {
    if (this.detail === detail) return;
    this.clear();
    this.detail = detail;
    this.build(detail);
  }

  setTint(accent: Color, horizon: Color): void {
    this.accent.copy(accent);
    this.horizon.copy(horizon);
  }

  follow(position: Vector3): void {
    this.group.position.copy(position);
  }

  update(dt: number): void {
    if (this.planet) this.planet.rotation.y += dt * 0.01;
    if (this.rings) this.rings.rotation.y += dt * 0.006;
    if (this.moonPivot) this.moonPivot.rotation.y += dt * 0.045;
    if (this.starMat) this.starMat.uniforms.time.value += dt;
  }

  private build(detail: SkyDetail): void {
    const high = detail === 'high';
    const skySize = high ? [2048, 1024] : [1024, 512];
    const skyMap = this.keep(canvasTexture(skySize[0], skySize[1], (ctx, w, h) => paintSky(ctx, w, h, detail === 'low')));
    skyMap.wrapS = RepeatWrapping;
    const skyMat = this.keep(new ShaderMaterial({
      uniforms: { map: { value: skyMap }, horizon: { value: this.horizon } },
      vertexShader: skyShader.vertexShader,
      fragmentShader: skyShader.fragmentShader,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    }));
    const sky = new Mesh(this.keep(new SphereGeometry(SKY_RADIUS, high ? 48 : 32, high ? 32 : 20)), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.group.add(sky);

    const planetSeg = high ? [64, 48] : detail === 'medium' ? [40, 28] : [24, 16];
    const bands = this.keep(canvasTexture(256, 128, paintBands));
    bands.wrapS = RepeatWrapping;
    const planetMat = this.bodyMaterial(bands, 0.32);
    const planet = new Mesh(this.keep(new SphereGeometry(PLANET_RADIUS, planetSeg[0], planetSeg[1])), planetMat);
    planet.position.set(Math.cos(PLANET_ELEVATION) * PLANET_DISTANCE, Math.sin(PLANET_ELEVATION) * PLANET_DISTANCE, 0);
    planet.frustumCulled = false;
    this.planet = planet;
    this.group.add(planet);

    if (detail !== 'low') {
      const count = high ? 600 : 250;
      this.group.add(this.twinkles(count));
    }
    if (!high) return;

    const ringMap = this.keep(canvasTexture(4, 64, paintRing));
    const ringMat = this.keep(new ShaderMaterial({
      uniforms: { bands: { value: ringMap }, accent: { value: this.accent } },
      vertexShader: ringShader.vertexShader,
      fragmentShader: ringShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    }));
    const rings = new Mesh(this.keep(new RingGeometry(36, 54, 72)), ringMat);
    rings.position.copy(planet.position);
    rings.rotation.x = 1.15;
    rings.rotation.z = 0.35;
    rings.frustumCulled = false;
    rings.renderOrder = 2;
    this.rings = rings;
    this.group.add(rings);

    const moonMap = this.keep(canvasTexture(64, 64, paintMoon));
    const moon = new Mesh(this.keep(new SphereGeometry(3.4, 20, 14)), this.bodyMaterial(moonMap, 0.12));
    moon.position.set(68, 9, 18);
    moon.frustumCulled = false;
    const pivot = new Group();
    pivot.position.copy(planet.position);
    pivot.add(moon);
    this.moonPivot = pivot;
    this.group.add(pivot);
  }

  private bodyMaterial(bands: Texture, rim: number): ShaderMaterial {
    return this.keep(new ShaderMaterial({
      uniforms: {
        bands: { value: bands },
        accent: { value: this.accent },
        rim: { value: rim },
      },
      vertexShader: bodyShader.vertexShader,
      fragmentShader: bodyShader.fragmentShader,
      fog: false,
    }));
  }

  private twinkles(count: number): Points {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const next = rand(19);
    for (let i = 0; i < count; i++) {
      const y = next() * 0.92 + 0.04;
      const theta = next() * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const radius = 145;
      positions[i * 3] = Math.cos(theta) * ring * radius;
      positions[i * 3 + 1] = y * radius;
      positions[i * 3 + 2] = Math.sin(theta) * ring * radius;
      sizes[i] = 1.1 + next() * 1.8;
      phases[i] = next() * Math.PI * 2;
      speeds[i] = 0.6 + next() * 1.8;
    }
    const geometry = this.keep(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));
    geometry.setAttribute('aSpeed', new BufferAttribute(speeds, 1));
    const material = this.keep(new ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: starShader.vertexShader,
      fragmentShader: starShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    }));
    this.starMat = material;
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 1;
    return points;
  }

  private keep<T extends { dispose(): void }>(resource: T): T {
    this.disposable.push(resource);
    return resource;
  }

  private clear(): void {
    for (const child of [...this.group.children]) this.group.remove(child);
    for (const resource of this.disposable) resource.dispose();
    this.disposable.length = 0;
    this.planet = null;
    this.rings = null;
    this.moonPivot = null;
    this.starMat = null;
  }
}

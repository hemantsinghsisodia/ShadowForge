import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, PointsMaterial, type Scene } from 'three';

export class ParticleManager {
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry: BufferGeometry;
  private readonly points: Points;
  private cursor = 0;
  budget: number;

  constructor(scene: Scene, budget: number) {
    this.budget = budget;
    const cap = 240;
    this.positions = new Float32Array(cap * 3);
    this.velocities = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.colors = new Float32Array(cap * 3);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    const material = new PointsMaterial({
      size: 0.08,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setBudget(budget: number): void {
    this.budget = budget;
  }

  burst(x: number, y: number, z: number, count: number, hex: number): void {
    const color = new Color(hex);
    const n = Math.min(count, this.budget);
    for (let i = 0; i < n; i++) {
      const index = this.cursor % 240;
      this.cursor++;
      const o = index * 3;
      this.positions[o] = x + (Math.random() - 0.5) * 0.4;
      this.positions[o + 1] = y + Math.random() * 0.3;
      this.positions[o + 2] = z + (Math.random() - 0.5) * 0.4;
      this.velocities[o] = (Math.random() - 0.5) * 1.6;
      this.velocities[o + 1] = 0.6 + Math.random() * 1.4;
      this.velocities[o + 2] = (Math.random() - 0.5) * 1.6;
      this.colors[o] = color.r;
      this.colors[o + 1] = color.g;
      this.colors[o + 2] = color.b;
      this.life[index] = 0.45 + Math.random() * 0.45;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < 240; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      this.velocities[o + 1] -= 2.2 * dt;
      this.positions[o] += this.velocities[o] * dt;
      this.positions[o + 1] += this.velocities[o + 1] * dt;
      this.positions[o + 2] += this.velocities[o + 2] * dt;
      if (this.life[i] <= 0) this.positions[o + 1] = -999;
    }
    const position = this.geometry.getAttribute('position') as BufferAttribute;
    position.needsUpdate = true;
  }
}

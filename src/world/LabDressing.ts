import { BackSide, BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { LabMaterials } from './Materials';

export interface RoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Static lab shell: panels, pipes, a ceiling grid and a glowing pit. */
export function buildDressing(bounds: RoomBounds, detail: 'low' | 'high', mats: LabMaterials, accent: Color): Group {
  const root = new Group();
  const { minX, maxX, minZ, maxZ } = bounds;
  if (!Number.isFinite(minX)) return root;
  const width = Math.max(8, maxX - minX);
  const depth = Math.max(6, maxZ - minZ);
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;

  const dome = new Mesh(
    new SphereGeometry(Math.max(width, depth) * 0.85, 24, 16),
    new MeshBasicMaterial({ color: accent.clone().multiplyScalar(0.08).add(new Color(0x07080e)), side: BackSide }),
  );
  dome.position.set(midX, 2, midZ);
  root.add(dome);

  const abyss = new Mesh(
    new BoxGeometry(width + 24, 0.4, depth + 16),
    new MeshBasicMaterial({ color: accent.clone().multiplyScalar(0.15) }),
  );
  abyss.position.set(midX, -7.2, midZ);
  root.add(abyss);

  const pipeMat = mats.lamp;
  const span = depth + 1;
  const step = detail === 'high' ? 6 : 12;
  for (let x = minX + 2; x < maxX; x += step) {
    const beam = new Mesh(new BoxGeometry(0.16, 0.12, span), pipeMat);
    beam.position.set(x, 6.4, midZ);
    beam.castShadow = detail === 'high';
    root.add(beam);
    if (detail === 'high') {
      const glow = new Mesh(new BoxGeometry(0.04, 0.02, span), mats.trim);
      glow.position.set(x, 6.32, midZ);
      root.add(glow);
    }
  }

  if (detail === 'high') {
    const wallH = 5.2;
    const panels: [number, number, number, number, number, number][] = [
      [midX, wallH / 2, minZ - 0.3, width, wallH, 0.12],
      [midX, wallH / 2, maxZ + 0.3, width, wallH, 0.12],
    ];
    for (const [x, y, z, w, h, d] of panels) {
      const panel = new Mesh(new BoxGeometry(w, h, d), mats.wall);
      panel.position.set(x, y, z);
      panel.receiveShadow = true;
      root.add(panel);
    }
    for (let x = minX + 4; x < maxX; x += 10) {
      for (const z of [minZ + 0.6, maxZ - 0.6]) {
        const pillar = new Mesh(new CylinderGeometry(0.22, 0.28, 6.2, 8), mats.stone);
        pillar.position.set(x, 3.1, z);
        pillar.castShadow = true;
        root.add(pillar);
      }
    }
    const cable = new Mesh(new CylinderGeometry(0.04, 0.04, width, 6), mats.trim);
    cable.rotation.z = Math.PI / 2;
    cable.position.set(midX, 5.4, minZ + 0.4);
    root.add(cable);
  }
  return root;
}

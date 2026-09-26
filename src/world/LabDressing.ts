import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import type { LabMaterials } from './Materials';

export interface RoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Floor-edge dressing: a glowing pit under the room and pillars along the sides. */
export function buildDressing(bounds: RoomBounds, detail: 'low' | 'high', mats: LabMaterials, accent: Color): Group {
  const root = new Group();
  const { minX, maxX, minZ, maxZ } = bounds;
  if (!Number.isFinite(minX)) return root;
  const width = Math.max(8, maxX - minX);
  const depth = Math.max(6, maxZ - minZ);
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;

  const abyss = new Mesh(
    new BoxGeometry(width + 24, 0.4, depth + 16),
    new MeshBasicMaterial({ color: accent.clone().multiplyScalar(0.15) }),
  );
  abyss.position.set(midX, -7.2, midZ);
  root.add(abyss);

  if (detail === 'high') {
    for (let x = minX + 4; x < maxX; x += 10) {
      for (const z of [minZ + 0.6, maxZ - 0.6]) {
        const pillar = new Mesh(new CylinderGeometry(0.22, 0.28, 6.2, 8), mats.stone);
        pillar.position.set(x, 3.1, z);
        pillar.castShadow = true;
        root.add(pillar);
      }
    }
  }
  return root;
}

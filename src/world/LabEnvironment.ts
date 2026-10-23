import {
  BackSide,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

const SUN_DIRECTION = new Vector3(-12, 22, 8).normalize();
const KEY_POSITION = SUN_DIRECTION.clone().multiplyScalar(8);

export interface LabEnvPanel {
  color: number;
  intensity: number;
  position: [number, number, number];
  size: [number, number];
}

/** Emissive panels reflected by metal and trim: cool strips along the long sides plus a warm key on the sun. */
export const LAB_ENV_PANELS: ReadonlyArray<LabEnvPanel> = [
  { color: 0x9fdcff, intensity: 6, position: [-6, 3, -3], size: [8, 0.4] },
  { color: 0x9fdcff, intensity: 6, position: [-6, 3, 3], size: [8, 0.4] },
  { color: 0x9fdcff, intensity: 6, position: [6, 3, -3], size: [8, 0.4] },
  { color: 0x9fdcff, intensity: 6, position: [6, 3, 3], size: [8, 0.4] },
  { color: 0xffc890, intensity: 8, position: [KEY_POSITION.x, KEY_POSITION.y, KEY_POSITION.z], size: [3, 3] },
];

function gradientSphere(): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      floorColor: { value: new Color(0x05070c) },
      horizonColor: { value: new Color(0x1a2a3a) },
      zenithColor: { value: new Color(0x0b1220) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 floorColor;
      uniform vec3 horizonColor;
      uniform vec3 zenithColor;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 color = h < 0.0
          ? mix(horizonColor, floorColor, smoothstep(0.0, -0.45, h))
          : mix(horizonColor, zenithColor, smoothstep(0.0, 0.6, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  return new Mesh(new SphereGeometry(10, 32, 16), material);
}

/** Builds the procedural lab environment scene for PMREM; needs no renderer or canvas. */
export function buildLabEnvScene(): Scene {
  const scene = new Scene();
  scene.add(gradientSphere());
  const add = (mesh: Mesh, position: [number, number, number]): void => {
    mesh.position.set(position[0], position[1], position[2]);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };
  for (const panel of LAB_ENV_PANELS) {
    const material = new MeshBasicMaterial({
      color: new Color(panel.color).multiplyScalar(panel.intensity),
      side: DoubleSide,
    });
    add(new Mesh(new PlaneGeometry(panel.size[0], panel.size[1]), material), panel.position);
  }
  const ring = new MeshBasicMaterial({ color: new Color(0x5ce1ff).multiplyScalar(1.5), side: DoubleSide });
  add(new Mesh(new RingGeometry(3, 3.3, 48), ring), [0, -2, 0]);
  return scene;
}

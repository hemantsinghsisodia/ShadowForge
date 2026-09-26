import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  LoopRepeat,
  PropertyBinding,
  type AnimationAction,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BODY_HEIGHT } from '../physics/CharacterBody';

/**
 * Clips inside the Spacesuit file, after the `CharacterArmature|` prefix:
 * Death, Gun_Shoot, HitRecieve, HitRecieve_2, Idle, Idle_Gun, Idle_Gun_Pointing,
 * Idle_Gun_Shoot, Idle_Neutral, Idle_Sword, Interact, Kick_Left, Kick_Right,
 * Punch_Left, Punch_Right, Roll, Run, Run_Back, Run_Left, Run_Right, Run_Shoot,
 * Sword_Slash, Walk, Wave.
 * There is no jump or climb clip. Those states fall back to Idle_Neutral and a slowed Walk.
 */
export type HumanClip = 'idle' | 'walk' | 'run' | 'jump' | 'jumpIdle' | 'jumpLand' | 'climb' | 'interact';

export interface HumanModel {
  object: Group;
  mixer: AnimationMixer;
  /** A real climb clip exists. Otherwise climb plays a slowed walk. */
  hasClimb: boolean;
  armL: Object3D | null;
  armR: Object3D | null;
  /** True when this state has its own clip, not a stand-in. */
  dedicated(kind: HumanClip): boolean;
  action(kind: HumanClip): AnimationAction | null;
}

const WANTED: Record<HumanClip, string[]> = {
  idle: ['Idle_Neutral', 'Idle'],
  walk: ['Walk'],
  run: ['Run'],
  jump: ['Jump'],
  jumpIdle: ['Jump_Idle'],
  jumpLand: ['Jump_Land'],
  climb: ['Climb', 'Climbing', 'Ladder'],
  interact: ['Interact', 'PickUp', 'Punch_Right', 'Punch'],
};

function suffix(name: string): string {
  const parts = name.split('|');
  return parts[parts.length - 1] ?? name;
}

function findClip(clips: AnimationClip[], names: string[]): AnimationClip | null {
  for (const name of names) {
    const exact = clips.find((clip) => suffix(clip.name) === name);
    if (exact) return exact;
  }
  for (const name of names) {
    const fuzzy = clips.find((clip) => suffix(clip.name).toLowerCase().includes(name.toLowerCase()));
    if (fuzzy) return fuzzy;
  }
  return null;
}

/** Loads the suited human. Returns null if the file is missing or unreadable. */
export async function loadHumanModel(): Promise<HumanModel | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/player.glb`);
    const object = gltf.scene;
    object.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(object);
    const height = Math.max(0.001, bounds.max.y - bounds.min.y);
    const scale = BODY_HEIGHT / height;
    object.scale.setScalar(scale);
    object.position.y = -bounds.min.y * scale;
    object.traverse((child) => {
      const mesh = child as { isMesh?: boolean; castShadow?: boolean; frustumCulled?: boolean };
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
    });

    const clips = gltf.animations;
    const idle = findClip(clips, WANTED.idle);
    const walk = findClip(clips, WANTED.walk) ?? idle;
    const resolved = new Map<HumanClip, AnimationClip | null>();
    resolved.set('idle', idle);
    resolved.set('walk', walk);
    resolved.set('run', findClip(clips, WANTED.run) ?? walk);
    resolved.set('jump', findClip(clips, WANTED.jump) ?? idle);
    resolved.set('jumpIdle', findClip(clips, WANTED.jumpIdle) ?? idle);
    resolved.set('jumpLand', findClip(clips, WANTED.jumpLand) ?? idle);
    const climbClip = findClip(clips, WANTED.climb);
    resolved.set('climb', climbClip ?? walk);
    resolved.set('interact', findClip(clips, WANTED.interact) ?? idle);

    const dedicated = new Set<HumanClip>();
    (Object.keys(WANTED) as HumanClip[]).forEach((kind) => {
      if (findClip(clips, WANTED[kind])) dedicated.add(kind);
    });

    const mixer = new AnimationMixer(object);
    const actions = new Map<HumanClip, AnimationAction>();
    for (const [kind, clip] of resolved) {
      if (!clip || actions.has(kind)) continue;
      let action: AnimationAction | undefined;
      for (const [other, existing] of actions) {
        if (resolved.get(other) === clip) {
          action = existing;
          break;
        }
      }
      if (!action) {
        action = mixer.clipAction(clip);
        action.setLoop(LoopRepeat, Infinity);
      }
      actions.set(kind, action);
    }

    return {
      object,
      mixer,
      hasClimb: climbClip !== null,
      armL: object.getObjectByName(PropertyBinding.sanitizeNodeName('UpperArm.L')) ?? null,
      armR: object.getObjectByName(PropertyBinding.sanitizeNodeName('UpperArm.R')) ?? null,
      dedicated: (kind) => dedicated.has(kind),
      action: (kind) => actions.get(kind) ?? null,
    };
  } catch {
    return null;
  }
}

import { ShaderChunk } from 'three';

const VARYING = 'varying float vFogWorldY;';
const FOG_VERTEX = 'vFogWorldY = (transpose(mat3(viewMatrix)) * mvPosition.xyz).y + cameraPosition.y;';
const FOG_MIX = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );';
const FOG_MIX_HEIGHT = `vec3 fogC = mix( fogColor * 0.18, fogColor, 1.0 - smoothstep( -7.0, 2.0, vFogWorldY ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogC, fogFactor );`;

function patch(chunk: string, target: string, replacement: string): string {
  if (!chunk.includes(target)) throw new Error('height-fog: chunk changed');
  return chunk.replace(target, () => replacement);
}

/** Fog goes dark above the floor and warms toward the abyss. Safe to call more than once. */
export function installHeightFog(): void {
  if (ShaderChunk.fog_fragment.includes('vFogWorldY')) return;
  const parsVertex = patch(ShaderChunk.fog_pars_vertex, 'varying float vFogDepth;', `varying float vFogDepth;\n\t${VARYING}`);
  const parsFragment = patch(ShaderChunk.fog_pars_fragment, 'varying float vFogDepth;', `varying float vFogDepth;\n\t${VARYING}`);
  const vertex = patch(ShaderChunk.fog_vertex, 'vFogDepth = - mvPosition.z;', `vFogDepth = - mvPosition.z;\n\t${FOG_VERTEX}`);
  const fragment = patch(ShaderChunk.fog_fragment, FOG_MIX, FOG_MIX_HEIGHT);
  ShaderChunk.fog_pars_vertex = parsVertex;
  ShaderChunk.fog_pars_fragment = parsFragment;
  ShaderChunk.fog_vertex = vertex;
  ShaderChunk.fog_fragment = fragment;
}

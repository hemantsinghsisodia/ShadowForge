/** Full-screen grade for ShaderPass: vignette, film grain and a cool tint. */
export const gradeShader = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    time: { value: 0 },
    amount: { value: 1 },
  },
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
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float amount;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 uv = vUv - 0.5;
      float vig = smoothstep(0.88, 0.3, length(uv * vec2(1.2, 1.05)));
      float grain = fract(sin(dot(vUv + fract(time * 0.37), vec2(12.9898, 78.233))) * 43758.5453);
      vec3 col = texel.rgb;
      col *= mix(1.0, vig, 0.5 * amount);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= 1.0 + (grain - 0.5) * 0.06 * amount * smoothstep(0.002, 0.05, lum);
      col = mix(col, col * vec3(0.86, 0.96, 1.08) + vec3(0.008, 0.016, 0.03), amount);
      gl_FragColor = vec4(col, texel.a);
    }
  `,
};

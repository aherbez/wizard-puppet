import * as THREE from 'three';
import { SIMPLEX_NOISE_GLSL } from './noise';

export interface FlameOptions {
  radius?: number; // outer radius in parent units
  innerRadius?: number; // 0..1 fraction of radius; >0 makes a hollow shell whose core blocks flame behind it
  intensity?: number; // overall brightness
  speed?: number; // how fast the flame rises
  noiseScale?: number; // size of the flame licks (higher = smaller, busier)
  turbulence?: number; // how much the noise breaks up the flame shape
  clearFront?: number; // 0..1; fades flame directly in front of / behind the centre, leaving a corona around the silhouette
  steps?: number; // ray-march samples per pixel (quality vs. cost)
  seed?: number; // offsets the noise so neighbouring flames don't match
}

const VERTEX = /* glsl */ `
  varying vec3 vOrigin;
  varying vec3 vPosition;
  varying vec3 vRise;

  void main() {
    // Ray-march in the sphere's own space (unit radius), so it can be moved,
    // scaled and parented freely.
    mat4 toLocal = inverse(modelMatrix);
    vOrigin = (toLocal * vec4(cameraPosition, 1.0)).xyz;
    vPosition = position;
    // World up in local space, so flames always rise even when the parent tilts.
    vRise = normalize((toLocal * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uInner;
  uniform float uIntensity;
  uniform float uSpeed;
  uniform float uNoiseScale;
  uniform float uTurbulence;
  uniform float uClearFront;
  uniform float uSeed;
  uniform vec3 uColorDark;
  uniform vec3 uColorMid;
  uniform vec3 uColorHot;

  varying vec3 vOrigin;
  varying vec3 vPosition;
  varying vec3 vRise;

  ${SIMPLEX_NOISE_GLSL}

  float fbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 3; i++) {
      sum += amp * snoise(p);
      p = p * 2.03 + 17.1;
      amp *= 0.5;
    }
    return sum;
  }

  // Entry/exit distances of a ray with a sphere at the origin; x > y if it misses.
  vec2 hitSphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float h = b * b - (dot(ro, ro) - r * r);
    if (h < 0.0) return vec2(1.0, -1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }

  void main() {
    vec3 rd = normalize(vPosition - vOrigin);
    vec2 hit = hitSphere(vOrigin, rd, 1.0);
    float t0 = max(hit.x, 0.0);
    float t1 = hit.y;
    if (t1 <= t0) discard;

    float stepSize = (t1 - t0) / float(STEPS);
    // Per-pixel jitter on the start hides banding between samples.
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

    vec3 color = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
      vec3 p = vOrigin + rd * (t0 + (float(i) + jitter) * stepSize);
      float r = length(p);
      vec3 dir = p / max(r, 1e-4);
      float up = dot(dir, vRise);
      // 0 at the inner edge (or centre), 1 at the outer edge.
      float s = clamp((r - uInner) / (1.0 - uInner), 0.0, 1.0);

      // Noise squashed along the rise direction so licks stretch upward, and
      // scrolled upward over time.
      vec3 q = p * uNoiseScale;
      q -= vRise * dot(q, vRise) * 0.55;
      q -= vRise * uTime * uSpeed;
      float n = fbm(q + uSeed);

      // Hotter toward the core and reaching further on the upward side, then
      // broken up by noise so the edges become licks of flame.
      float heat = 1.0 - s * (1.0 - 0.45 * max(up, 0.0)) + n * uTurbulence;
      heat = clamp((heat - 0.3) * 1.7, 0.0, 1.0) * (1.0 - smoothstep(0.8, 1.0, s));
      // Fire rises: weaker underneath than on top.
      heat *= mix(0.45, 1.0, up * 0.5 + 0.5);
      // A shell ramps up from its inner edge rather than starting hard.
      if (uInner > 0.0) heat *= smoothstep(0.0, 0.35, s);
      // Optionally keep the parts in front of and behind the centre clear (e.g.
      // so a face shows through), leaving a corona around the silhouette.
      heat *= 1.0 - uClearFront * smoothstep(0.25, 0.85, abs(dot(dir, rd)));

      vec3 c = mix(uColorDark, uColorMid, smoothstep(0.0, 0.5, heat));
      c = mix(c, uColorHot, smoothstep(0.6, 1.0, heat));
      color += c * heat * heat * stepSize;
    }

    gl_FragColor = vec4(color * uIntensity, 1.0);
    #include <colorspace_fragment>
  }
`;

// Shared by every flame; each Flame scales it to its radius.
const unitSphere = new THREE.SphereGeometry(1, 48, 24);

// A green/white volumetric fireball filling a sphere. Use a solid ball
// (innerRadius 0) for small flames such as inside the eyes, or a hollow shell
// (innerRadius > 0) to wrap flames around something. Call update() each frame.
export class Flame extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  constructor(options: FlameOptions = {}) {
    const material = new THREE.ShaderMaterial({
      name: 'flame',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines: { STEPS: options.steps ?? 32 },
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: options.innerRadius ?? 0 },
        uIntensity: { value: options.intensity ?? 1.5 },
        uSpeed: { value: options.speed ?? 1.2 },
        uNoiseScale: { value: options.noiseScale ?? 3.5 },
        uTurbulence: { value: options.turbulence ?? 0.9 },
        uClearFront: { value: options.clearFront ?? 0 },
        uSeed: { value: options.seed ?? 0 },
        uColorDark: { value: new THREE.Color(0x032b08) },
        uColorMid: { value: new THREE.Color(0x2bff4a) },
        uColorHot: { value: new THREE.Color(0xe8ffe8) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    super(unitSphere, material);
    this.name = 'flame';
    this.scale.setScalar(options.radius ?? 1);
    // Draw after the (transparent) skin so flames in front of the face aren't covered.
    this.renderOrder = 1;
  }

  update(dt: number): void {
    this.material.uniforms.uTime.value += dt;
  }
}

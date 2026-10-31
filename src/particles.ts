import * as THREE from 'three';

// Where particles are born, in the anchor object's local space.
export interface Emitters {
  positions: THREE.Vector3[];
  normals: THREE.Vector3[];
  // Running total of each point's share of surface area, for picking points
  // evenly over the surface whatever the mesh density.
  cumulativeArea: number[];
}

export interface ParticleFlameOptions {
  count?: number; // number of particles alive at once
  lifetime?: number; // average seconds a particle lives
  size?: number; // sprite size in world units at birth
  riseSpeed?: number; // upward speed (world units/s)
  outSpeed?: number; // speed away from the surface at birth
  turbulence?: number; // strength of the sideways wobble
  pull?: number; // how strongly rising flames draw in toward the anchor's vertical axis
  intensity?: number; // overall brightness
  calmFraction?: number; // share of particles alive when not flaring
  flareRise?: number; // rise speed multiplier at full flare
  flareLifetime?: number; // lifetime multiplier at full flare (with rise, sets flame height)
  flareIntensity?: number; // brightness multiplier at full flare
}

const VERTEX = /* glsl */ `
  attribute float aLife; // 0 at birth .. 1 at death
  attribute float aSeed;
  attribute float aSize;

  uniform float uPixelsPerUnit; // viewport height / 2 * projection scale

  varying float vLife;
  varying float vSeed;

  void main() {
    vLife = aLife;
    vSeed = aSeed;
    // Idle particles (not needed until the flames flare) aren't drawn.
    if (aLife >= 1.0) {
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Born at a good size, swells quickly, then shrinks as it burns out.
    float grow = mix(0.6, 1.0, smoothstep(0.0, 0.15, aLife)) * (1.0 - 0.9 * sqrt(aLife));
    gl_PointSize = aSize * grow * uPixelsPerUnit / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColorDark;
  uniform vec3 uColorMid;
  uniform vec3 uColorHot;

  varying float vLife;
  varying float vSeed;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    // -1..1 across the sprite, +y up.
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    c.y = -c.y;
    // Teardrop: narrower toward the top, so each sprite reads as a lick of flame.
    c.x *= 1.0 + 0.7 * max(c.y, 0.0);
    float d = length(c * vec2(1.25, 1.0));
    if (d > 1.0) discard;

    // Ragged edges that scroll upward and differ per particle.
    vec2 np = c * 1.8 + vec2(vSeed * 13.0, -uTime * 3.0 + vSeed * 7.0);
    float n = noise(np) * 0.6 + noise(np * 2.3) * 0.4;
    float shape = smoothstep(1.0, 0.15, d + (n - 0.5) * 0.6);

    // Cools from white-hot to green to dark as it ages.
    float heat = 1.0 - vLife;
    vec3 color = mix(uColorDark, uColorMid, smoothstep(0.0, 0.55, heat));
    color = mix(color, uColorHot, smoothstep(0.8, 1.0, heat) * shape);

    float fade = smoothstep(0.0, 0.08, vLife) * (1.0 - smoothstep(0.35, 0.95, vLife));
    gl_FragColor = vec4(color * shape * fade * uIntensity, 1.0);
    #include <colorspace_fragment>
  }
`;

// Green/white flames made of particles born on a surface (e.g. the head) that
// rise in world space, so they trail behind when the surface moves. Add it to
// the scene (not to the anchor) and call update() each frame.
export class ParticleFlame extends THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly lifetimes: Float32Array;
  private readonly lives: Float32Array;
  private readonly seeds: Float32Array;
  private readonly options: Required<ParticleFlameOptions>;
  private time = 0;

  // 0 = calm, 1 = fully flared: more particles, taller and brighter flames.
  flare = 0;

  private readonly spawn = new THREE.Vector3();
  private readonly spawnNormal = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();

  constructor(
    private readonly anchor: THREE.Object3D,
    private readonly emitters: Emitters,
    options: ParticleFlameOptions = {},
  ) {
    const opts: Required<ParticleFlameOptions> = {
      count: 4000,
      lifetime: 0.9,
      size: 0.17,
      riseSpeed: 0.55,
      outSpeed: 0.1,
      turbulence: 0.6,
      pull: 1.2,
      intensity: 0.03,
      calmFraction: 0.4,
      flareRise: 2.8,
      flareLifetime: 1.5,
      flareIntensity: 1,
      ...options,
    };
    const { count } = opts;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const lives = new Float32Array(count);
    const seeds = new Float32Array(count);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seeds[i] = Math.random();
      sizes[i] = opts.size * (0.6 + Math.random() * 0.8);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      name: 'particleFlame',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uPixelsPerUnit: { value: 1 },
        uIntensity: { value: opts.intensity },
        uColorDark: { value: new THREE.Color(0x021f06) },
        uColorMid: { value: new THREE.Color(0x2bff4a) },
        uColorHot: { value: new THREE.Color(0xe8ffe8) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    super(geometry, material);
    this.name = 'particleFlame';
    this.frustumCulled = false; // particles move freely; bounds would go stale
    // Draw after the (transparent) skin so it can occlude flames behind the head.
    this.renderOrder = 1;

    this.positions = positions;
    this.lives = lives;
    this.seeds = seeds;
    this.velocities = new Float32Array(count * 3);
    this.ages = new Float32Array(count);
    this.lifetimes = new Float32Array(count);
    this.options = opts;

    // Stagger the starting ages so emission is continuous from the first frame.
    for (let i = 0; i < count; i++) {
      this.respawn(i);
      this.ages[i] = Math.random() * this.lifetimes[i];
    }

    // Keep sprite sizes in world units whatever the viewport size.
    this.onBeforeRender = (renderer, _scene, camera) => {
      const height = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
      material.uniforms.uPixelsPerUnit.value = (height / 2) * camera.projectionMatrix.elements[5];
    };
  }

  // Area-weighted random emitter index (binary search on the running total).
  private pickEmitter(): number {
    const totals = this.emitters.cumulativeArea;
    const target = Math.random() * totals[totals.length - 1];
    let lo = 0;
    let hi = totals.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (totals[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private respawn(i: number): void {
    const k = this.pickEmitter();
    this.anchor.updateWorldMatrix(true, false);
    this.spawn.copy(this.emitters.positions[k]).applyMatrix4(this.anchor.matrixWorld);
    this.spawnNormal.copy(this.emitters.normals[k]).transformDirection(this.anchor.matrixWorld);

    const { outSpeed, riseSpeed, lifetime, flareLifetime } = this.options;
    const i3 = i * 3;
    this.positions[i3] = this.spawn.x;
    this.positions[i3 + 1] = this.spawn.y;
    this.positions[i3 + 2] = this.spawn.z;
    const out = outSpeed * (0.5 + Math.random());
    this.velocities[i3] = this.spawnNormal.x * out;
    this.velocities[i3 + 1] = this.spawnNormal.y * out + riseSpeed * 0.3;
    this.velocities[i3 + 2] = this.spawnNormal.z * out;
    this.ages[i] = 0;
    this.lifetimes[i] = lifetime * THREE.MathUtils.lerp(1, flareLifetime, this.flare) * (0.6 + Math.random() * 0.8);
  }

  update(dt: number): void {
    this.time += dt;
    const { turbulence, pull, count, calmFraction, flareRise, flareIntensity, intensity } = this.options;
    const riseSpeed = this.options.riseSpeed * THREE.MathUtils.lerp(1, flareRise, this.flare);
    const activeCount = Math.round(count * THREE.MathUtils.lerp(calmFraction, 1, this.flare));
    const axis = this.anchor.getWorldPosition(this.axis);
    const t = this.time;
    const p = this.positions;
    const v = this.velocities;
    const drag = Math.exp(-2.5 * dt);

    for (let i = 0; i < this.ages.length; i++) {
      this.ages[i] += dt;
      if (this.ages[i] >= this.lifetimes[i]) {
        // Particles beyond the active count wait, hidden, until a flare needs them.
        if (i >= activeCount) {
          this.lives[i] = 1;
          continue;
        }
        this.respawn(i);
      }
      const i3 = i * 3;
      const seed = this.seeds[i] * 10;

      // Buoyancy pulls toward the rise speed; a cheap swirling wobble gives
      // the flames their flicker.
      v[i3 + 1] += (riseSpeed - v[i3 + 1]) * 3 * dt;
      v[i3] += Math.sin(p[i3 + 1] * 9 + t * 4 + seed) * turbulence * dt;
      v[i3 + 2] += Math.cos(p[i3 + 1] * 7.3 + t * 3.1 + seed * 1.7) * turbulence * dt;
      // Draw in toward the centre line as they age, so flames first rise off
      // the surface they came from, then gather into tongues.
      const gather = pull * this.lives[i] * dt;
      v[i3] += (axis.x - p[i3]) * gather;
      v[i3 + 2] += (axis.z - p[i3 + 2]) * gather;
      v[i3] *= drag;
      v[i3 + 2] *= drag;

      p[i3] += v[i3] * dt;
      p[i3 + 1] += v[i3 + 1] * dt;
      p[i3 + 2] += v[i3 + 2] * dt;
      this.lives[i] = this.ages[i] / this.lifetimes[i];
    }

    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('aLife').needsUpdate = true;
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uIntensity.value = intensity * THREE.MathUtils.lerp(1, flareIntensity, this.flare);
  }
}

// Picks emitter points from a skinned mesh's rest pose, in the model's space
// (call before the model is placed under anything else). `keep` decides which
// surface points emit, given the point's position, outward normal and index.
export function sampleEmitters(
  mesh: THREE.SkinnedMesh,
  keep: (position: THREE.Vector3, normal: THREE.Vector3, index: number) => boolean,
): Emitters {
  mesh.updateMatrixWorld(true);
  const position = mesh.geometry.getAttribute('position');
  const normal = mesh.geometry.getAttribute('normal');
  const index = mesh.geometry.getIndex();
  const emitters: Emitters = { positions: [], normals: [], cumulativeArea: [] };
  const tip = new THREE.Vector3();

  // Each vertex gets a third of the area of every triangle it belongs to.
  const area = new Float32Array(position.count);
  const triangle = new THREE.Triangle();
  const triangleCount = (index ? index.count : position.count) / 3;
  for (let t = 0; t < triangleCount; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
    triangle.setFromAttributeAndIndices(position, a, b, c);
    const share = triangle.getArea() / 3;
    area[a] += share;
    area[b] += share;
    area[c] += share;
  }
  let total = 0;

  for (let i = 0; i < position.count; i++) {
    // Skin the point and a point slightly along its normal, so the normal is
    // posed the same way as the surface.
    const p = new THREE.Vector3().fromBufferAttribute(position, i);
    tip.fromBufferAttribute(normal, i).multiplyScalar(0.01).add(p);
    mesh.applyBoneTransform(i, p);
    mesh.applyBoneTransform(i, tip);
    mesh.localToWorld(p);
    mesh.localToWorld(tip);
    const n = tip.sub(p).normalize();
    if (keep(p, n, i)) {
      emitters.positions.push(p);
      emitters.normals.push(n.clone());
      total += area[i];
      emitters.cumulativeArea.push(total);
    }
  }
  return emitters;
}

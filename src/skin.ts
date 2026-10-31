import * as THREE from 'three';

// Curvature bake settings.
const CURVATURE_SMOOTHING_PASSES = 3; // blurs the per-vertex estimate so broad areas read as one
const CURVATURE_NORMALIZE_PERCENTILE = 0.9; // this |curvature| maps to 1 (fully creased / not flat)

// Green self-glow in the model's own colour, so the head isn't only lit.
// Live-tweakable via the material's emissiveIntensity.
const SKIN_EMISSIVE_INTENSITY = 0.15;

// Shared uniforms, so the look can be tweaked live without recompiling.
export const skinUniforms = {
  uCreaseDarken: { value: 0.35 }, // how much darker the deepest seams get
  uNoiseScale: { value: 60 }, // noise frequency in model units
  uNoiseCrease: { value: 0.3 }, // noise strength in seams
  uNoiseFlat: { value: 0.05 }, // noise strength on flat areas
  uFlatStart: { value: 0.7 }, // flatness above this starts turning transparent
  uFlatTransparency: { value: 0.08 }, // max transparency on the flattest areas
  uNeckBottom: { value: 0 }, // distance up the neck axis (from the lowest vertex) where the fade reaches 0
  uNeckFade: { value: 0.225 }, // length of the fade band above uNeckBottom
};

// Bakes per-vertex `crease` (0..1, how concave: seams, folds, corners) and
// `flatness` (0..1, how close to flat) attributes from the rest-pose mesh.
export function bakeCurvature(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  const count = position.count;

  // Weld vertices that share a position (UV seams split them), so neighbours
  // and results are continuous across seams.
  const weldId = new Uint32Array(count);
  const keyToId = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = `${position.getX(i).toFixed(5)},${position.getY(i).toFixed(5)},${position.getZ(i).toFixed(5)}`;
    let id = keyToId.get(key);
    if (id === undefined) keyToId.set(key, (id = keyToId.size));
    weldId[i] = id;
  }
  const welded = keyToId.size;

  const points = Array.from({ length: welded }, () => new THREE.Vector3());
  const normals = Array.from({ length: welded }, () => new THREE.Vector3());
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    points[weldId[i]].fromBufferAttribute(position, i);
    normals[weldId[i]].add(v.fromBufferAttribute(normal, i));
  }
  normals.forEach((n) => n.normalize());

  const neighbours = Array.from({ length: welded }, () => new Set<number>());
  const triangleCount = (index ? index.count : count) / 3;
  for (let t = 0; t < triangleCount; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => weldId[index ? index.getX(t * 3 + k) : t * 3 + k]);
    neighbours[a].add(b).add(c);
    neighbours[b].add(a).add(c);
    neighbours[c].add(a).add(b);
  }

  // Mean-curvature estimate: positive when neighbours rise above the tangent
  // plane (concave), negative when they fall away (convex).
  let curvature = new Float32Array(welded);
  for (let i = 0; i < welded; i++) {
    let sum = 0;
    for (const j of neighbours[i]) {
      v.subVectors(points[j], points[i]);
      sum += normals[i].dot(v) / v.lengthSq();
    }
    curvature[i] = neighbours[i].size ? sum / neighbours[i].size : 0;
  }

  for (let pass = 0; pass < CURVATURE_SMOOTHING_PASSES; pass++) {
    const smoothed = new Float32Array(welded);
    for (let i = 0; i < welded; i++) {
      let sum = 0;
      for (const j of neighbours[i]) sum += curvature[j];
      smoothed[i] = neighbours[i].size ? (curvature[i] + sum / neighbours[i].size) / 2 : curvature[i];
    }
    curvature = smoothed;
  }

  const magnitudes = Array.from(curvature, Math.abs).sort((a, b) => a - b);
  const scale = magnitudes[Math.floor(CURVATURE_NORMALIZE_PERCENTILE * (welded - 1))] || 1;

  const crease = new Float32Array(count);
  const flatness = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const k = curvature[weldId[i]] / scale;
    crease[i] = THREE.MathUtils.clamp(k, 0, 1);
    flatness[i] = 1 - THREE.MathUtils.clamp(Math.abs(k), 0, 1);
  }
  geometry.setAttribute('crease', new THREE.BufferAttribute(crease, 1));
  geometry.setAttribute('flatness', new THREE.BufferAttribute(flatness, 1));
}

// Bakes each vertex's rest-pose distance along the neck axis into a
// `neckHeight` attribute, measured from the lowest vertex. The axis runs from
// the root bone to its first child bone, so the fade follows the neck however
// the rig is posed or scaled.
export function bakeNeckHeight(mesh: THREE.SkinnedMesh): void {
  const bones = mesh.skeleton.bones;
  const root = bones.find((bone) => !(bone.parent as THREE.Bone | null)?.isBone);
  const next = root?.children.find((child) => (child as THREE.Bone).isBone);
  if (!root || !next) {
    console.warn('No root bone with a child bone found; neck fade disabled');
    return;
  }

  mesh.updateMatrixWorld(true);
  const origin = root.getWorldPosition(new THREE.Vector3());
  const axis = next.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();

  const position = mesh.geometry.getAttribute('position');
  const heights = new Float32Array(position.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    mesh.applyBoneTransform(i, v);
    mesh.localToWorld(v);
    heights[i] = v.sub(origin).dot(axis);
  }
  const lowest = heights.reduce((min, h) => Math.min(min, h), Infinity);
  for (let i = 0; i < heights.length; i++) heights[i] -= lowest;

  mesh.geometry.setAttribute('neckHeight', new THREE.BufferAttribute(heights, 1));
}

const NOISE_GLSL = /* glsl */ `
  float skinHash(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float skinValueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(skinHash(i), skinHash(i + vec3(1, 0, 0)), f.x),
          mix(skinHash(i + vec3(0, 1, 0)), skinHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(skinHash(i + vec3(0, 0, 1)), skinHash(i + vec3(1, 0, 1)), f.x),
          mix(skinHash(i + vec3(0, 1, 1)), skinHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;

// Lit skin material that darkens and roughens seams with noise, keeps flat
// areas cleaner and very slightly transparent, and fades out at the neck.
// Built on MeshStandardMaterial so lighting, skinning and morph targets still
// work. The mesh's geometry needs `crease`, `flatness` and `neckHeight`
// attributes (see bakeCurvature and bakeNeckHeight).
export function createSkinMaterial(previous: THREE.MeshStandardMaterial): THREE.Material {
  const material = new THREE.MeshStandardMaterial({
    name: 'skin',
    color: previous.color,
    roughness: previous.roughness,
    metalness: previous.metalness,
    emissive: previous.color,
    emissiveIntensity: SKIN_EMISSIVE_INTENSITY,
    transparent: true,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, skinUniforms);

    // Rest-pose position, so the noise sticks to the model as it moves.
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float crease;
        attribute float flatness;
        attribute float neckHeight;
        varying float vCrease;
        varying float vFlatness;
        varying float vNeckHeight;
        varying vec3 vRestPosition;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vCrease = crease;
        vFlatness = flatness;
        vNeckHeight = neckHeight;
        vRestPosition = position;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uCreaseDarken;
        uniform float uNoiseScale;
        uniform float uNoiseCrease;
        uniform float uNoiseFlat;
        uniform float uFlatStart;
        uniform float uFlatTransparency;
        uniform float uNeckBottom;
        uniform float uNeckFade;
        varying float vCrease;
        varying float vFlatness;
        varying float vNeckHeight;
        varying vec3 vRestPosition;
        ${NOISE_GLSL}`,
      )
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>
        // Two octaves of noise in -1..1, strongest in the seams.
        vec3 np = vRestPosition * uNoiseScale;
        float noise = (skinValueNoise(np) * 0.65 + skinValueNoise(np * 2.7) * 0.35) * 2.0 - 1.0;
        float noiseAmount = mix(uNoiseFlat, uNoiseCrease, vCrease);
        float skinShade = max(0.0, (1.0 - uCreaseDarken * vCrease) * (1.0 + noise * noiseAmount));
        diffuseColor.rgb *= skinShade;

        diffuseColor.a *= 1.0 - uFlatTransparency * smoothstep(uFlatStart, 1.0, vFlatness);
        diffuseColor.a *= smoothstep(uNeckBottom, uNeckBottom + uNeckFade, vNeckHeight);`,
      )
      // Seams and noise darken the glow too, so it doesn't wash them out.
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance *= skinShade;`,
      );
  };

  return material;
}

// Bakes the per-vertex data into each skinned mesh in the model and swaps in
// the skin material, keeping the mesh's original colour and roughness.
export function applySkin(model: THREE.Object3D): void {
  model.traverse((obj) => {
    const mesh = obj as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const previous = mesh.material as THREE.MeshStandardMaterial;
    bakeCurvature(mesh.geometry);
    bakeNeckHeight(mesh);
    mesh.material = createSkinMaterial(previous);
    previous.dispose();
  });
}

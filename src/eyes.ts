import * as THREE from "three";
import { SIMPLEX_NOISE_GLSL } from "./noise";

// Blender's default UV sphere (1m radius, 32 segments, 16 rings) at scale 0.05375.
const EYE_RADIUS = 0.053;
const EYE_SEGMENTS = 32;
const EYE_RINGS = 16;

// Bone names after three.js strips the '.' from "eye.L" / "eye.R".
const EYE_BONES = ["eyeL", "eyeR"];

// glTF places a bone at its head and doesn't export its length, so this is
// copied from the eye bones in wizard3.blend (armature units). Update it if
// the bones are resized.
const EYE_BONE_LENGTH = 0.017873801290988922;

// The face looks along model +Z. The eye bones angle slightly inward, so each
// eyeball is turned to look straight ahead by default.
const FORWARD = new THREE.Vector3(0, 0, 1);
const POLE = new THREE.Vector3(0, 1, 0);

// Shared eye look. Sizes are fractions of the sphere's v (UV) range measured
// from the front pole, where 1 would reach all the way to the back.
export const eyeUniforms = {
  uPupilSize: { value: 0.065 },
  uIrisSize: { value: 0.18 },
  uPupilColor: { value: new THREE.Color(0x000000) },
  uIrisDark: { value: new THREE.Color(0x0b3d12) },
  uIrisLight: { value: new THREE.Color(0x5fd36a) },
  uScleraColor: { value: new THREE.Color(0xe3f2dc) },
};

// Standard (lit) eyeball material: black pupil, green iris with noise-based
// fibres, and an off-white (light green) sclera, all laid out from the
// sphere's UVs. SphereGeometry's v runs from 1 at its +Y pole (which points
// out of the face) to 0 at the back, and u runs around the pole.
export function createEyeMaterial(): THREE.Material {
  const material = new THREE.MeshStandardMaterial({
    name: "eye",
    roughness: 0.25,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, eyeUniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec2 vEyeUv;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vEyeUv = uv;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uPupilSize;
        uniform float uIrisSize;
        uniform vec3 uPupilColor;
        uniform vec3 uIrisDark;
        uniform vec3 uIrisLight;
        uniform vec3 uScleraColor;
        varying vec2 vEyeUv;
        ${SIMPLEX_NOISE_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        // Distance from the centre of the pupil, and position around it
        // (as a point on a circle, so there's no seam where u wraps).
        float fromCentre = 1.0 - vEyeUv.y;
        float angle = vEyeUv.x * 6.28318530718;
        vec2 around = vec2(cos(angle), sin(angle));
        float t = fromCentre / uIrisSize; // 0 at the centre, 1 at the iris edge

        // Fine radial fibres (vary quickly around, slowly outward) over
        // broader blotches.
        float fibres = snoise(vec3(around * 6.0, t * 1.5)) * 0.5 + 0.5;
        float blotches = snoise(vec3(around * 1.5, t * 3.0 + 7.0)) * 0.5 + 0.5;
        vec3 iris = mix(uIrisDark, uIrisLight, fibres * 0.7 + blotches * 0.3);
        // Lighter ring around the pupil, darker ring at the outer edge.
        iris *= mix(1.25, 1.0, smoothstep(0.4, 0.6, t));
        iris *= mix(1.0, 0.3, smoothstep(0.78, 1.0, t));

        // Soft, anti-aliased boundaries between pupil, iris and sclera.
        float aa = fwidth(fromCentre) * 1.5;
        vec3 eye = mix(iris, uScleraColor, smoothstep(uIrisSize - aa, uIrisSize + aa, fromCentre));
        eye = mix(uPupilColor, eye, smoothstep(uPupilSize - aa, uPupilSize + aa, fromCentre));
        diffuseColor.rgb = eye;`,
      );
  };

  return material;
}

// Adds an eyeball centred on each eye bone. Call before the model is placed
// under anything else, so world space is the model's own space.
export function addEyes(
  model: THREE.Object3D,
): THREE.Mesh<THREE.SphereGeometry>[] {
  const geometry = new THREE.SphereGeometry(
    EYE_RADIUS,
    EYE_SEGMENTS,
    EYE_RINGS,
  );
  const material = createEyeMaterial();
  const boneScale = new THREE.Vector3();
  const boneRotation = new THREE.Quaternion();
  const pole = new THREE.Vector3();
  const correction = new THREE.Quaternion();
  model.updateMatrixWorld(true);

  const eyes: THREE.Mesh<THREE.SphereGeometry>[] = [];
  for (const name of EYE_BONES) {
    const bone = model.getObjectByName(name);
    if (!bone) {
      console.warn(
        `wizard_head.glb has no bone named "${name}"; eye not added`,
      );
      continue;
    }
    // Parented to the bone so it follows it, and centred on the bone's tail.
    // The bone's +Y points out of the face, which lines up with the sphere's
    // pole. Undo the rig's scale so the radius is in model units.
    const eye = new THREE.Mesh(geometry, material);
    eye.name = `${name}Ball`;
    eye.position.y = EYE_BONE_LENGTH;
    bone.getWorldScale(boneScale);
    eye.scale.set(1 / boneScale.x, 1 / boneScale.y, 1 / boneScale.z);

    // Smallest rotation that swings the pole from the bone's direction to
    // straight ahead, expressed in the bone's space.
    bone.getWorldQuaternion(boneRotation);
    pole.copy(POLE).applyQuaternion(boneRotation);
    correction.setFromUnitVectors(pole, FORWARD);
    eye.quaternion
      .copy(boneRotation)
      .invert()
      .multiply(correction)
      .multiply(boneRotation);
    bone.add(eye);
    eyes.push(eye);
  }
  return eyes;
}

import * as THREE from "three";

// Blender's default UV sphere (1m radius, 32 segments, 16 rings) at scale 0.05375.
const EYE_RADIUS = 0.047;
const EYE_SEGMENTS = 32;
const EYE_RINGS = 16;

// Bone names after three.js strips the '.' from "eye.L" / "eye.R".
const EYE_BONES = ["eyeL", "eyeR"];

// glTF places a bone at its head and doesn't export its length, so this is
// copied from the eye bones in wizard3.blend (armature units). Update it if
// the bones are resized.
const EYE_BONE_LENGTH = 0.017873801290988922;

export function createEyeMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    name: "eye",
    color: 0xffffff,
    roughness: 0.4,
  });
}

// Adds an eyeball centred on each eye bone. Call before the model is placed
// under anything else, so world space is the model's own space.
export function addEyes(model: THREE.Object3D): THREE.Mesh<THREE.SphereGeometry>[] {
  const geometry = new THREE.SphereGeometry(
    EYE_RADIUS,
    EYE_SEGMENTS,
    EYE_RINGS,
  );
  const material = createEyeMaterial();
  const boneScale = new THREE.Vector3();
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
    bone.add(eye);
    eyes.push(eye);
  }
  return eyes;
}

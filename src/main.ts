import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { axis, isDown } from './input';
import { HoldRamp, HoldSpring } from './ramp';
import { addEyes } from './eyes';
import { applySkin } from './skin';
import { Flame } from './flame';
import { ParticleFlame, sampleEmitters } from './particles';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  100,
);
camera.position.set(0, 0, 2.2);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x223322, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 2);
key.position.set(3, 5, 4);
scene.add(key);

// Everything that moves as the head goes in here; it rotates about its origin.
const head = new THREE.Group();
scene.add(head);

// Jaw bone and its rest pose; the open angle is applied on top of the rest pose.
let jaw: THREE.Object3D | undefined;
const jawRest = new THREE.Quaternion();

// Flames: particles rising off the head, and fireballs that replace the
// eyeballs. Holding R flares the head flames up and sets the eyes on fire.
const flames: { update(dt: number): void }[] = [];
let headFlame: ParticleFlame | undefined;
const flareRamp = new HoldRamp(0.25, 0.9);
const eyeFlames: { eye: THREE.Mesh; flame: Flame }[] = [];

// Morph targets driven by held keys, like the jaw.
const MORPH_CONTROLS = [
  { key: 'KeyE', target: 'st_eyebrow_raise', ramp: new HoldRamp(0.25, 0.3) },
  { key: 'KeyQ', target: 'st_blink', ramp: new HoldRamp(0.08, 0.1) },
];
// Each control's target index in every mesh that has it.
const morphBindings = MORPH_CONTROLS.map(() => [] as { mesh: THREE.Mesh; index: number }[]);

new GLTFLoader().load(
  `${import.meta.env.BASE_URL}models/wizard_head.glb`,
  (gltf) => {
    applySkin(gltf.scene);
    const eyes = addEyes(gltf.scene);

    // Head flames are born where hair would grow: above a hairline that sits
    // partway up the forehead at the front and drops toward eye level at the
    // back, so the face stays clear. Measured in model space, before the model
    // is placed under the head group.
    const eyeLevel = new THREE.Vector3();
    for (const eye of eyes) eyeLevel.add(eye.getWorldPosition(new THREE.Vector3()));
    eyeLevel.divideScalar(Math.max(eyes.length, 1));
    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const crown = Math.max(...sampleEmitters(mesh, () => true).positions.map((p) => p.y));
      const span = crown - eyeLevel.y;
      const frontHairline = eyeLevel.y + span * 0.5;
      const backHairline = eyeLevel.y + span * 0.1;
      const emitters = sampleEmitters(mesh, (p) => {
        const frontness = THREE.MathUtils.smoothstep(p.z, eyeLevel.z - 0.35, eyeLevel.z);
        return p.y > THREE.MathUtils.lerp(backHairline, frontHairline, frontness);
      });
      headFlame = new ParticleFlame(head, emitters);
      scene.add(headFlame);
      flames.push(headFlame);
    });

    // Siblings of the eyeballs (not children) so they stay visible when the
    // eyeballs are hidden.
    eyes.forEach((eye, i) => {
      const flame = new Flame({ radius: eye.geometry.parameters.radius, intensity: 3.5, seed: 10 + i * 7 });
      flame.position.copy(eye.position);
      flame.scale.multiply(eye.scale);
      flame.visible = false;
      eye.parent!.add(flame);
      flames.push(flame);
      eyeFlames.push({ eye, flame });
    });

    head.add(gltf.scene);
    jaw = gltf.scene.getObjectByName('jaw');
    if (jaw) jawRest.copy(jaw.quaternion);
    else console.warn('wizard_head.glb has no node named "jaw"; jaw control disabled');

    gltf.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      MORPH_CONTROLS.forEach((control, i) => {
        const index = mesh.morphTargetDictionary?.[control.target];
        if (index !== undefined) morphBindings[i].push({ mesh, index });
      });
    });
    MORPH_CONTROLS.forEach((control, i) => {
      if (morphBindings[i].length === 0) console.warn(`wizard_head.glb has no morph target "${control.target}"`);
    });
  },
  undefined,
  (err) => console.error('Failed to load wizard_head.glb', err),
);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const MAX_PITCH = THREE.MathUtils.degToRad(30); // W/S or Up/Down nod
const MAX_YAW = THREE.MathUtils.degToRad(45); // A/D or Left/Right turn
const TURN_SPEED = 2; // radians per second while a key is held
const RETURN_RATE = 6; // how quickly the head springs back to neutral

// Moves toward the limit while a key is held, and eases back to 0 on release.
function driveAngle(current: number, input: number, max: number, dt: number) {
  if (input === 0) return THREE.MathUtils.damp(current, 0, RETURN_RATE, dt);
  return THREE.MathUtils.clamp(current + input * TURN_SPEED * dt, -max, max);
}

const JAW_MAX = THREE.MathUtils.degToRad(25);
const JAW_DIRECTION = 1; // flip to -1 if the jaw opens the wrong way
const jawRamp = new HoldSpring(14, 12); // ~75% open in 0.1s, ~95% in 0.2s
const X_AXIS = new THREE.Vector3(1, 0, 0);
const jawOffset = new THREE.Quaternion();

const timer = new THREE.Timer();

renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = timer.getDelta();

  // +X tips the face down (forward); +Y turns it toward screen right.
  head.rotation.x = driveAngle(head.rotation.x, axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']) * -1, MAX_PITCH, dt);
  head.rotation.y = driveAngle(head.rotation.y, axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), MAX_YAW, dt);

  const jawOpen = jawRamp.update(isDown('Space'), dt);
  if (jaw) {
    const angle = JAW_DIRECTION * JAW_MAX * jawOpen;
    jaw.quaternion.copy(jawRest).multiply(jawOffset.setFromAxisAngle(X_AXIS, angle));
  }

  MORPH_CONTROLS.forEach((control, i) => {
    const weight = control.ramp.update(isDown(control.key), dt);
    for (const { mesh, index } of morphBindings[i]) mesh.morphTargetInfluences![index] = weight;
  });

  const flaring = isDown('KeyR');
  if (headFlame) headFlame.flare = flareRamp.update(flaring, dt);
  for (const { eye, flame } of eyeFlames) {
    flame.visible = flaring;
    eye.visible = !flaring;
  }
  for (const flame of flames) flame.update(dt);

  renderer.render(scene, camera);
});

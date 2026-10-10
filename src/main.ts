import * as THREE from 'three';
import { arrowAxes } from './input';

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
camera.position.set(0, 1.5, 6);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x223322, 1.0));
const key = new THREE.DirectionalLight(0xffffff, 2);
key.position.set(3, 5, 4);
scene.add(key);

// Placeholder objects until the puppet model exists.
const sphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.6, 32, 16),
  new THREE.MeshStandardMaterial({ color: 0x2e8b57 }), // emerald
);
sphere.position.x = -1.8;

const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xd4af37 }), // yellow brick
);

const cone = new THREE.Mesh(
  new THREE.ConeGeometry(0.5, 1.2, 32),
  new THREE.MeshStandardMaterial({ color: 0xb22222 }), // ruby
);
cone.position.x = 1.8;

const puppet = new THREE.Group();
puppet.add(sphere, box, cone);
scene.add(puppet);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const MOVE_SPEED = 2; // units per second
const SPIN_SPEED = 1.5; // radians per second
const timer = new THREE.Timer();

renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = timer.getDelta();
  const { x, y } = arrowAxes();

  // Arrows translate the whole group; each object also spins individually.
  puppet.position.x += x * MOVE_SPEED * dt;
  puppet.position.y += y * MOVE_SPEED * dt;
  sphere.rotation.y += x * SPIN_SPEED * dt;
  box.rotation.x -= y * SPIN_SPEED * dt;
  box.rotation.y += x * SPIN_SPEED * dt;
  cone.rotation.z -= x * SPIN_SPEED * dt;

  renderer.render(scene, camera);
});

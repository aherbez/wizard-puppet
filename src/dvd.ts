import * as THREE from 'three';

export interface DvdOptions {
  height?: number; // logo height as a fraction of the screen height
  speed?: number; // screen heights per second
  hueStep?: number; // hue rotation (0..1 of a full turn) on each bounce; 0 keeps the logo's colours
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uHue; // radians
  varying vec2 vUv;

  // Rotate hue around the grey axis (keeps brightness and saturation).
  vec3 rotateHue(vec3 c, float angle) {
    const vec3 k = vec3(0.57735);
    float cosA = cos(angle);
    return c * cosA + cross(k, c) * sin(angle) + k * dot(k, c) * (1.0 - cosA);
  }

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    gl_FragColor = vec4(max(rotateHue(tex.rgb, uHue), 0.0), tex.a);
    #include <colorspace_fragment>
  }
`;

// The late-90s DVD-player screensaver: a logo drifting diagonally across a
// black screen, bouncing off the edges and changing colour on each bounce.
// Render `scene` with `camera`, and call update() each frame.
export class DvdScreensaver {
  readonly scene = new THREE.Scene();
  // Units: the screen is 1 tall and `aspect` wide, centred on the origin.
  readonly camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);

  private readonly logo: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly velocity: THREE.Vector2;
  private readonly hueStep: number;
  private readonly halfSize = new THREE.Vector2();
  private aspect = 1;

  constructor(url: string, options: DvdOptions = {}) {
    this.scene.background = new THREE.Color(0x000000);
    const height = options.height ?? 0.3;
    const speed = options.speed ?? 0.22;
    this.hueStep = options.hueStep ?? 0.17;

    const material = new THREE.ShaderMaterial({
      name: 'dvdLogo',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uMap: { value: null }, uHue: { value: 0 } },
      transparent: true,
    });
    this.logo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.scene.add(this.logo);

    // Sized once the image's proportions are known.
    this.logo.visible = false;
    new THREE.TextureLoader().load(url, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      material.uniforms.uMap.value = texture;
      const image = texture.image as HTMLImageElement;
      this.logo.scale.set((height * image.width) / image.height, height, 1);
      this.halfSize.set(this.logo.scale.x / 2, this.logo.scale.y / 2);
      this.logo.visible = true;
    });

    // Start somewhere random, heading diagonally.
    this.logo.position.set((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, 0);
    this.velocity = new THREE.Vector2(Math.random() < 0.5 ? -1 : 1, Math.random() < 0.5 ? -1 : 1)
      .normalize()
      .multiplyScalar(speed);
  }

  resize(width: number, height: number): void {
    this.aspect = width / height;
    this.camera.left = -this.aspect / 2;
    this.camera.right = this.aspect / 2;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    const p = this.logo.position;
    p.x += this.velocity.x * dt;
    p.y += this.velocity.y * dt;

    // Bounce off each edge, keeping the logo fully on screen.
    const maxX = this.aspect / 2 - this.halfSize.x;
    const maxY = 0.5 - this.halfSize.y;
    let bounced = false;
    if (Math.abs(p.x) > maxX) {
      p.x = Math.sign(p.x) * maxX;
      this.velocity.x = -Math.sign(p.x) * Math.abs(this.velocity.x);
      bounced = true;
    }
    if (Math.abs(p.y) > maxY) {
      p.y = Math.sign(p.y) * maxY;
      this.velocity.y = -Math.sign(p.y) * Math.abs(this.velocity.y);
      bounced = true;
    }
    if (bounced) this.logo.material.uniforms.uHue.value += this.hueStep * Math.PI * 2;
  }
}

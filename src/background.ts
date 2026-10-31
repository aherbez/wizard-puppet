import * as THREE from 'three';
import { SIMPLEX_NOISE_GLSL } from './noise';

export interface BackgroundOptions {
  tilesPerScreenHeight?: number; // how many times the image repeats top to bottom
  speed?: number; // drift speed in tiles per second
  direction?: THREE.Vector2; // drift direction (normalized internally)
  // The image is used as a mask: its black areas get the base colour, its
  // white areas a shimmering brass between the two brass colours.
  baseColor?: THREE.ColorRepresentation;
  brassDark?: THREE.ColorRepresentation;
  brassLight?: THREE.ColorRepresentation;
  shimmer?: number; // 0..1 strength of the moving sheen on the brass
  // Around the screen centre (where the head is) the pattern gives way to a
  // plain colour for contrast, fading in between these radii (in screen
  // heights from the centre).
  centerColor?: THREE.ColorRepresentation;
  centerPattern?: number; // 0..1 how much pattern still shows at the very centre
  centerRadius?: number;
  patternRadius?: number;
}

const VERTEX = /* glsl */ `
  void main() {
    // Full-screen quad at the far plane, independent of the camera.
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  uniform float uTilesPerScreenHeight;
  uniform vec2 uOffset;
  uniform float uImageAspect; // image width / height
  uniform float uTime;
  uniform vec3 uBaseColor;
  uniform vec3 uBrassDark;
  uniform vec3 uBrassLight;
  uniform float uShimmer;
  uniform vec3 uCenterColor;
  uniform float uCenterPattern;
  uniform float uCenterRadius;
  uniform float uPatternRadius;

  ${SIMPLEX_NOISE_GLSL}

  void main() {
    // Tiles sized against the screen height (keeping the image's proportions),
    // so the pattern looks the same at any resolution or aspect ratio.
    vec2 screen = gl_FragCoord.xy / uResolution.y;
    vec2 uv = screen * uTilesPerScreenHeight;
    uv.x /= uImageAspect;
    float line = dot(texture2D(uMap, uv + uOffset).rgb, vec3(0.299, 0.587, 0.114));

    // Brass tone varies in broad, slowly shifting patches across the screen
    // (not with the drifting pattern), like light moving over metal...
    float patches = snoise(vec3(screen * 1.2, uTime * 0.05)) * 0.5 + 0.5;
    vec3 brass = mix(uBrassDark, uBrassLight, patches);
    // ...plus a soft diagonal sheen that slowly sweeps across.
    float sheen = pow(sin(dot(screen, vec2(0.8, 0.6)) * 2.5 - uTime * 0.12) * 0.5 + 0.5, 6.0);
    brass *= 1.0 + uShimmer * sheen;

    vec3 pattern = mix(uBaseColor, brass, line);

    // Plain colour behind the head, fading into the pattern further out. The
    // falloff is a little taller than wide to suit the head and its flames.
    vec2 fromCenter = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
    float distance = length(fromCenter * vec2(1.0, 0.8));
    float patternAmount = mix(uCenterPattern, 1.0, smoothstep(uCenterRadius, uPatternRadius, distance));

    gl_FragColor = vec4(mix(uCenterColor, pattern, patternAmount), 1.0);
    #include <colorspace_fragment>
  }
`;

// A seamless black-and-white image tiled across the whole background as
// hunter green with brass lines, slowly drifting.
// Add it to the scene and call update() each frame.
export class TiledBackground extends THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  private readonly velocity: THREE.Vector2;

  constructor(url: string, options: BackgroundOptions = {}) {
    const texture = new THREE.TextureLoader().load(url, (loaded) => {
      const image = loaded.image as HTMLImageElement;
      material.uniforms.uImageAspect.value = image.width / image.height;
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;

    const material = new THREE.ShaderMaterial({
      name: 'background',
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uMap: { value: texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTilesPerScreenHeight: { value: options.tilesPerScreenHeight ?? 2.6 },
        uOffset: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uBaseColor: { value: new THREE.Color(options.baseColor ?? 0x1f4429) },
        uBrassDark: { value: new THREE.Color(options.brassDark ?? 0x8a6d2f) },
        uBrassLight: { value: new THREE.Color(options.brassLight ?? 0xc9a85a) },
        uShimmer: { value: options.shimmer ?? 0.35 },
        uCenterColor: { value: new THREE.Color(options.centerColor ?? 0x0d2114) },
        uCenterPattern: { value: options.centerPattern ?? 0.1 },
        uCenterRadius: { value: options.centerRadius ?? 0.26 },
        uPatternRadius: { value: options.patternRadius ?? 0.78 },
        uImageAspect: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });

    super(new THREE.PlaneGeometry(2, 2), material);
    this.name = 'background';
    this.frustumCulled = false; // positioned in clip space, not the scene
    this.renderOrder = -1000; // drawn first, behind everything

    const direction = (options.direction ?? new THREE.Vector2(1, 1)).clone().normalize();
    this.velocity = direction.multiplyScalar(options.speed ?? 0.03);

    this.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(material.uniforms.uResolution.value);
    };
  }

  update(dt: number): void {
    const offset: THREE.Vector2 = this.material.uniforms.uOffset.value;
    // Wrap by whole tiles so the offset never grows large enough to lose
    // float precision.
    offset.addScaledVector(this.velocity, dt);
    offset.set(offset.x - Math.floor(offset.x), offset.y - Math.floor(offset.y));
    this.material.uniforms.uTime.value += dt;
  }
}

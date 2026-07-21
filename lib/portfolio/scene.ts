import * as THREE from "three";

import {
  ABOUT_SLOT_ID,
  HERO_NEAR_SLOT_ID,
  HERO_SLOT_ID,
  imageAspect,
  imageSource,
} from "./images";
import {
  type CategoryId,
  getCategory,
  tileSlotId,
} from "./content";

/* -------------------------------------------------------------------------- */
/* Scene layout                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The six portfolio planes, arranged as a gallery wall the camera pans across.
 * `sx`/`sy` define each print's default footprint; the actual geometry is
 * rebuilt per category so its aspect ratio matches the assigned photograph
 * (same area, different shape) — portrait photos hang as portrait prints,
 * landscape as landscape, with no cropping or stretching.
 */
const WALL_POSITIONS = [
  { x: -6, y: 1.3, z: -14.6, sx: 3.6, sy: 2.6 },
  { x: -2, y: 1.7, z: -14.0, sx: 3.2, sy: 2.3 },
  { x: 2, y: 1.7, z: -14.0, sx: 3.2, sy: 2.3 },
  { x: 6, y: 1.3, z: -14.6, sx: 3.6, sy: 2.6 },
  { x: -4, y: -2.0, z: -14.3, sx: 3.0, sy: 2.4 },
  { x: 4, y: -2.0, z: -14.3, sx: 3.0, sy: 2.4 },
];

/**
 * Camera path through the scene, keyed to scroll progress (`p`, 0→1 across the
 * sticky track): push through the hero, sweep left across the wall, sweep
 * right, then continue into the About plane.
 */
/**
 * Journey progress is normalised so that 0 → 1 covers the sticky track (hero,
 * gallery wall, about). The booking section continues the same path beyond 1,
 * up to `BOOKING_PROGRESS_END`, so one scalar drives the whole page rather
 * than the camera stalling the moment the track runs out.
 */
const TRACK_PROGRESS_END = 1.0;
const BOOKING_PROGRESS_END = 1.4;

const CAMERA_KEYFRAMES = [
  { p: 0.0, pos: [0, 0, 6], look: [0, 0, -4] },
  { p: 0.16, pos: [0, 0, 1.2], look: [0, 0, -4] },
  { p: 0.3, pos: [-3.5, 0.2, -8], look: [-3.5, 0.2, -14] },
  { p: 0.55, pos: [3.5, 0.2, -8], look: [3.5, 0.2, -14] },
  { p: 0.64, pos: [0, 0.1, -19], look: [0, 0, -25] },
  { p: 0.85, pos: [1.4, 0.3, -24], look: [-1.8, 0, -27] },
  { p: 1.0, pos: [0, 0.15, -25], look: [-1, 0, -29] },
  // --- booking: the path continues past the sticky track, drifting down and
  // across so the backdrop keeps moving while the section is read. ---
  { p: 1.16, pos: [-1.05, -0.1, -26.5], look: [-1.7, -0.25, -30.4] },
  { p: 1.28, pos: [-0.2, -0.4, -27.4], look: [-0.4, -0.5, -31.2] },
  { p: BOOKING_PROGRESS_END, pos: [1.15, -0.72, -28.4], look: [0.4, -0.8, -32.1] },
] as const;

/** Scroll window in which the gallery wall is close enough to be hoverable. */
const PORTFOLIO_RANGE: readonly [number, number] = [0.18, 0.62];

/** Tint the about print brightens toward while the booking frame is lit. */
const RIM_LIT_TINT = new THREE.Color(0xcfc8b8);

const BLUR_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** 5x5 box blur, used to fake depth-of-field on planes away from the camera. */
const BLUR_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform float blur;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    vec4 c = vec4(0.0);
    float total = 0.0;
    for (int x = -2; x <= 2; x++) {
      for (int y = -2; y <= 2; y++) {
        vec2 o = vec2(float(x), float(y)) * blur * 0.01;
        c += texture2D(map, vUv + o);
        total += 1.0;
      }
    }
    c /= total;
    gl_FragColor = vec4(c.rgb, c.a * opacity);
  }
`;

/** Chromatic-split wipe played over the whole viewport when a tile is opened. */
const WIPE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform float t;
  varying vec2 vUv;
  void main() {
    float split = (1.0 - t) * 0.02;
    vec2 uv = vUv;
    float wipe = smoothstep(uv.x - 0.05, uv.x + 0.05, t * 1.2);
    float r = texture2D(map, uv + vec2(split, 0.0)).r;
    float g = texture2D(map, uv).g;
    float b = texture2D(map, uv - vec2(split, 0.0)).b;
    gl_FragColor = vec4(r, g, b, wipe);
  }
`;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

export function detectWebglSupport(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}

/**
 * Plane geometry with the given aspect ratio (width / height) occupying a
 * fixed area, so photos of different orientations hang at comparable visual
 * weight — like prints of the same paper size in different orientations.
 */
function planeForAspect(aspect: number, area: number): THREE.PlaneGeometry {
  const height = Math.sqrt(area / aspect);
  return new THREE.PlaneGeometry(height * aspect, height);
}

/** Diagonal-hatch fallback drawn whenever a slot has no photograph yet. */
function createPlaceholderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#131316";
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "rgba(244,242,238,0.05)";
  ctx.lineWidth = 2;
  for (let i = -512; i < 512; i += 28) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 512, 512);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Cover-fit an image inside its plane by cropping through UV repeat/offset,
 * so photographs never stretch regardless of their native aspect ratio.
 */
function applyCoverFit(
  texture: THREE.Texture,
  planeAspect: number,
  zoom: number,
): void {
  const image = texture.image as { width?: number; height?: number } | null;
  if (!image?.width || !image.height) return;

  const imageAspect = image.width / image.height;
  if (imageAspect > planeAspect) {
    texture.repeat.set(planeAspect / imageAspect / zoom, 1 / zoom);
  } else {
    texture.repeat.set(1 / zoom, imageAspect / planeAspect / zoom);
  }
  texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2);
}

/* -------------------------------------------------------------------------- */
/* Scene                                                                      */
/* -------------------------------------------------------------------------- */

/** Elements the render loop drives directly, bypassing React for per-frame work. */
export interface JourneyOverlays {
  hero: HTMLElement | null;
  scrollCue: HTMLElement | null;
  portfolio: HTMLElement | null;
  portfolioCaption: HTMLElement | null;
  about: HTMLElement | null;
}

export interface JourneySceneOptions {
  canvas: HTMLCanvasElement;
  /** The tall element whose scroll position maps to camera progress. */
  track: HTMLElement;
  /**
   * The booking section, which extends the camera path past the track. Looked
   * up lazily because it lives outside the journey's subtree and mounts
   * independently.
   */
  getBookingSection: () => HTMLElement | null;
  getOverlays: () => JourneyOverlays;
  parallaxIntensity: number;
  initialCategory: CategoryId;
  onHoverChange: (index: number, caption: string) => void;
  onReady: () => void;
}

export interface ClickTarget {
  index: number;
  texture: THREE.Texture | null;
}

export class JourneyScene {
  private readonly options: JourneySceneOptions;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(-10, -10);

  private readonly farMaterial: THREE.MeshBasicMaterial;
  private readonly farMesh: THREE.Mesh;
  private readonly nearMaterial: THREE.MeshBasicMaterial;
  private readonly nearMesh: THREE.Mesh;
  private readonly aboutMaterial: THREE.MeshBasicMaterial;
  private readonly aboutMesh: THREE.Mesh;
  /**
   * Gold frame just behind the about plane. The plane's face is a dark
   * texture multiplied by a dark tint — near-black on a black page — so on
   * its own, its motion through the booking section is real but invisible.
   * The frame is the bright element that makes that motion legible; it only
   * fades in across the booking range.
   */
  private readonly rimMaterial: THREE.MeshBasicMaterial;
  private readonly rimMesh: THREE.Mesh;
  private readonly wallMeshes: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.ShaderMaterial
  >[];

  private category: CategoryId;
  private ownedTextures = new Set<THREE.Texture>();
  private placeholder: THREE.CanvasTexture;

  /** Smoothed scroll progress; the raw value is eased toward each frame. */
  private progress = 0;
  private mouseRaw = { x: 0, y: 0 };
  private mouseSmooth = { x: 0, y: 0 };
  private hoverIndex = -1;

  private rafId: number | null = null;
  private disposed = false;
  private wipeCanvas: HTMLCanvasElement | null = null;

  constructor(options: JourneySceneOptions) {
    this.options = options;
    this.category = options.initialCategory;
    this.placeholder = createPlaceholderTexture();

    const { canvas } = options;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height, false);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a0a0a, 10, 40);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 80);
    this.camera.position.set(0, 0, 6);

    // Hero backdrop: one plane filling the frame, one tighter crop floating
    // nearer the camera so the two drift apart as the pointer moves.
    this.farMaterial = new THREE.MeshBasicMaterial({
      color: 0x1a1a1c,
      transparent: true,
      opacity: 0.96,
    });
    this.farMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.farMaterial);
    this.farMesh.position.set(0, 0, -4);

    this.nearMaterial = new THREE.MeshBasicMaterial({
      color: 0x232326,
      transparent: true,
      opacity: 0.98,
    });
    // A second, different landscape print floating nearer the camera than the
    // full-bleed backdrop — the hero's two photo layers at different depths.
    this.nearMesh = new THREE.Mesh(
      planeForAspect(imageAspect(HERO_NEAR_SLOT_ID) ?? 1.6, 9.0),
      this.nearMaterial,
    );
    this.nearMesh.position.set(2.4, -0.6, -1);

    this.wallMeshes = WALL_POSITIONS.map((p, index) => {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: this.placeholder },
          blur: { value: 0 },
          opacity: { value: 1 },
        },
        transparent: true,
        vertexShader: BLUR_VERTEX_SHADER,
        fragmentShader: BLUR_FRAGMENT_SHADER,
      });
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(p.sx, p.sy),
        material,
      );
      mesh.position.set(p.x, p.y, p.z);
      // Planes toe inward toward the centre of the wall.
      const baseRotationY = (p.x / 10) * -0.35;
      mesh.rotation.y = baseRotationY;
      mesh.userData = { index, baseRotation: { x: 0, y: baseRotationY } };
      return mesh;
    });

    this.aboutMaterial = new THREE.MeshBasicMaterial({
      color: 0x1a1a1c,
      transparent: true,
    });
    // Geometry matches the about portrait's aspect exactly — no crop.
    const aboutGeometry = planeForAspect(
      imageAspect(ABOUT_SLOT_ID) ?? 0.8,
      12.8,
    );
    this.aboutMesh = new THREE.Mesh(aboutGeometry, this.aboutMaterial);
    this.aboutMesh.position.set(-1.8, 0, -27);

    this.rimMaterial = new THREE.MeshBasicMaterial({
      color: 0xc9a35b,
      transparent: true,
      opacity: 0,
    });
    const aboutSize = aboutGeometry.parameters;
    this.rimMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(aboutSize.width + 0.35, aboutSize.height + 0.35),
      this.rimMaterial,
    );
    this.rimMesh.position.copy(this.aboutMesh.position);
    this.rimMesh.position.z -= 0.06;

    this.scene.add(this.farMesh, this.nearMesh, this.aboutMesh, this.rimMesh);
    this.wallMeshes.forEach((mesh) => this.scene.add(mesh));
  }

  start(): void {
    this.loadTexture(HERO_SLOT_ID, {
      planeAspect: this.camera.aspect,
      zoom: 1,
      apply: (t) => {
        this.farMaterial.map = t;
        this.farMaterial.needsUpdate = true;
      },
    });
    this.loadTexture(HERO_NEAR_SLOT_ID, {
      planeAspect:
        this.nearMesh.geometry instanceof THREE.PlaneGeometry
          ? this.nearMesh.geometry.parameters.width /
            this.nearMesh.geometry.parameters.height
          : 1.6,
      zoom: 1,
      apply: (t) => {
        this.nearMaterial.map = t;
        this.nearMaterial.needsUpdate = true;
      },
    });
    this.loadTexture(ABOUT_SLOT_ID, {
      planeAspect: imageAspect(ABOUT_SLOT_ID) ?? 0.8,
      zoom: 1,
      apply: (t) => {
        this.aboutMaterial.map = t;
        this.aboutMaterial.needsUpdate = true;
      },
    });
    this.loadWallTextures();

    this.sizeFarPlane();
    window.addEventListener("resize", this.handleResize);
    window.addEventListener("mousemove", this.handleMouseMove, {
      passive: true,
    });

    this.options.onReady();
    this.rafId = requestAnimationFrame(this.animate);
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("mousemove", this.handleMouseMove);

    this.ownedTextures.forEach((t) => t.dispose());
    this.ownedTextures.clear();
    this.placeholder.dispose();

    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material as
          | THREE.Material
          | THREE.Material[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    });

    this.wipeCanvas?.remove();
    this.wipeCanvas = null;
    this.renderer.dispose();
  }

  /* ------------------------------ textures ------------------------------- */

  private loadTexture(
    slotId: string,
    opts: {
      planeAspect: number;
      zoom: number;
      apply: (texture: THREE.Texture) => void;
    },
  ): void {
    const source = imageSource(slotId);
    if (!source) {
      opts.apply(this.placeholder);
      return;
    }

    new THREE.TextureLoader().load(
      source,
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        // sRGB decode + trilinear filtering + anisotropy so photos stay
        // crisp at the oblique angles the wall planes sit at. (Pre-r152
        // three used `texture.encoding = sRGBEncoding` for the same thing.)
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        applyCoverFit(texture, opts.planeAspect, opts.zoom);
        this.ownedTextures.add(texture);
        opts.apply(texture);
      },
      undefined,
      () => opts.apply(this.placeholder),
    );
  }

  private loadWallTextures(): void {
    this.wallMeshes.forEach((mesh, index) => {
      const slotId = tileSlotId(this.category, index);
      const base = WALL_POSITIONS[index];

      // Rebuild the print to match this category's photo orientation —
      // same area as the position's default footprint, aspect from the image.
      const aspect = imageAspect(slotId) ?? base.sx / base.sy;
      mesh.geometry.dispose();
      mesh.geometry = planeForAspect(aspect, base.sx * base.sy);

      this.loadTexture(slotId, {
        planeAspect: aspect,
        zoom: 1,
        apply: (texture) => {
          mesh.material.uniforms.map.value = texture;
          mesh.material.needsUpdate = true;
        },
      });
    });
  }

  /**
   * Swings the wall out, swaps in the new category's textures, swings it back.
   * `commit` fires at the midpoint so React state flips while the wall is hidden.
   */
  transitionCategory(next: CategoryId, commit: () => void): void {
    if (next === this.category) return;

    const DURATION = 420;
    const swingOutStart = performance.now();

    const swingIn = (start: number) => {
      const step = (now: number) => {
        if (this.disposed) return;
        const k = Math.min((now - start) / DURATION, 1);
        this.wallMeshes.forEach((mesh) => {
          mesh.rotation.y = mesh.userData.baseRotation.y - (1 - k) * 1.1;
          mesh.material.uniforms.opacity.value = k;
        });
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    const swingOut = (now: number) => {
      if (this.disposed) return;
      const k = Math.min((now - swingOutStart) / DURATION, 1);
      this.wallMeshes.forEach((mesh) => {
        mesh.rotation.y = mesh.userData.baseRotation.y + k * 1.1;
        mesh.material.uniforms.opacity.value = 1 - k;
      });

      if (k < 1) {
        requestAnimationFrame(swingOut);
        return;
      }

      this.category = next;
      commit();
      this.loadWallTextures();
      swingIn(performance.now());
    };

    requestAnimationFrame(swingOut);
  }

  /** Keeps the scene's notion of the active category in sync with React. */
  syncCategory(next: CategoryId): void {
    if (next === this.category) return;
    this.category = next;
    this.loadWallTextures();
  }

  /* ------------------------------- input --------------------------------- */

  private handleMouseMove = (event: MouseEvent) => {
    this.mouseRaw.x = event.clientX / window.innerWidth - 0.5;
    this.mouseRaw.y = event.clientY / window.innerHeight - 0.5;
    this.pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -((event.clientY / window.innerHeight) * 2 - 1),
    );
  };

  private handleResize = () => {
    const canvas = this.options.canvas;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.sizeFarPlane();
  };

  /** Scales the backdrop plane so it always over-fills the frustum. */
  private sizeFarPlane(): void {
    const distance = 6 - this.farMesh.position.z;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const height = 2 * Math.tan(vFov / 2) * distance * 1.4;
    this.farMesh.scale.set(height * this.camera.aspect, height, 1);
  }

  /**
   * The tile currently under the pointer, or null when the wall isn't in
   * range. Returns the live texture so the caller can play a wipe from it.
   */
  getClickTarget(): ClickTarget | null {
    if (this.hoverIndex < 0) return null;
    const [from, to] = PORTFOLIO_RANGE;
    if (this.progress < from || this.progress > to) return null;

    const mesh = this.wallMeshes[this.hoverIndex];
    return {
      index: this.hoverIndex,
      texture: (mesh?.material.uniforms.map.value as THREE.Texture) ?? null,
    };
  }

  /* ----------------------------- render loop ----------------------------- */

  /**
   * Maps window scroll onto the journey's progress scale.
   *
   * The sticky track occupies 0 → `TRACK_PROGRESS_END`. Booking begins exactly
   * where the track ends (its top crosses the viewport bottom at that instant),
   * so it continues seamlessly from there up to `BOOKING_PROGRESS_END` rather
   * than the value saturating and the camera going static.
   */
  private readScrollProgress(): number {
    const trackRect = this.options.track.getBoundingClientRect();
    const trackScrollable = trackRect.height - window.innerHeight;
    const trackProgress =
      trackScrollable > 0 ? clamp01(-trackRect.top / trackScrollable) : 0;

    const booking = this.options.getBookingSection();
    if (!booking) return trackProgress;

    const rect = booking.getBoundingClientRect();
    if (rect.height <= 0) return trackProgress;

    // 0 as the section's top touches the viewport bottom, 1 once its bottom
    // has risen to the viewport bottom.
    const bookingLocal = clamp01(
      (window.innerHeight - rect.top) / rect.height,
    );
    if (bookingLocal <= 0) return trackProgress;

    return (
      TRACK_PROGRESS_END +
      bookingLocal * (BOOKING_PROGRESS_END - TRACK_PROGRESS_END)
    );
  }

  private interpolateCamera(p: number) {
    const keyframes = CAMERA_KEYFRAMES;
    let i = 0;
    while (i < keyframes.length - 2 && p > keyframes[i + 1].p) i++;

    const a = keyframes[i];
    const b = keyframes[i + 1];
    const span = b.p - a.p;
    const t = span > 0 ? clamp01((p - a.p) / span) : 0;
    const e = smoothstep(0, 1, t);

    const lerp3 = (from: readonly number[], to: readonly number[]) =>
      [
        from[0] + (to[0] - from[0]) * e,
        from[1] + (to[1] - from[1]) * e,
        from[2] + (to[2] - from[2]) * e,
      ] as const;

    return { pos: lerp3(a.pos, b.pos), look: lerp3(a.look, b.look) };
  }

  private animate = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    const raw = this.readScrollProgress();
    // Ease toward the true scroll position so the camera glides rather than snaps.
    this.progress += (raw - this.progress) * 0.09;
    const p = this.progress;
    // 0 → 1 across the booking section; 0 everywhere before it.
    const bookingLocal = clamp01(
      (p - TRACK_PROGRESS_END) / (BOOKING_PROGRESS_END - TRACK_PROGRESS_END),
    );

    this.mouseSmooth.x += (this.mouseRaw.x - this.mouseSmooth.x) * 0.05;
    this.mouseSmooth.y += (this.mouseRaw.y - this.mouseSmooth.y) * 0.05;

    const drift = this.options.parallaxIntensity;
    const offsetX = this.mouseSmooth.x * drift * 2.2;
    const offsetY = -this.mouseSmooth.y * drift * 1.6;

    const cam = this.interpolateCamera(p);
    this.camera.position.set(
      cam.pos[0] + offsetX,
      cam.pos[1] + offsetY,
      cam.pos[2],
    );
    this.camera.lookAt(
      cam.look[0] + offsetX * 0.5,
      cam.look[1] + offsetY * 0.5,
      cam.look[2],
    );

    const now = Date.now();
    const idleSway = Math.sin(now * 0.00015) * 0.025;
    this.farMesh.rotation.y = this.mouseSmooth.x * 0.05 + idleSway;
    this.nearMesh.rotation.y =
      this.mouseSmooth.x * 0.12 - 0.05 + idleSway * 1.4;
    this.nearMesh.position.y = -0.6 + Math.sin(now * 0.0004) * 0.05;

    // The about plane is the only backdrop still in front of the camera by the
    // time booking is on screen, so it carries the visible drift. Through
    // booking the motion is driven by scroll position, not by the clock — the
    // idle sway stays only as a low-amplitude term so it never reads as frozen
    // when the page is still.
    const aboutLocal = smoothstep(0.6, 0.9, p);
    const bookingEase = smoothstep(0, 1, bookingLocal);
    this.aboutMesh.rotation.y =
      Math.sin(now * 0.0003) * 0.05 +
      (aboutLocal - 0.5) * 0.12 +
      bookingEase * 0.5;
    this.aboutMesh.rotation.x =
      Math.cos(now * 0.00025) * 0.03 - bookingEase * 0.18;
    this.aboutMesh.position.x = -1.8 + bookingEase * 2.6;
    this.aboutMesh.position.y = bookingEase * -1.05;
    this.aboutMesh.position.z = -27 + bookingEase * 1.6;

    // The gold frame rides with the plane and only exists during booking.
    // Its brightness is what makes the drift visible against the scrim; the
    // dark print face alone has ~2 RGB units of contrast and reads as static.
    this.rimMesh.position.set(
      this.aboutMesh.position.x,
      this.aboutMesh.position.y,
      this.aboutMesh.position.z - 0.06,
    );
    this.rimMesh.rotation.copy(this.aboutMesh.rotation);
    this.rimMaterial.opacity = bookingEase * 0.85;
    // Lift the print face itself as booking progresses, so a real photograph
    // (once supplied) brightens with the frame instead of staying a hole.
    this.aboutMaterial.color.setHex(0x1a1a1c).lerp(RIM_LIT_TINT, bookingEase);

    this.updateHover(p);
    this.updateOverlays(p);

    this.renderer.render(this.scene, this.camera);
  };

  private updateHover(p: number): void {
    const [from, to] = PORTFOLIO_RANGE;
    const inRange = p > from && p < to;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = inRange ? this.raycaster.intersectObjects(this.wallMeshes) : [];
    const hit = hits[0];
    const hitIndex = hit ? (hit.object.userData.index as number) : -1;

    if (hitIndex !== this.hoverIndex) {
      this.hoverIndex = hitIndex;
      const captions = getCategory(this.category).captions;
      this.options.onHoverChange(
        hitIndex,
        hitIndex >= 0 ? captions[hitIndex] : "",
      );
    }

    this.wallMeshes.forEach((mesh) => {
      const isHit = hit?.object === mesh;
      const base = mesh.userData.baseRotation as { x: number; y: number };

      let targetX = base.x;
      let targetY = base.y;
      // The hovered plane tips toward the cursor's position within it.
      if (isHit && hit.uv) {
        targetX = (hit.uv.y - 0.5) * -0.35;
        targetY = base.y + (hit.uv.x - 0.5) * 0.5;
      }
      mesh.rotation.x += (targetX - mesh.rotation.x) * 0.08;
      mesh.rotation.y += (targetY - mesh.rotation.y) * 0.08;

      // Planes sharpen as the camera reaches its ideal viewing distance.
      const distance = this.camera.position.distanceTo(mesh.position);
      const depthBlur = Math.min(Math.abs(distance - 11) / 6, 1) * 0.5;
      const target = isHit ? 0 : depthBlur;
      const uniform = mesh.material.uniforms.blur;
      uniform.value += (target - uniform.value) * 0.1;
    });
  }

  /**
   * Cross-fades the HTML overlays against camera progress. Written straight to
   * the DOM — running this through React state would mean a render per frame.
   */
  private updateOverlays(p: number): void {
    const overlays = this.options.getOverlays();

    const heroOpacity = 1 - smoothstep(0.08, 0.16, p);
    const portfolioOpacity =
      smoothstep(0.2, 0.27, p) * (1 - smoothstep(0.57, 0.64, p));
    const aboutOpacity =
      smoothstep(0.64, 0.71, p) * (1 - smoothstep(0.9, 0.97, p));
    // The canvas dims only slightly through booking — the backdrop has to
    // keep reading through the section's scrim for its motion to be visible.
    const canvasOpacity = 1 - smoothstep(0.95, 1.08, p) * 0.2;

    if (overlays.hero) {
      overlays.hero.style.opacity = String(heroOpacity);
      overlays.hero.style.transform = `translateY(${(1 - heroOpacity) * 24}px)`;
    }
    if (overlays.scrollCue) {
      overlays.scrollCue.style.opacity = String(heroOpacity);
    }
    if (overlays.portfolio) {
      overlays.portfolio.style.opacity = String(portfolioOpacity);
      overlays.portfolio.style.pointerEvents =
        portfolioOpacity > 0.5 ? "auto" : "none";
    }
    if (overlays.portfolioCaption) {
      overlays.portfolioCaption.style.opacity = String(portfolioOpacity);
    }
    if (overlays.about) {
      overlays.about.style.opacity = String(aboutOpacity);
      overlays.about.style.transform = `translateY(-50%) translateX(${
        (1 - aboutOpacity) * 18
      }px)`;
    }
    this.options.canvas.style.opacity = String(canvasOpacity);
  }

  /* ------------------------------ wipe FX -------------------------------- */

  /**
   * Full-screen chromatic wipe from the clicked plane's texture, run on a
   * throwaway renderer so the main loop keeps its own state.
   */
  playRevealTransition(texture: THREE.Texture | null, onDone: () => void): void {
    if (!texture) {
      onDone();
      return;
    }

    if (!this.wipeCanvas) {
      const canvas = document.createElement("canvas");
      canvas.style.cssText =
        "position:fixed;inset:0;z-index:500;pointer-events:none;width:100%;height:100%;";
      document.body.appendChild(canvas);
      this.wipeCanvas = canvas;
    }

    const canvas = this.wipeCanvas;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight, false);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, t: { value: 0 } },
      vertexShader:
        "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }",
      fragmentShader: WIPE_FRAGMENT_SHADER,
      transparent: true,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    const start = performance.now();
    const DURATION = 480;

    const step = (now: number) => {
      const k = Math.min((now - start) / DURATION, 1);
      material.uniforms.t.value = k;
      renderer.render(scene, camera);

      if (k < 1) {
        requestAnimationFrame(step);
        return;
      }

      canvas.style.display = "none";
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();
      onDone();
    };

    requestAnimationFrame(step);
  }
}

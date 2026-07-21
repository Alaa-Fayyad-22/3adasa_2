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

/** Number of photographs per category on the 3D journey. */
const WALL_PLANE_COUNT = 6;

/* -------------------------------------------------------------------------- */
/* Moment layout                                                              */
/*                                                                            */
/* The six photographs are arranged as a SEQUENCE OF MOMENTS along the        */
/* existing camera path rather than a static scattered wall. Each moment is   */
/* placed on the camera's own look-ray at a fixed focus distance, at a chosen */
/* progress station — so when the visitor scrolls to that station, the        */
/* composition sits centred, fully in frame, facing the camera, and sharp.    */
/*                                                                            */
/* Stations are chosen so consecutive moments are separated along the path's  */
/* own travel (the early stations sit on the approach, the last on the exit   */
/* plunge): the camera passes THROUGH a spent moment, which exits behind it,  */
/* instead of leaving it parked beside the next composition. The existing     */
/* distance-blur then reads correctly for free — a moment is sharp only when  */
/* the camera is at its station, and the next moment ahead is strongly        */
/* blurred until approached. The camera path itself is untouched.             */
/* -------------------------------------------------------------------------- */

/** Focus distance from camera to a moment's centre plane. */
const FOCUS_DISTANCE_DESKTOP = 6;
const FOCUS_DISTANCE_MOBILE = 4.5;

/** Below this canvas CSS width, compose one photograph per moment. */
const MOBILE_LAYOUT_MAX_WIDTH = 700;

/**
 * Progress stations per moment count. Hand-placed against CAMERA_KEYFRAMES so
 * consecutive stations differ meaningfully in camera position (approach depth
 * → pan → exit depth), which is what keeps moments from overlapping at rest.
 */
const MOMENT_STATIONS: Record<number, number[]> = {
  1: [0.42],
  2: [0.26, 0.52],
  3: [0.24, 0.42, 0.585],
  6: [0.23, 0.31, 0.395, 0.465, 0.535, 0.6],
};

/** Vertical keep-out for the fixed header / tab row, in CSS pixels. */
const HEADER_KEEPOUT_PX = 170;

interface PlannedPlane {
  /** Tile index 0..5 within the category. */
  index: number;
  center: THREE.Vector3;
  width: number;
  height: number;
  /** Camera position of this plane's station — planes face it. */
  stationEye: THREE.Vector3;
  /** Distance to the station eye; the blur target treats this as "sharp". */
  sharpDistance: number;
}

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
  private lastFrameAt = 0;
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

    this.wallMeshes = Array.from({ length: WALL_PLANE_COUNT }, (_, index) => {
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
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      mesh.userData = {
        index,
        baseRotation: { x: 0, y: 0 },
        sharpDistance: FOCUS_DISTANCE_DESKTOP,
      };
      return mesh;
      // Position, size, and facing come from applyWallLayout — deferred to
      // loadWallTextures, which knows the active category's photo aspects.
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

  /* --------------------------- moment layout ----------------------------- */

  /** Camera pose at a station, as vectors plus the forward/right/up frame. */
  private stationFrame(p: number) {
    const { pos, look } = this.interpolateCamera(p);
    const eye = new THREE.Vector3(pos[0], pos[1], pos[2]);
    const target = new THREE.Vector3(look[0], look[1], look[2]);
    const forward = target.clone().sub(eye).normalize();
    const right = new THREE.Vector3()
      .crossVectors(forward, new THREE.Vector3(0, 1, 0))
      .normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    return { eye, forward, right, up };
  }

  /**
   * Plans the six planes as composed moments for the active category.
   * All sizes derive from the viewport frustum at the focus distance, so
   * compositions fit with margins on any screen and clear the fixed header.
   */
  private computeWallLayout(): PlannedPlane[] {
    const canvas = this.options.canvas;
    const viewW = canvas.clientWidth || window.innerWidth;
    const viewH = canvas.clientHeight || window.innerHeight;
    const viewAspect = viewW / viewH;
    const isMobile = viewW < MOBILE_LAYOUT_MAX_WIDTH;
    const D = isMobile ? FOCUS_DISTANCE_MOBILE : FOCUS_DISTANCE_DESKTOP;

    // Visible half-extents at the focus distance.
    const halfH = D * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfW = halfH * viewAspect;
    // Push compositions down so nothing sits under the header / tab row —
    // but only partially, keeping clearance above the fold as well.
    const headerWorld = (HEADER_KEEPOUT_PX / viewH) * 2 * halfH;
    const dropY = -headerWorld * 0.32;

    const aspects = Array.from({ length: WALL_PLANE_COUNT }, (_, i) =>
      imageAspect(tileSlotId(this.category, i)) ?? 1.5,
    );
    const allPortrait = aspects.every((a) => a < 1);

    // Chunk into moments: singles on phones; triptychs for an all-portrait
    // category; pairs otherwise (landscape–landscape or landscape–portrait).
    const chunks: number[][] = isMobile
      ? aspects.map((_, i) => [i])
      : allPortrait
        ? [
            [0, 1, 2],
            [3, 4, 5],
          ]
        : [
            [0, 1],
            [2, 3],
            [4, 5],
          ];

    const stations = MOMENT_STATIONS[chunks.length] ?? MOMENT_STATIONS[3];
    const planes: PlannedPlane[] = [];

    chunks.forEach((chunk, k) => {
      const { eye, forward, right, up } = this.stationFrame(stations[k]);
      const base = eye
        .clone()
        .addScaledVector(forward, D)
        .addScaledVector(up, dropY);

      const place = (
        index: number,
        lateral: number,
        vertical: number,
        depth: number,
        width: number,
        height: number,
      ) => {
        const center = base
          .clone()
          .addScaledVector(right, lateral)
          .addScaledVector(up, vertical)
          .addScaledVector(forward, depth);
        planes.push({
          index,
          center,
          width,
          height,
          stationEye: eye,
          sharpDistance: center.distanceTo(eye),
        });
      };

      if (chunk.length === 1) {
        // Single, centred, sized to fit the width with margins.
        const a = aspects[chunk[0]];
        let width = 2 * halfW * 0.78;
        let height = width / a;
        const maxH = 2 * (halfH - headerWorld / 2) * 0.8;
        if (height > maxH) {
          height = maxH;
          width = height * a;
        }
        place(chunk[0], 0, 0, 0, width, height);
      } else if (chunk.length === 3) {
        // Triptych: centre print slightly forward, flanks slightly behind.
        const [l, c, r] = chunk;
        const hC = 2 * (halfH - headerWorld / 2) * 0.62;
        const wC = hC * aspects[c];
        const hF = hC * 0.82;
        const wL = hF * aspects[l];
        const wR = hF * aspects[r];
        const gap = 0.24;
        place(c, 0, 0, 0.28, wC, hC);
        place(l, -(wC / 2 + wL / 2 + gap), -0.06, -0.7, wL, hF);
        place(r, wC / 2 + wR / 2 + gap, -0.06, -0.7, wR, hF);
      } else {
        // Pair: the more landscape image larger and behind, the other
        // smaller and nearer, offset to the opposite side.
        const [first, second] = chunk;
        const backIdx = aspects[first] >= aspects[second] ? first : second;
        const frontIdx = backIdx === first ? second : first;

        const usableH = 2 * (halfH - headerWorld / 2);
        let wB = 2 * halfW * 0.42;
        let hB = wB / aspects[backIdx];
        const maxHB = usableH * 0.66;
        if (hB > maxHB) {
          hB = maxHB;
          wB = hB * aspects[backIdx];
        }
        let hF = usableH * 0.56;
        let wF = hF * aspects[frontIdx];
        const maxWF = 2 * halfW * 0.34;
        if (wF > maxWF) {
          wF = maxWF;
          hF = wF / aspects[frontIdx];
        }

        const lateralB = -(halfW * 0.26);
        const lateralF = halfW * 0.32;
        place(backIdx, lateralB, 0.12, -0.8, wB, hB);
        place(frontIdx, lateralF, -0.3, 0.45, wF, hF);
      }
    });

    return planes;
  }

  /** Applies the planned layout to the meshes: size, position, facing. */
  private applyWallLayout(): void {
    const planned = this.computeWallLayout();
    for (const plan of planned) {
      const mesh = this.wallMeshes[plan.index];
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(plan.width, plan.height);
      mesh.position.copy(plan.center);
      mesh.lookAt(plan.stationEye);
      mesh.userData.baseRotation = { x: mesh.rotation.x, y: mesh.rotation.y };
      mesh.userData.sharpDistance = plan.sharpDistance;
    }
  }

  private loadWallTextures(): void {
    // Compose this category's moments first — geometry aspect then matches
    // each photograph exactly, so textures map 1:1 with no crop or stretch.
    this.applyWallLayout();

    this.wallMeshes.forEach((mesh, index) => {
      const slotId = tileSlotId(this.category, index);
      const { width, height } = (mesh.geometry as THREE.PlaneGeometry)
        .parameters;

      this.loadTexture(slotId, {
        planeAspect: width / height,
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
    // Recompose the moments for the new viewport shape (and possibly a
    // different desktop/mobile grouping).
    this.applyWallLayout();
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
    // Ease toward the true scroll position so the camera glides rather than
    // snaps. Frame-rate independent: at 60fps this is the classic 0.09/frame
    // chase, but a throttled tab (occluded window, background) still
    // converges instead of crawling one tiny step per sparse callback.
    const frameNow = performance.now();
    const dt = this.lastFrameAt
      ? Math.min((frameNow - this.lastFrameAt) / 1000, 0.25)
      : 1 / 60;
    this.lastFrameAt = frameNow;
    this.progress += (raw - this.progress) * (1 - Math.exp(-dt * 5.65));
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

      // Planes sharpen as the camera reaches their moment's station: sharp
      // at each plane's own focus distance, strongly blurred while it still
      // belongs to a previous or upcoming moment.
      const distance = this.camera.position.distanceTo(mesh.position);
      const sharpAt = (mesh.userData.sharpDistance as number) ?? 6;
      const depthBlur = Math.min(Math.abs(distance - sharpAt) / 5, 1) * 0.55;
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

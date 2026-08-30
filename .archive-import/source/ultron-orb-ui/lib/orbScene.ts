import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * OrbScene — the fractured intelligence core.
 *
 * Visual language: this isn't a clean holographic sphere. It's a cracked
 * iron shell — plates of wireframe that don't quite meet, seams that glow
 * ember-red from the molten spiral core underneath, shards of the shell
 * still tumbling in orbit like it's mid-assembly (or mid-collapse).
 */

const COLORS = {
  oxblood: 0x7a1e1e,
  ember: 0xd4401f,
  amber: 0xd69a34,
  ash: 0xcdc4b8,
  void: 0x0a0806,
};

export interface OrbSceneHandle {
  applyDrag: (dx: number, dy: number) => void;
  applyZoom: (delta: number) => void;
  resetView: () => void;
  resize: () => void;
  dispose: () => void;
  setHudActive: (active: boolean) => void;
}

export function createOrbScene(
  container: HTMLElement,
  canvas: HTMLCanvasElement
): OrbSceneHandle {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(COLORS.void, 0.045);

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  const baseCameraDistance = 8.5;
  camera.position.set(0, 0.4, baseCameraDistance);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(COLORS.void, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);

  // ---------------------------------------------------------------------
  // Lighting — a single hot key light from below-front (molten glow feel)
  // ---------------------------------------------------------------------
  const keyLight = new THREE.PointLight(COLORS.ember, 12, 20, 2);
  keyLight.position.set(2, -1.5, 3);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(COLORS.oxblood, 6, 25, 2);
  rimLight.position.set(-3, 2, -4);
  scene.add(rimLight);

  scene.add(new THREE.AmbientLight(0x1a0f0c, 1.2));

  // ---------------------------------------------------------------------
  // Core group — everything that spins together with drag/gesture input
  // ---------------------------------------------------------------------
  const core = new THREE.Group();
  scene.add(core);

  // -- Fractured wireframe shells ---------------------------------------
  // Each shell is an icosahedron whose edge geometry has had a random
  // subset of edges culled, so the plates read as broken rather than a
  // clean geodesic net.
  function buildFracturedShell(radius: number, detail: number, cullFraction: number) {
    const geo = new THREE.IcosahedronGeometry(radius, detail);
    const edges = new THREE.EdgesGeometry(geo, 1);
    const positions = edges.attributes.position.array as Float32Array;
    const kept: number[] = [];
    for (let i = 0; i < positions.length; i += 6) {
      if (Math.random() > cullFraction) {
        kept.push(
          positions[i],
          positions[i + 1],
          positions[i + 2],
          positions[i + 3],
          positions[i + 4],
          positions[i + 5]
        );
      }
    }
    const culledGeo = new THREE.BufferGeometry();
    culledGeo.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
    return culledGeo;
  }

  const shells: { mesh: THREE.LineSegments; spin: THREE.Vector3; speed: number }[] = [];

  const shellSpecs = [
    { radius: 2.2, detail: 2, cull: 0.12, color: COLORS.ash, opacity: 0.85 },
    { radius: 2.55, detail: 1, cull: 0.22, color: COLORS.oxblood, opacity: 0.55 },
    { radius: 2.9, detail: 1, cull: 0.35, color: COLORS.ember, opacity: 0.3 },
  ];

  shellSpecs.forEach((spec) => {
    const geo = buildFracturedShell(spec.radius, spec.detail, spec.cull);
    const mat = new THREE.LineBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: spec.opacity,
    });
    const mesh = new THREE.LineSegments(geo, mat);
    core.add(mesh);
    shells.push({
      mesh,
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02 + 0.05,
        (Math.random() - 0.5) * 0.01
      ),
      speed: 1,
    });
  });

  // -- Molten spiral core -------------------------------------------------
  // A tight spiral line pulsing ember/amber — the "engine" visible through
  // the cracks in the shells.
  function buildSpiralGeometry(turns: number, points: number, radius: number) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= points; i++) {
      const t = i / points;
      const angle = t * Math.PI * 2 * turns;
      const r = radius * (0.15 + 0.85 * Math.sin(t * Math.PI));
      pts.push(
        new THREE.Vector3(
          Math.cos(angle) * r,
          (t - 0.5) * radius * 1.6,
          Math.sin(angle) * r
        )
      );
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  const spiralGeo = buildSpiralGeometry(9, 400, 1.3);
  const spiralMat = new THREE.LineBasicMaterial({
    color: COLORS.ember,
    transparent: true,
    opacity: 0.9,
  });
  const spiral = new THREE.Line(spiralGeo, spiralMat);
  core.add(spiral);

  const coreGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 24, 24),
    new THREE.MeshBasicMaterial({
      color: COLORS.ember,
      transparent: true,
      opacity: 0.25,
    })
  );
  core.add(coreGlow);

  // -- Orbiting debris shards ---------------------------------------------
  const debrisGroup = new THREE.Group();
  core.add(debrisGroup);
  const debrisCount = 18;
  const debris: {
    mesh: THREE.Mesh;
    orbitRadius: number;
    orbitSpeed: number;
    orbitOffset: number;
    tumble: THREE.Vector3;
    yOffset: number;
  }[] = [];

  for (let i = 0; i < debrisCount; i++) {
    const size = 0.05 + Math.random() * 0.11;
    const geo = new THREE.TetrahedronGeometry(size, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: Math.random() > 0.5 ? COLORS.oxblood : COLORS.ash,
      roughness: 0.4,
      metalness: 0.8,
      emissive: COLORS.ember,
      emissiveIntensity: 0.08,
    });
    const mesh = new THREE.Mesh(geo, mat);
    debrisGroup.add(mesh);
    debris.push({
      mesh,
      orbitRadius: 3.2 + Math.random() * 1.6,
      orbitSpeed: 0.15 + Math.random() * 0.25,
      orbitOffset: Math.random() * Math.PI * 2,
      tumble: new THREE.Vector3(
        Math.random() * 2,
        Math.random() * 2,
        Math.random() * 2
      ),
      yOffset: (Math.random() - 0.5) * 2.2,
    });
  }

  // -- Scan rings -----------------------------------------------------------
  const scanRings: { mesh: THREE.Mesh; speed: number }[] = [];
  [3.4, 4.1].forEach((r, idx) => {
    const geo = new THREE.TorusGeometry(r, 0.008, 8, 128);
    const mat = new THREE.MeshBasicMaterial({
      color: idx === 0 ? COLORS.amber : COLORS.oxblood,
      transparent: true,
      opacity: 0.35,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2 + (idx === 0 ? 0.15 : -0.25);
    core.add(mesh);
    scanRings.push({ mesh, speed: idx === 0 ? 0.12 : -0.08 });
  });

  // -- Floating glyph sprites -------------------------------------------
  // Small canvas-texture sprites bearing hex/binary fragments, drifting
  // around the shell like readout fragments the core is still parsing.
  function makeGlyphTexture(text: string): THREE.Texture {
    const size = 128;
    const cnv = document.createElement("canvas");
    cnv.width = size;
    cnv.height = size;
    const ctx = cnv.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(212,64,31,0.9)";
    ctx.font = "600 22px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, size / 2, size / 2);
    const tex = new THREE.CanvasTexture(cnv);
    tex.needsUpdate = true;
    return tex;
  }

  const glyphPool = [
    "0xF3",
    "0x1A",
    "ERR",
    "SYN",
    "0xC7",
    "NULL",
    "0x9E",
    "PING",
    "0x4B",
    "CORE",
  ];
  const glyphSprites: { sprite: THREE.Sprite; radius: number; speed: number; offset: number; yOff: number }[] = [];
  glyphPool.forEach((g) => {
    const mat = new THREE.SpriteMaterial({
      map: makeGlyphTexture(g),
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.5, 0.5, 0.5);
    core.add(sprite);
    glyphSprites.push({
      sprite,
      radius: 3.6 + Math.random() * 1.2,
      speed: 0.08 + Math.random() * 0.12,
      offset: Math.random() * Math.PI * 2,
      yOff: (Math.random() - 0.5) * 2.8,
    });
  });

  // -- Dust particle field ------------------------------------------------
  const dustCount = 900;
  const dustGeo = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    const r = 4.5 + Math.random() * 6;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    dustPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    dustPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    dustPositions[i * 3 + 2] = r * Math.cos(phi);
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({
    color: COLORS.ash,
    size: 0.012,
    transparent: true,
    opacity: 0.4,
    sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // ---------------------------------------------------------------------
  // Post-processing — bloom for the molten glow, subtle chromatic
  // aberration so the whole thing feels like a damaged sensor feed.
  // ---------------------------------------------------------------------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(container.clientWidth, container.clientHeight),
    0.85, // strength
    0.55, // radius
    0.18 // threshold
  );
  composer.addPass(bloomPass);

  const chromaticAberrationShader = {
    uniforms: {
      tDiffuse: { value: null },
      amount: { value: 0.0022 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float amount;
      varying vec2 vUv;
      void main() {
        vec2 dir = vUv - vec2(0.5);
        float r = texture2D(tDiffuse, vUv - dir * amount).r;
        float g = texture2D(tDiffuse, vUv).g;
        float b = texture2D(tDiffuse, vUv + dir * amount).b;
        float vignette = smoothstep(0.9, 0.35, length(dir));
        gl_FragColor = vec4(r, g, b, 1.0) * mix(0.75, 1.0, vignette);
      }
    `,
  };
  const chromaPass = new ShaderPass(chromaticAberrationShader);
  chromaPass.renderToScreen = true;
  composer.addPass(chromaPass);

  // ---------------------------------------------------------------------
  // Interaction state
  // ---------------------------------------------------------------------
  let yaw = 0.4;
  let pitch = 0.15;
  let zoomDistance = baseCameraDistance;
  let hudActive = false;

  function applyDrag(dx: number, dy: number) {
    yaw += dx * 0.006;
    pitch += dy * 0.006;
    pitch = Math.max(-1.1, Math.min(1.1, pitch));
  }

  function applyZoom(delta: number) {
    zoomDistance += delta;
    zoomDistance = Math.max(4.5, Math.min(16, zoomDistance));
  }

  function resetView() {
    yaw = 0.4;
    pitch = 0.15;
    zoomDistance = baseCameraDistance;
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloomPass.setSize(w, h);
  }

  function setHudActive(active: boolean) {
    hudActive = active;
  }

  // ---------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------
  const clock = new THREE.Clock();
  let rafId = 0;

  function tick() {
    rafId = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();
    const dt = clock.getDelta();

    // gentle idle auto-rotation, layered on top of drag/gesture input
    core.rotation.y = yaw + t * 0.05;
    core.rotation.x = pitch;

    camera.position.x = Math.sin(t * 0.02) * 0.2;
    camera.position.z = zoomDistance;
    camera.lookAt(0, 0, 0);

    shells.forEach((s, i) => {
      s.mesh.rotation.x += s.spin.x * dt * 20;
      s.mesh.rotation.y += s.spin.y * dt * 20;
      s.mesh.rotation.z += s.spin.z * dt * 20;
    });

    spiral.rotation.y += dt * 0.4;
    const pulse = 0.7 + Math.sin(t * 3.2) * 0.3;
    (coreGlow.material as THREE.MeshBasicMaterial).opacity = 0.18 + pulse * 0.12;
    coreGlow.scale.setScalar(0.9 + pulse * 0.15);
    keyLight.intensity = hudActive ? 16 + pulse * 4 : 10 + pulse * 3;

    debris.forEach((d) => {
      const angle = t * d.orbitSpeed + d.orbitOffset;
      d.mesh.position.set(
        Math.cos(angle) * d.orbitRadius,
        d.yOffset + Math.sin(t * 0.3 + d.orbitOffset) * 0.3,
        Math.sin(angle) * d.orbitRadius
      );
      d.mesh.rotation.x += d.tumble.x * dt;
      d.mesh.rotation.y += d.tumble.y * dt;
      d.mesh.rotation.z += d.tumble.z * dt;
    });

    scanRings.forEach((r) => {
      r.mesh.rotation.z += r.speed * dt;
    });

    glyphSprites.forEach((g) => {
      const angle = t * g.speed + g.offset;
      g.sprite.position.set(
        Math.cos(angle) * g.radius,
        g.yOff + Math.sin(t * 0.5 + g.offset) * 0.4,
        Math.sin(angle) * g.radius
      );
      const mat = g.sprite.material as THREE.SpriteMaterial;
      mat.opacity = 0.35 + (Math.sin(t * 2 + g.offset) * 0.5 + 0.5) * 0.35;
    });

    dust.rotation.y += dt * 0.01;

    composer.render();
  }
  tick();

  function dispose() {
    cancelAnimationFrame(rafId);
    composer.dispose();
    renderer.dispose();
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments || obj instanceof THREE.Line) {
        obj.geometry?.dispose();
        const mat = obj.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else {
          mat?.dispose();
        }
      }
      if (obj instanceof THREE.Sprite) {
        obj.material?.map?.dispose();
        obj.material?.dispose();
      }
    });
  }

  return { applyDrag, applyZoom, resetView, resize, dispose, setHudActive };
}

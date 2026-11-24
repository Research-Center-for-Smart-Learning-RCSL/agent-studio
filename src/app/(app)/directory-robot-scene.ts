import {
  CapsuleGeometry,
  CircleGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  QuadraticBezierCurve3,
  Scene,
  Shape,
  SphereGeometry,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from "three";

export type RobotPose = "idle" | "wave" | "happy" | "heart";

const patrol = [
  { start: 2.6, end: 4.6, from: 0, to: 1, hops: 2 },
  { start: 5.1, end: 9.1, from: 1, to: -1, hops: 4 },
  { start: 9.6, end: 11.6, from: -1, to: 0, hops: 2 },
];

const torsoBase = 0.225;
const torsoHeightScale = 0.78;
const torsoRest = torsoBase + 0.725 * torsoHeightScale;
const neckRest = torsoRest + 0.48 * torsoHeightScale;
const headRest = neckRest + 0.41;
const shoulderX = 0.425;
const shoulderY = torsoBase + 0.935 * torsoHeightScale;

function hopAt(phase: number) {
  const flight = MathUtils.clamp((phase - 0.24) / 0.56, 0, 1);
  const anticipation = MathUtils.smoothstep(phase, 0, 0.18) * (1 - MathUtils.smoothstep(phase, 0.18, 0.28));
  const landing = MathUtils.smoothstep(phase, 0.77, 0.87) * (1 - MathUtils.smoothstep(phase, 0.87, 1));
  return {
    distance: MathUtils.smoothstep(flight, 0, 1),
    lift: 4 * flight * (1 - flight),
    squash: 0.25 * anticipation + 0.15 * landing,
  };
}

function createTorsoGeometry() {
  const outline = new Shape();
  outline.moveTo(-0.245, 0.43);
  outline.lineTo(0.245, 0.43);
  outline.quadraticCurveTo(0.329, 0.43, 0.365, 0.31);
  outline.bezierCurveTo(0.43, 0.13, 0.54, -0.14, 0.54, -0.36);
  outline.quadraticCurveTo(0.54, -0.63, 0.3, -0.63);
  outline.lineTo(-0.3, -0.63);
  outline.quadraticCurveTo(-0.54, -0.63, -0.54, -0.36);
  outline.bezierCurveTo(-0.54, -0.14, -0.43, 0.13, -0.365, 0.31);
  outline.quadraticCurveTo(-0.329, 0.43, -0.245, 0.43);
  const geometry = new ExtrudeGeometry(outline, {
    depth: 0.34,
    bevelSize: 0.095,
    bevelThickness: 0.085,
    bevelSegments: 4,
    curveSegments: 12,
  });
  return geometry.translate(0, 0, -0.17);
}

function createFaceGeometry(halfWidth: number, halfHeight: number, depth: number, bevel: number) {
  const edge = halfWidth * 0.74;
  const side = halfWidth + (halfWidth - edge) / 3;
  const outline = new Shape();
  outline.moveTo(-edge, halfHeight);
  outline.lineTo(edge, halfHeight);
  outline.bezierCurveTo(side, halfHeight, side, -halfHeight, edge, -halfHeight);
  outline.lineTo(-edge, -halfHeight);
  outline.bezierCurveTo(-side, -halfHeight, -side, halfHeight, -edge, halfHeight);
  return new ExtrudeGeometry(outline, {
    depth,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 4,
    curveSegments: 24,
  }).translate(0, 0, -depth / 2);
}

function createRobot() {
  const root = new Group();
  const head = new Group();
  const torso = new Group();
  const shell = new MeshStandardMaterial({ color: "#afc6d6", roughness: 0.36, metalness: 0.12 });
  const trim = new MeshStandardMaterial({ color: "#6e91a8", roughness: 0.5 });
  const visor = new MeshStandardMaterial({ color: "#183447", roughness: 0.56, emissive: "#102532", emissiveIntensity: 0.28 });
  const glow = new MeshBasicMaterial({ color: "#d6f5ec" });
  const mint = new MeshStandardMaterial({ color: "#a6dac7", emissive: "#6baa94", emissiveIntensity: 0.27 });
  const pink = new MeshBasicMaterial({ color: "#e9a9b7" });
  const sphere = new SphereGeometry(1, 18, 12);

  function add(parent: Group, geometry: BufferGeometry, material: MeshStandardMaterial | MeshBasicMaterial, x: number, y: number, z: number) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  add(head, createFaceGeometry(0.607, 0.365, 0.502, 0.093), shell, 0, 0, 0);
  add(head, createFaceGeometry(0.525, 0.282, 0.11, 0.057), visor, 0, 0, 0.3);
  add(head, new CapsuleGeometry(0.026, 0.16, 5, 10), trim, 0, 0.52, 0);
  add(head, sphere, mint, 0, 0.64, 0).scale.setScalar(0.087);
  head.position.y = headRest;
  root.add(head);

  const eyes = [-1, 1].map((side) => {
    add(head, sphere, pink, 0.36 * side, -0.095, 0.407).scale.set(0.069, 0.034, 0.023);
    return add(head, sphere, glow, 0.2 * side, 0.078, 0.411);
  });
  const smile = new QuadraticBezierCurve3(
    new Vector3(-0.095, -0.079, 0.414),
    new Vector3(0, -0.164, 0.431),
    new Vector3(0.095, -0.079, 0.414),
  );
  add(head, new TubeGeometry(smile, 10, 0.016, 6, false), glow, 0, 0, 0);

  add(torso, createTorsoGeometry(), shell, 0, 0, 0);
  add(torso, sphere, trim, 0, 0.1, 0.251).scale.set(0.092, 0.092, 0.035);
  add(torso, sphere, mint, 0, 0.1, 0.279).scale.set(0.055, 0.055, 0.022);
  add(torso, new CapsuleGeometry(0.106, 0.09, 5, 12), trim, 0, 0.48, 0);
  torso.position.y = torsoRest;
  root.add(torso);

  const armShape = new CapsuleGeometry(0.109, 0.25, 5, 12);
  const arms = [-1, 1].map((side) => {
    const joint = new Group();
    joint.position.set(shoulderX * side, shoulderY, 0.135);
    add(joint, sphere, trim, 0, 0, 0).scale.setScalar(0.123);
    add(joint, armShape, trim, 0, -0.2, 0);
    add(joint, sphere, shell, 0, -0.42, 0).scale.setScalar(0.181);
    root.add(joint);
    return joint;
  });
  return { root, torso, head, eyes, arms };
}

function createHeart() {
  const shape = new Shape();
  shape.moveTo(0, -0.25);
  shape.bezierCurveTo(-0.42, 0.025, -0.42, 0.26, -0.23, 0.29);
  shape.bezierCurveTo(-0.13, 0.31, -0.045, 0.26, 0, 0.18);
  shape.bezierCurveTo(0.045, 0.26, 0.13, 0.31, 0.23, 0.29);
  shape.bezierCurveTo(0.42, 0.26, 0.42, 0.025, 0, -0.25);
  return new Mesh(
    new ExtrudeGeometry(shape, { depth: 0.075, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2, curveSegments: 8 }),
    new MeshStandardMaterial({ color: "#ef9db3", roughness: 0.46, emissive: "#ac435c", emissiveIntensity: 0.18 }),
  );
}

export function mountRobotScene(host: HTMLElement, onContextLost: () => void) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
  if (!context) return null;

  const renderer = new WebGLRenderer({ canvas, context, alpha: true });
  const scene = new Scene();
  const camera = new OrthographicCamera(-2, 2, 1.59, -1.59, 0.1, 25);
  camera.position.set(0, 2.23, 7);
  camera.lookAt(0, 1.3, 0);
  scene.add(new HemisphereLight("#eef8ff", "#668097", 2.15));
  const key = new DirectionalLight("#fff4eb", 2.05);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const rim = new DirectionalLight("#a8d4ed", 1.2);
  rim.position.set(3, 2, -3);
  scene.add(rim);

  const { root, torso, head, eyes, arms } = createRobot();
  const heart = createHeart();
  heart.visible = false;
  scene.add(root, heart);

  const shadow = new Group();
  const circle = new CircleGeometry(1, 32);
  for (const [index, opacity] of [0.08, 0.1, 0.12, 0.13].entries()) {
    const layer = new Mesh(circle, new MeshBasicMaterial({ color: "#0c1e30", transparent: true, opacity, depthWrite: false }));
    layer.rotation.x = -Math.PI / 2;
    layer.position.y = index * 0.001;
    layer.scale.set(0.66 - index * 0.08, 0.4 - index * 0.045, 1);
    shadow.add(layer);
  }
  scene.add(shadow);

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let inView = true;
  let running = false;
  let lastFrame: number | null = null;
  let patrolTime = 0;
  let poseTime = 0;
  let pose: RobotPose = "idle";
  let attentive = false;
  let travelRange = 0;
  let lean = 0;
  let squash = 0;
  let elevation = 0;
  root.rotation.y = 0.16;

  function render(dt: number) {
    const reduced = motion.matches;
    const exploring = pose === "idle" && !attentive && !reduced;
    if (exploring) patrolTime = (patrolTime + dt) % 15;
    poseTime += dt;
    const segment = patrol.find(({ end }) => patrolTime < end);
    const turning = Boolean(exploring && segment && patrolTime >= segment.start - 0.5);
    const hopping = Boolean(exploring && segment && patrolTime >= segment.start);
    const cycle = segment
      ? MathUtils.clamp((patrolTime - segment.start) / (segment.end - segment.start), 0, 1) * segment.hops
      : 0;
    const completed = Math.floor(cycle);
    const patrolHop = hopAt(cycle - completed);
    const routeX = segment
      ? MathUtils.lerp(segment.from, segment.to, (completed + patrolHop.distance) / segment.hops) * travelRange
      : 0;
    const direction = segment ? Math.sign(segment.to - segment.from) : 0;

    if (exploring) root.position.x = routeX;
    if (reduced) {
      root.position.x = 0;
      patrolTime = 0;
    }
    const yaw = turning ? direction * 0.96 : 0.16;
    root.rotation.y = reduced ? 0.16 : MathUtils.damp(root.rotation.y, yaw, 8, dt);

    const cheering = !reduced && pose === "happy" && poseTime < 1.6;
    if (hopping) {
      elevation = patrolHop.lift * 0.45;
      squash = patrolHop.squash;
    } else if (cheering) {
      const cheerHop = hopAt((poseTime / 0.8) % 1);
      elevation = cheerHop.lift * 0.36;
      squash = cheerHop.squash;
    } else {
      elevation = reduced ? 0 : MathUtils.damp(elevation, 0, 14, dt);
      squash = reduced ? 0 : MathUtils.damp(squash, 0, 16, dt);
    }
    lean = reduced ? 0 : MathUtils.damp(lean, hopping ? direction * patrolHop.lift : 0, 10, dt);
    root.position.y = -0.15 + elevation;
    root.rotation.z = -lean * 0.09;

    const width = 1 + squash * 0.47;
    torso.scale.set(width, torsoHeightScale * (1 - squash), 1 + squash * 0.28);
    torso.position.y = torsoBase + (torsoRest - torsoBase) * (1 - squash);
    head.position.y = headRest - (neckRest - torsoBase) * squash;

    for (const [index, arm] of arms.entries()) {
      const side = index === 0 ? -1 : 1;
      arm.position.x = side * shoulderX * width;
      arm.position.y = torsoBase + (shoulderY - torsoBase) * (1 - squash);
      arm.rotation.x = -side * lean * 0.1;
      arm.rotation.z = side * (0.54 + elevation * 0.42);
    }
    if (!reduced && pose === "wave" && poseTime < 1.8) {
      const envelope = Math.min(poseTime * 6, 1, (1.8 - poseTime) * 5);
      arms[1].rotation.z += envelope * (1.58 + Math.sin(poseTime * 16) * 0.27);
      arms[1].rotation.x = -0.25 * envelope;
    }

    let look = Math.sin(patrolTime * 1.8) * 0.27;
    if (hopping) look = -direction * 0.15;
    if (attentive) look = -root.rotation.y;
    if (pose === "wave") look = 0.44;
    if (pose === "happy") look = -0.3;
    if (pose === "heart") look = 0.28;
    head.rotation.y = reduced ? 0 : MathUtils.damp(head.rotation.y, look, 9, dt);
    head.rotation.z = reduced ? 0 : MathUtils.damp(head.rotation.z, -look * 0.14, 7, dt);
    const blink = pose === "idle" && !reduced && patrolTime % 3.8 < 0.12;
    for (const eye of eyes) eye.scale.set(0.053, blink ? 0.016 : 0.082, 0.024);

    heart.visible = pose === "heart";
    const heartLift = reduced ? 0 : Math.min(poseTime, 1) * 0.27;
    heart.position.set(root.position.x + 0.69, root.position.y + head.position.y + 0.42 + heartLift, 0.41);
    heart.scale.setScalar(reduced ? 0.72 : 0.45 + Math.min(poseTime, 0.65) * 0.43);
    heart.rotation.y = reduced ? 0 : Math.sin(poseTime * 3) * 0.26;
    shadow.position.x = root.position.x;
    shadow.scale.setScalar(1 - elevation * 0.7);
    renderer.render(scene, camera);
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = host;
    if (!width || !height) return;
    const halfWidth = camera.top * width / height;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.updateProjectionMatrix();
    travelRange = Math.max(0.25, Math.min(1.52, halfWidth - 0.98));
    root.position.x = MathUtils.clamp(root.position.x, -travelRange, travelRange);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    render(0);
  }

  function frame(time: number) {
    if (lastFrame !== null && time - lastFrame < 30) return;
    const dt = lastFrame === null ? 0 : Math.min((time - lastFrame) / 1000, 0.08);
    lastFrame = time;
    render(dt);
  }

  function syncAnimation() {
    const shouldRun = inView && !document.hidden && !motion.matches;
    if (shouldRun !== running) {
      running = shouldRun;
      lastFrame = null;
      renderer.setAnimationLoop(shouldRun ? frame : null);
    }
    if (!shouldRun) render(0);
  }

  host.append(canvas);
  resize();
  const sizes = new ResizeObserver(resize);
  sizes.observe(host);
  const visibility = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    syncAnimation();
  });
  visibility.observe(host);
  motion.addEventListener("change", syncAnimation);
  document.addEventListener("visibilitychange", syncAnimation);
  canvas.addEventListener("webglcontextlost", onContextLost);
  syncAnimation();

  return {
    setPose(nextPose: RobotPose) {
      if (nextPose === pose) return;
      pose = nextPose;
      poseTime = 0;
      if (!running) render(0);
    },
    setAttentive(next: boolean) {
      attentive = next;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      sizes.disconnect();
      visibility.disconnect();
      motion.removeEventListener("change", syncAnimation);
      document.removeEventListener("visibilitychange", syncAnimation);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<MeshBasicMaterial | MeshStandardMaterial>();
      scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        geometries.add(object.geometry);
        materials.add(object.material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      if (!context.isContextLost()) renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

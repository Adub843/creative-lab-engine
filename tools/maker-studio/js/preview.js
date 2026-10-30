// The 3D design preview: each part in its filament colour, with fine layer lines so it reads as a
// real print, on a soft studio floor. Orbit with a finger or the mouse.
const THREE = window.THREE;

function layerTexture() {
  const c = document.createElement("canvas"); c.width = 4; c.height = 16;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 4, 16);
  g.fillStyle = "#8a8a8a"; g.fillRect(0, 14, 4, 2);
  g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, 4, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Preview {
  constructor(host, { dark = false } = {}) {
    this.host = host; this.dark = dark;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if ("outputEncoding" in this.renderer) this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener("change", () => this.draw());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b2a4, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(-60, -90, 160); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.radius = 4;
    this.key = key; this.scene.add(key); this.scene.add(key.target);
    const rim = new THREE.DirectionalLight(0xfff4e0, 0.35); rim.position.set(120, 140, 80); this.scene.add(rim);

    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShadowMaterial({ opacity: 0.16 }));
    this.floor.receiveShadow = true; this.floor.position.z = -0.01; this.scene.add(this.floor);

    // printer bed: 256 mm square with a 10 mm grid, shown in the sign maker's 3D view
    this.bed = new THREE.Group();
    const grid = new THREE.GridHelper(256, 26, dark ? 0x8a8f99 : 0xb9b2a4, dark ? 0x5c616b : 0xd8d0c0);
    grid.rotation.x = Math.PI / 2; grid.position.z = -0.02; this.bed.add(grid);
    this.bed.visible = false; this.scene.add(this.bed);
    if (dark) this.floor.material.opacity = 0.35;

    this.layers = layerTexture();
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.fitted = false;

    this.resize();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    const loop = () => { if (this.dead) return; if (this.controls.update()) this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%"; this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.draw();
  }

  draw() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    this.dead = true; this.ro.disconnect(); this.controls.dispose();
    for (const m of this.group.children) { m.geometry.dispose(); m.material.dispose(); }
    this.renderer.dispose(); if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
  }

  setBed(on) { this.bed.visible = !!on; this.draw(); }

  show(parts, { refit = false } = {}) {
    for (const m of this.group.children) { m.geometry.dispose(); m.material.dispose(); }
    this.group.clear();
    const box = new THREE.Box3();
    for (const p of parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(p.tris, 3));
      const n = p.tris.length / 3; const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) { uv[i * 2] = (p.tris[i * 3] + p.tris[i * 3 + 1]) * 0.25; uv[i * 2 + 1] = p.tris[i * 3 + 2] / 0.2; }
      g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(p.color).convertSRGBToLinear ? new THREE.Color(p.color).convertSRGBToLinear() : p.color,
        roughness: 0.52, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.6, bumpMap: this.layers, bumpScale: 0.02 });
      const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      g.computeBoundingBox(); box.union(g.boundingBox);
    }
    if (parts.length) this.box = box;
    if ((refit || !this.fitted) && parts.length) { this.fit(); this.fitted = true; }
    this.draw();
  }

  fit() {
    const b = this.box; if (!b) return;
    const c = b.getCenter(new THREE.Vector3()); const s = b.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z * 2, 20) * 0.5;
    const d = r / Math.sin((this.camera.fov * Math.PI / 180) / 2) * (this.camera.aspect < 1 ? 1.25 / this.camera.aspect : 1.05);
    this.controls.target.copy(c);
    this.camera.position.set(c.x - d * 0.08, c.y - d * 0.62, c.z + d * 0.78);
    this.camera.near = d / 50; this.camera.far = d * 20; this.camera.updateProjectionMatrix();
    const k = this.key; k.target.position.copy(c); k.position.set(c.x - r * 1.2, c.y - r * 1.8, c.z + r * 3.2);
    const sc = k.shadow.camera; sc.left = sc.bottom = -r * 2; sc.right = sc.top = r * 2; sc.near = 1; sc.far = r * 10; sc.updateProjectionMatrix();
    this.controls.update(); this.draw();
  }

  snapshot() { this.draw(); return this.renderer.domElement.toDataURL("image/png"); }
}

import React, { useEffect, useRef, useState } from "react";
import { matchParts } from "../../lib/houseGlb";

/*
 * The imported 3D house (.glb), drawn with three.js. Parts whose names match your rooms are tinted by who is inside and carry the
 * names of the people there. three.js is loaded only when this view is opened.
 * Props: buffer (ArrayBuffer of the .glb), rooms ([{ name, people: [{ person }] }]).
 */
const TINT = { empty: 0x30363d, home: 0x238636 };

function label(THREE, text) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(13,17,23,0.85)"; g.fillRect(0, 0, 256, 64);
  g.strokeStyle = "#3fb950"; g.strokeRect(1, 1, 254, 62);
  g.fillStyle = "#e6edf3"; g.font = "bold 28px monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text.slice(0, 16), 128, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sp.renderOrder = 10;
  return sp;
}

export default function HouseModelView({ buffer, rooms, onInfo }) {
  const host = useRef(null);
  const scene = useRef(null);
  const [error, setError] = useState("");

  // build the scene once per file
  useEffect(() => {
    let dead = false, raf = 0, cleanup = () => {};
    (async () => {
      try {
        const THREE = await import("three");
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        if (dead || !host.current) return;
        const gltf = await new Promise((ok, no) => new GLTFLoader().parse(buffer.slice(0), "", ok, no));
        if (dead) return;
        const el = host.current, w = el.clientWidth || 640, h = 420;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(w, h);
        el.appendChild(renderer.domElement);
        const sc = new THREE.Scene(); sc.background = new THREE.Color(0x0d1117);
        sc.add(new THREE.HemisphereLight(0xffffff, 0x30363d, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(5, 10, 6); sc.add(sun);
        sc.add(gltf.scene);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
        const grid = new THREE.GridHelper(Math.max(size.x, size.z) * 1.6, 16, 0x30363d, 0x21262d); grid.position.set(mid.x, box.min.y - 0.01, mid.z); sc.add(grid);
        const cam = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
        const r = Math.max(size.x, size.y, size.z) * 1.4 + 1;
        cam.position.set(mid.x + r, mid.y + r * 0.9, mid.z + r); cam.lookAt(mid);
        const ctl = new OrbitControls(cam, renderer.domElement);
        ctl.target.copy(mid); ctl.update();
        // the nodes named like a room (the top-most one, so a group counts once)
        const nodes = [];
        gltf.scene.traverse((o) => { if (o.name) nodes.push(o); });
        scene.current = { THREE, sc, gltf, nodes, markers: [], renderer, box };
        const tick = () => { raf = requestAnimationFrame(tick); ctl.update(); renderer.render(sc, cam); };
        tick();
        const onResize = () => { const nw = el.clientWidth || w; renderer.setSize(nw, h); cam.aspect = nw / h; cam.updateProjectionMatrix(); };
        window.addEventListener("resize", onResize);
        window.__houseModelReady = true;
        cleanup = () => { window.removeEventListener("resize", onResize); cancelAnimationFrame(raf); ctl.dispose(); renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); scene.current = null; };
        setError("");
        paint();
      } catch (e) { if (!dead) setError("Is model ko khol nahi paaye: " + (e && e.message ? e.message : "file kharab hai")); }
    })();
    return () => { dead = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffer]);

  // tint the rooms and place the people (every time who-is-where changes)
  const paint = () => {
    const s = scene.current;
    if (!s) return;
    const { THREE, nodes, markers, sc } = s;
    markers.splice(0).forEach((m) => { sc.remove(m); if (m.material && m.material.map) m.material.map.dispose(); });
    const names = rooms.map((r) => r.name);
    const { matched, missing, extra } = matchParts(nodes.map((n) => n.name), names);
    const used = new Set();
    for (const room of rooms) {
      const mine = (matched[room.name] || []).map((n) => nodes.find((o) => o.name === n)).filter(Boolean);
      const top = mine.filter((o) => { for (let p = o.parent; p; p = p.parent) if (mine.includes(p)) return false; return true; });
      const box = new THREE.Box3();
      const here = room.people.length > 0;
      top.forEach((o) => {
        box.expandByObject(o);
        o.traverse((m) => {
          if (!m.isMesh) return;
          if (!m.userData.own) { m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone(); m.userData.own = true; }
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => { if (mat.emissive) { mat.emissive.setHex(here ? TINT.home : TINT.empty); mat.emissiveIntensity = here ? 0.55 : 0.12; } });
        });
        used.add(o.name);
      });
      if (here && !box.isEmpty()) {
        const c = box.getCenter(new THREE.Vector3());
        const sp = label(THREE, room.people.map((p) => p.person).join(", "));
        const sz = box.getSize(new THREE.Vector3());
        sp.scale.set(Math.max(sz.x, 1.5) * 0.9, Math.max(sz.x, 1.5) * 0.225, 1);
        sp.position.set(c.x, box.max.y + sp.scale.y * 0.8, c.z);
        sc.add(sp); markers.push(sp);
      }
    }
    if (onInfo) onInfo({ missing, extra: extra.slice(0, 12), matched: Object.keys(matched).length });
  };
  const key = JSON.stringify(rooms.map((r) => [r.name, r.people.map((p) => p.person)]));
  useEffect(() => { paint(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);

  if (error) return <p className="dev-warn">{error}</p>;
  return <div ref={host} className="hm-3dmodel" data-testid="house-model" style={{ width: "100%", maxWidth: 900, minHeight: 420, border: "1px solid #30363d", borderRadius: 8, overflow: "hidden" }} />;
}

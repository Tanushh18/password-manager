/* Checks that a buffer really is a binary glTF 2.0 file (.glb) before it is stored: header, version and declared length. Returns the part names. */
const MAX_BYTES = 12 * 1024 * 1024;

function check(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 20) return { ok: false, error: "That is not a .glb file (too small)." };
    if (buf.length > MAX_BYTES) return { ok: false, error: "The model is too big: keep it under 12 MB." };
    if (buf.toString("latin1", 0, 4) !== "glTF") return { ok: false, error: "That is not a .glb file. Export your model as glTF Binary (.glb)." };
    if (buf.readUInt32LE(4) !== 2) return { ok: false, error: "Only glTF 2.0 is supported." };
    if (buf.readUInt32LE(8) !== buf.length) return { ok: false, error: "The .glb file looks cut off: upload it again." };
    const jsonLen = buf.readUInt32LE(12);
    if (buf.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLen > buf.length) return { ok: false, error: "The .glb file is damaged." };
    let json;
    try { json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen)); } catch { return { ok: false, error: "The .glb file is damaged." }; }
    const nodes = Array.isArray(json.nodes) ? json.nodes : [];
    if (!Array.isArray(json.meshes) || !json.meshes.length) return { ok: false, error: "No 3D shapes found in that file." };
    return { ok: true, parts: nodes.map((n) => (n && typeof n.name === "string" ? n.name : "")).filter(Boolean).slice(0, 200) };
}

module.exports = { check, MAX_BYTES };

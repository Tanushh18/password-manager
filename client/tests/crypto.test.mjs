import test from "node:test";
import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import * as web from "../src/lib/crypto.js";
import { createCrypto } from "../../mobile/src/lib/cryptoCore.js";
const mob = createCrypto(nodeCrypto);
const ITER = 2000;

test("same key both sides", async () => {
  const salt = web.randomSalt();
  const w = await web.deriveKeyBytes("pässwörd 🔐", salt, ITER);
  const m = await mob.deriveKey("pässwörd 🔐", salt, ITER);
  assert.deepEqual(Array.from(w), Array.from(m));
});
test("web encrypts, mobile decrypts and back", async () => {
  const salt = mob.randomSalt();
  const { key } = await web.deriveKey("master", salt, ITER);
  const raw = await mob.deriveKey("master", salt, ITER);
  const item = { name: "Gmail ✉️", password: "x9$Kq!2m", notes: "line1\nläne2 日本" };
  assert.deepEqual(await mob.decryptJSON(raw, await web.encryptJSON(key, item)), item);
  assert.deepEqual(await web.decryptJSON(key, await mob.encryptJSON(raw, item)), item);
  assert.equal(await web.verifyKey(key, await mob.makeKeyCheck(raw)), true);
  const other = await mob.deriveKey("wrong", salt, ITER);
  assert.equal(await mob.verifyKey(other, await web.makeKeyCheck(key)), false);
});
test("tampering is detected", async () => {
  const raw = await mob.deriveKey("m", mob.randomSalt(), ITER);
  const blob = await mob.encryptString(raw, "secret");
  const [v, iv, ct] = blob.split(":");
  const b = mob.fromB64(ct); b[0] ^= 1;
  await assert.rejects(mob.decryptString(raw, `${v}:${iv}:${mob.toB64(b)}`));
});
test("TOTP matches RFC 6238 vectors on both", async () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
  for (const [t, expected] of [[59, "94287082"], [1111111109, "07081804"], [2000000000, "69279037"]]) {
    const cfg = { secret, digits: 8, period: 30, algorithm: "SHA1" };
    assert.equal((await web.totpCode(cfg, t * 1000)).code, expected);
    assert.equal((await mob.totpCode(cfg, t * 1000)).code, expected);
  }
  const uri = "otpauth://totp/GitHub:ana?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";
  assert.equal(web.parseTotp(uri).issuer, "GitHub");
  assert.equal(mob.parseTotp(uri).secret, "JBSWY3DPEHPK3PXP");
  assert.equal((await web.totpCode(uri, 5e12)).code, (await mob.totpCode(uri, 5e12)).code);
});
test("sha1 and backups interop", async () => {
  assert.equal(await web.sha1Hex("password"), "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
  assert.equal(await mob.sha1Hex("password"), "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
  const items = [{ name: "A", password: "b" }];
  assert.deepEqual(await mob.importBackup(await web.exportBackup(items, "exp"), "exp"), items);
  await assert.rejects(web.importBackup(await mob.exportBackup(items, "exp"), "nope"), /Wrong backup password/);
});

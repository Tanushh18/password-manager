import test from "node:test";
import assert from "node:assert/strict";
import { generatePassword, generatePassphrase, estimate, WORDS } from "../src/lib/strength.js";

globalThis.window = globalThis.window || { crypto: globalThis.crypto };

test("default call keeps previous behaviour: 18 chars with every set", () => {
  for (let i = 0; i < 50; i += 1) {
    const p = generatePassword();
    assert.equal(p.length, 18);
    assert.match(p, /[a-z]/); assert.match(p, /[A-Z]/); assert.match(p, /[0-9]/); assert.match(p, /[^a-zA-Z0-9]/);
  }
});

test("item editor style call still includes lowercase", () => {
  for (let i = 0; i < 50; i += 1) {
    const p = generatePassword({ length: 12, upper: false, digits: false, symbols: false });
    assert.match(p, /^[a-z]{12}$/);
  }
});

test("lower:false excludes lowercase and keeps each enabled set", () => {
  for (let i = 0; i < 50; i += 1) {
    const p = generatePassword({ length: 8, lower: false, upper: true, digits: true, symbols: false });
    assert.match(p, /^[A-Z0-9]{8}$/); assert.match(p, /[A-Z]/); assert.match(p, /[0-9]/);
  }
});

test("all sets off falls back to lowercase", () => {
  const p = generatePassword({ length: 20, lower: false, upper: false, digits: false, symbols: false });
  assert.match(p, /^[a-z]{20}$/);
});

test("length bounds 8 and 64 respected", () => {
  assert.equal(generatePassword({ length: 8 }).length, 8);
  assert.equal(generatePassword({ length: 64 }).length, 64);
  assert.equal(estimate(generatePassword({ length: 64 })).score, 4);
});

test("passphrase uses word list, separator, number", () => {
  const p = generatePassphrase({ words: 5 });
  const parts = p.split("-");
  assert.equal(parts.length, 6);
  assert.equal(parts.filter((w) => /^\d+$/.test(w)).length, 1);
  for (const w of parts.filter((x) => !/^\d+$/.test(x))) assert.ok(WORDS.includes(w.toLowerCase()));
  assert.equal(generatePassphrase({ words: 3, number: false, separator: " " }).split(" ").length, 3);
});

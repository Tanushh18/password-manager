import { test } from "node:test";
import assert from "node:assert/strict";
import { envToText } from "../src/lib/envText.js";
import { parseEnvBlock } from "../src/lib/projectItems.js";

const roundTrip = (rows) => parseEnvBlock(envToText(rows)).map((r) => [r.name, r.value]);

test("plain values are written bare and read back", () => {
  assert.equal(envToText([{ name: "PORT", value: "3000" }]), "PORT=3000");
  assert.deepEqual(roundTrip([{ name: "PORT", value: "3000" }]), [["PORT", "3000"]]);
});

test("values with spaces, hashes or quotes survive a copy and paste", () => {
  const rows = [
    { name: "GREETING", value: "hello world" },
    { name: "HASH", value: "abc#def" },
    { name: "APOS", value: "it's" },
    { name: "DQUOTE", value: 'say "hi"' }
  ];
  assert.deepEqual(roundTrip(rows), rows.map((r) => [r.name, r.value]));
});

test("an empty value is kept as an empty value", () => {
  assert.deepEqual(roundTrip([{ name: "EMPTY", value: "" }]), [["EMPTY", ""]]);
});

test("rows without a name are left out", () => {
  assert.equal(envToText([{ name: "", value: "x" }, null, { name: "A", value: "1" }]), "A=1");
});

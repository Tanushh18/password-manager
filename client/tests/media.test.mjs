import test from "node:test";
import assert from "node:assert/strict";
import { mediaKind, createLru } from "../src/lib/media.js";

test("mediaKind detects by file extension when MIME is missing", () => {
  assert.equal(mediaKind({ filename: "clip.MP4" }).isVideo, true);
  assert.equal(mediaKind({ filename: "IMG_1.heic" }).isImage, true);
  assert.equal(mediaKind({ filename: "notes.pdf" }).isDriveFile, true);
});

test("mediaKind uses MIME and screenshot hints", () => {
  assert.equal(mediaKind({ mimeType: "image/png", filename: "Screenshot 2026.png" }).isScreenshot, true);
  assert.equal(mediaKind({ mimeType: "video/quicktime" }).isVideo, true);
});

test("createLru evicts the least recently used entry", () => {
  const evicted = [];
  const lru = createLru(2, (k) => evicted.push(k));
  lru.set("a", 1); lru.set("b", 2); lru.get("a"); lru.set("c", 3);
  assert.deepEqual(evicted, ["b"]);
  assert.equal(lru.get("a"), 1);
  assert.equal(lru.size, 2);
});

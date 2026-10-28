import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const homePath = new URL("../src/Pages/Home/Home.jsx", import.meta.url);
const stylePath = new URL("../src/Pages/Home/Home.css", import.meta.url);
const appPath = new URL("../src/App.jsx", import.meta.url);

test("vault command deck links only to existing vault destinations", async () => {
  const [home, app] = await Promise.all([
    readFile(homePath, "utf8"),
    readFile(appPath, "utf8"),
  ]);

  assert.match(home, /Vault command deck/);
  assert.match(home, /aria-label="Vault stations"/);
  for (const route of ["/passwords", "/projects", "/security-center", "/generator"]) {
    assert.ok(home.includes(route), `expected command deck destination ${route}`);
    assert.ok(app.includes(`path="${route}"`), `expected registered route ${route}`);
  }
  assert.match(home, /signedIn \? count : "—"/);
});

test("immersive command deck has responsive and reduced-motion fallbacks", async () => {
  const css = await readFile(stylePath, "utf8");

  assert.match(css, /\.hm-command__universe/);
  assert.match(css, /\.hm-orbit--outer/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.hm-core, \.hm-orbit, \.hm-universe__spark \{ animation: none !important; \}/);
});

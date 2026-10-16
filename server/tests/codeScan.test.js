const test = require("node:test");
const expect = require("./expect");
const { pickFiles, hintsFor, scanState, clearCodeScans } = require("../utils/codeScan");

test("pickFiles takes manifests first and skips vendored, test and huge files", () => {
  const tree = [
    { type: "blob", path: "package.json", sha: "a", size: 500 }, { type: "blob", path: "node_modules/x/package.json", sha: "b", size: 10 },
    { type: "blob", path: "server/utils/upload.js", sha: "c", size: 900 }, { type: "blob", path: "server/tests/upload.test.js", sha: "d", size: 900 },
    { type: "blob", path: "src/big.js", sha: "e", size: 900000 }, { type: "blob", path: "README.md", sha: "f", size: 100 },
    { type: "tree", path: "server", sha: "g" }, { type: "blob", path: "app.py", sha: "h", size: 300 }
  ];
  expect(pickFiles(tree).map((f) => f.path)).toEqual(["package.json", "app.py", "server/utils/upload.js"]);
});

test("a repository is scanned in the background, then answered from the cache", async () => {
  clearCodeScans();
  const realFetch = global.fetch;
  const b64 = (t) => Buffer.from(t).toString("base64");
  const files = { pk: JSON.stringify({ dependencies: { cloudinary: "1" } }), up: 'const c=require("cloudinary"); const n = process.env.MY_CLD;' };
  global.fetch = async (url) => {
    const path = String(url).replace("https://api.github.com", "");
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, headers: new Map() });
    if (/\/git\/trees\//.test(path)) return ok({ tree: [{ type: "blob", path: "package.json", sha: "pk", size: 50 }, { type: "blob", path: "up.js", sha: "up", size: 50 }] });
    if (/\/git\/blobs\/(\w+)/.test(path)) { const sha = /\/git\/blobs\/(\w+)/.exec(path)[1]; return ok({ encoding: "base64", content: b64(files[sha]) }); }
    return ok({ default_branch: "main", full_name: "o/r" });
  };
  try {
    const accounts = [{ id: "1", login: "o", token: "t" }];
    expect(scanState("https://github.com/o/r")).toBe("pending");
    const first = await hintsFor(accounts, "https://github.com/o/r"); // returns at once, scan continues
    expect(first).toBeNull();
    const done = await hintsFor(accounts, "https://github.com/o/r", { wait: true });
    expect(done.deps.cloudinary).toEqual(["cloudinary"]);
    expect(done.envLinks.MY_CLD).toBe("cloudinary");
    expect(scanState("https://github.com/o/r")).toBe("scanned");
  } finally { global.fetch = realFetch; }
});

const test = require("node:test");
const expect = require("./expect");
const { pickFiles, hintsFor, scanState, clearCodeScans, summarizeDirs, suggestServerFolder, validFolder, inFolder } = require("../utils/codeScan");
const { analyzeFile } = require("../utils/serviceSignals");

test("pickFiles takes manifests first and skips vendored, test and huge files", () => {
  const tree = [
    { type: "blob", path: "package.json", sha: "a", size: 500 }, { type: "blob", path: "node_modules/x/package.json", sha: "b", size: 10 },
    { type: "blob", path: "server/utils/upload.js", sha: "c", size: 900 }, { type: "blob", path: "server/tests/upload.test.js", sha: "d", size: 900 },
    { type: "blob", path: "src/big.js", sha: "e", size: 900000 }, { type: "blob", path: "README.md", sha: "f", size: 100 },
    { type: "tree", path: "server", sha: "g" }, { type: "blob", path: "app.py", sha: "h", size: 300 }, { type: "blob", path: "client/src/upload.js", sha: "i", size: 300 }, { type: "blob", path: "client/package.json", sha: "j", size: 300 }
  ];
  expect(pickFiles(tree).map((f) => f.path)).toEqual(["package.json", "client/package.json", "app.py", "server/utils/upload.js", "client/src/upload.js"]);
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

const TREE = [
  { type: "blob", path: "client/package.json", sha: "a", size: 100 }, { type: "blob", path: "client/src/App.jsx", sha: "b", size: 100 },
  { type: "blob", path: "server/package.json", sha: "c", size: 100 }, { type: "blob", path: "server/app.js", sha: "d", size: 100 },
  { type: "blob", path: "server/utils/mail.js", sha: "e", size: 100 }, { type: "blob", path: "README.md", sha: "f", size: 10 },
  { type: "blob", path: "server/node_modules/x/index.js", sha: "g", size: 10 }
];

test("the folder summary lists folders that hold code, with what each looks like", () => {
  const dirs = summarizeDirs(TREE);
  expect(dirs.map((d) => d.path)).toEqual(["client", "client/src", "server", "server/utils"]);
  expect(dirs.find((d) => d.path === "server").manifest).toBe(true);
  expect(dirs.find((d) => d.path === "client").code).toBe(1);
});

test("the server folder is suggested from the manifests", () => {
  const manifests = [
    analyzeFile("client/package.json", JSON.stringify({ dependencies: { react: "18", vite: "5" } })),
    analyzeFile("server/package.json", JSON.stringify({ dependencies: { express: "5", cloudinary: "1" } }))
  ];
  expect(suggestServerFolder(manifests, summarizeDirs(TREE))).toMatchObject({ folder: "server" });
  expect(suggestServerFolder([], [])).toBeNull();
  const next = [analyzeFile("package.json", JSON.stringify({ dependencies: { next: "15", react: "19" } }))];
  expect(suggestServerFolder(next, [])).toMatchObject({ folder: "." });
});

test("folder names are validated and matched as whole path segments", () => {
  for (const ok of [".", "server", "apps/api", "back_end-1"]) expect(validFolder(ok)).toBe(true);
  for (const bad of ["", "../x", "a/../b", "/abs", "a//b", "a b", "x".repeat(130)]) expect(validFolder(bad)).toBe(false);
  expect(inFolder("server/app.js", "server")).toBe(true);
  expect(inFolder("server-old/app.js", "server")).toBe(false);
  expect(inFolder("anything/at/all.js", ".")).toBe(true);
});

test("variables read only outside the server folder are reported as frontend", async () => {
  clearCodeScans();
  const realFetch = global.fetch;
  const b64 = (t) => Buffer.from(t).toString("base64");
  const files = {
    a: JSON.stringify({ dependencies: { react: "18" } }), c: JSON.stringify({ dependencies: { express: "5" } }),
    b: "const k = import.meta.env.VITE_API_URL; const x = process.env.SHARED;", d: "const a = process.env.DB_URI; const x = process.env.SHARED;", e: 'const mail = require("nodemailer"); const p = process.env.SMTP_PASS;'
  };
  global.fetch = async (url) => {
    const path = String(url).replace("https://api.github.com", "");
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, headers: new Map() });
    if (/\/git\/trees\//.test(path)) return ok({ tree: TREE.filter((f) => !f.path.includes("node_modules")) });
    if (/\/git\/blobs\/(\w+)/.test(path)) return ok({ encoding: "base64", content: b64(files[/\/git\/blobs\/(\w+)/.exec(path)[1]] || "") });
    return ok({ default_branch: "main" });
  };
  try {
    const accounts = [{ id: "1", login: "o", token: "t" }];
    const general = await hintsFor(accounts, "https://github.com/o/r", { wait: true });
    expect(general.suggestion).toMatchObject({ folder: "server" });
    expect(general.dirs.map((d) => d.path)).toContain("server");
    const focused = await hintsFor(accounts, "https://github.com/o/r", { wait: true, serverFolder: "server" });
    expect(focused.serverFolder).toBe("server");
    expect(focused.envNames).toEqual(["DB_URI", "SHARED", "SMTP_PASS"]);
    expect(focused.frontendEnv).toEqual(["VITE_API_URL"]);
    expect(focused.envLinks.SMTP_PASS).toBe("email");
  } finally { global.fetch = realFetch; }
});

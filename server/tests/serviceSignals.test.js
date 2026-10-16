const test = require("node:test");
const expect = require("./expect");
const { valueOwner, parseManifest, parseSource, analyzeCode } = require("../utils/serviceSignals");

test("a variable is recognised by its value, whatever it is called", () => {
  const cases = [
    ["sk-ant-api03-" + "a".repeat(20), "anthropic"], ["gsk_" + "a".repeat(30), "groq"], ["sk-proj-" + "a".repeat(30), "openai"],
    ["https://abc.supabase.co", "supabase"], ["cloudinary://k:s@demo", "cloudinary"], ["mongodb+srv://u:p@c.mongodb.net/db", "mongodb"],
    ["12345678:" + "A".repeat(35), "telegram"], ["AC" + "a".repeat(32), "twilio"], ["xkeysib-" + "a".repeat(30), "brevo"],
    ["https://hooks.slack.com/services/T/B/x", "slack"], ["sk_live_" + "a".repeat(24), "payments"],
    ["hello world", null], ["https://example.com/api", null], ["true", null], ["3000", null], ["sk-" + "a".repeat(32), null]
  ];
  for (const [value, key] of cases) expect(valueOwner(value)).toBe(key);
});

test("manifests map SDK packages to services (npm and pip)", () => {
  const npm = parseManifest("server/package.json", JSON.stringify({ dependencies: { cloudinary: "1", express: "4", "@sentry/node": "7", mongoose: "8" } }));
  expect(Object.keys(npm).sort()).toEqual(["cloudinary", "mongodb", "sentry"]);
  const pip = parseManifest("requirements.txt", "flask==3\nopenai>=1.0\n# twilio\nboto3\n");
  expect(Object.keys(pip).sort()).toEqual(["aws", "openai"]);
});

test("source files give the SDKs they import and the variables they read", () => {
  const js = parseSource("a.js", 'const c = require("cloudinary"); import x from "@sentry/node"; const k = process.env.MY_CLD; const { A, B: b } = process.env;');
  expect([...js.packages.keys()].sort()).toEqual(["cloudinary", "sentry"]);
  expect(js.env.sort()).toEqual(["A", "B", "MY_CLD"]);
  const py = parseSource("a.py", "import os\nimport openai\nfrom google.generativeai import x\nk = os.environ.get('WEIRD_AI')\n");
  expect([...py.packages.keys()].sort()).toEqual(["gemini", "openai"]);
  expect(py.env).toEqual(["WEIRD_AI"]);
});

test("analyzeCode links a variable to the one SDK its file imports, and stays silent on conflicts", () => {
  const out = analyzeCode([
    { path: "package.json", text: JSON.stringify({ dependencies: { cloudinary: "1", twilio: "4" } }) },
    { path: "up.js", text: 'const cloudinary = require("cloudinary"); cloudinary.config({ cloud_name: process.env.MY_CLD, api_key: process.env.MY_KEY });' },
    { path: "a.js", text: 'const cloudinary = require("cloudinary"); const twilio = require("twilio"); const x = process.env.UNCLEAR_THING;' }
  ]);
  expect(out.deps.cloudinary).toEqual(["cloudinary"]);
  expect(out.envLinks.MY_CLD).toBe("cloudinary");
  expect(out.envLinks.MY_KEY).toBe("cloudinary");
  expect(out.envLinks.UNCLEAR_THING).toBeUndefined();
  expect(out.envNames).toContain("UNCLEAR_THING");
});

const test = require("node:test");
const expect = require("./expect");
const { planHealthPatch, candidateFiles } = require("../utils/healthRoute");

test("express: inserted right after the app is created, in the Render root dir, using the start script", () => {
  const pkg = { dependencies: { express: "^4" }, scripts: { start: "node src/main.js" } };
  expect(candidateFiles("server", pkg)[0]).toBe("server/src/main.js");
  const r = planHealthPatch({ pkg, rootDir: "server", files: { "server/src/main.js": "const express = require('express');\nconst api = express();\napi.use(x);\n" } });
  expect(r.path).toBe("server/src/main.js");
  expect(r.content).toBe("const express = require('express');\nconst api = express();\n// Health check for uptime monitors (added by Stashr)\napi.get(\"/health\", (req, res) => res.status(200).json({ status: \"ok\", uptime: process.uptime() }));\napi.use(x);\n");
});

test("an app that already answers /health is left alone", () => {
  const r = planHealthPatch({ pkg: { dependencies: { express: "1" } }, files: { "server.js": "const app = express();\napp.get('/health', h);" } });
  expect(r.already).toBe(true);
});

test("fastapi: registered before the __main__ block; flask at the end", () => {
  const fast = planHealthPatch({ requirements: "fastapi==0.110\nuvicorn", files: { "main.py": "from fastapi import FastAPI\napp = FastAPI(title='x')\n\nif __name__ == \"__main__\":\n    run()\n" } });
  expect(fast.framework).toBe("fastapi");
  expect(fast.content.indexOf("@app.get(\"/health\")") < fast.content.indexOf("if __name__")).toBe(true);
  const flask = planHealthPatch({ requirements: "Flask>=2", files: { "app.py": "from flask import Flask\nserver = Flask(__name__)\n" } });
  expect(flask.content.endsWith("@server.route(\"/health\")\ndef stashr_health():\n    return {\"status\": \"ok\"}\n")).toBe(true);
});

test("unknown framework or no app file: a clear message instead of a guess", () => {
  expect(Boolean(planHealthPatch({ pkg: { dependencies: { react: "1" } } }).error)).toBe(true);
  expect(Boolean(planHealthPatch({ pkg: { dependencies: { express: "1" } }, files: { "index.js": "module.exports = 1;" } }).error)).toBe(true);
});

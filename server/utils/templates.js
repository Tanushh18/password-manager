/* Starter templates committed to a brand-new repo. Small, dependency-light and tested to match their Render commands. */

const GITIGNORE = {
  node: "node_modules/\n.env\n.env.*\n!.env.example\nnpm-debug.log*\n.DS_Store\n",
  python: "__pycache__/\n*.pyc\n.venv/\nvenv/\n.env\n.env.*\n!.env.example\n.DS_Store\n",
  static: ".env\n.env.*\n.DS_Store\n"
};

const readme = (name, how) => "# " + name + "\n\nCreated with Stashr and deployed on Render's free plan.\n\n## Run locally\n\n" + how + "\n\nSecrets belong in environment variables (see `.env.example`), never in the repo.\n";

const TEMPLATES = {
  node: {
    label: "Node.js (Express)",
    render: { type: "web_service", runtime: "node", buildCommand: "npm install", startCommand: "npm start", healthCheckPath: "/health" },
    files: (name) => ({
      "package.json": JSON.stringify({ name, version: "1.0.0", private: true, main: "server.js", scripts: { start: "node server.js" }, engines: { node: ">=18" }, dependencies: { express: "^4.19.2" } }, null, 2) + "\n",
      "server.js": 'const express = require("express");\n\nconst app = express();\nconst port = process.env.PORT || 3000;\n\napp.get("/health", (req, res) => res.json({ status: "ok" }));\napp.get("/", (req, res) => res.send("Hello from ' + name + '"));\n\napp.listen(port, "0.0.0.0", () => console.log("Listening on " + port));\n',
      ".gitignore": GITIGNORE.node,
      ".env.example": "# Copy to .env for local development. Real values live in Render / Stashr.\nPORT=3000\n",
      "README.md": readme(name, "```bash\nnpm install\nnpm start\n```")
    })
  },
  python: {
    label: "Python (FastAPI)",
    render: { type: "web_service", runtime: "python", buildCommand: "pip install -r requirements.txt", startCommand: "uvicorn app.main:app --host 0.0.0.0 --port $PORT", healthCheckPath: "/health" },
    files: (name) => ({
      "requirements.txt": "fastapi\nuvicorn[standard]\n",
      "app/__init__.py": "# FastAPI application package\n",
      "app/main.py": 'from fastapi import FastAPI\n\napp = FastAPI(title="' + name + '")\n\n\n@app.get("/health")\ndef health():\n    return {"status": "ok"}\n\n\n@app.get("/")\ndef root():\n    return {"message": "Hello from ' + name + '"}\n',
      ".gitignore": GITIGNORE.python,
      ".env.example": "# Copy to .env for local development. Real values live in Render / Stashr.\n",
      "README.md": readme(name, "```bash\npython -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\nuvicorn app.main:app --reload\n```")
    })
  },
  static: {
    label: "Static site (HTML)",
    render: { type: "static_site", buildCommand: "", publishPath: "." },
    files: (name) => ({
      "index.html": '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>' + name + '</title>\n</head>\n<body>\n  <h1>' + name + '</h1>\n  <p>Deployed with Stashr.</p>\n</body>\n</html>\n',
      ".gitignore": GITIGNORE.static,
      "README.md": readme(name, "Open `index.html` in a browser.")
    })
  }
};

/** Build/start defaults when you bring your own code (empty or existing repo). */
const RUNTIMES = {
  node: { label: "Node.js", type: "web_service", runtime: "node", buildCommand: "npm install", startCommand: "npm start" },
  python: { label: "Python", type: "web_service", runtime: "python", buildCommand: "pip install -r requirements.txt", startCommand: "uvicorn app.main:app --host 0.0.0.0 --port $PORT" },
  docker: { label: "Docker", type: "web_service", runtime: "docker", buildCommand: "", startCommand: "" },
  static: { label: "Static site", type: "static_site", buildCommand: "", startCommand: "" }
};

/** Free plan only, Render regions that support it. */
const REGIONS = ["oregon", "ohio", "virginia", "frankfurt", "singapore"];

module.exports = { TEMPLATES, RUNTIMES, REGIONS };

/* Starter templates committed to a brand-new repo. Small, dependency-light and tested to match their Render commands. */

const GITIGNORE = {
  node: "node_modules/\n.env\n.env.*\n!.env.example\nnpm-debug.log*\n.DS_Store\n",
  next: "node_modules/\n.next/\nout/\n.env\n.env.*\n!.env.example\nnpm-debug.log*\n.DS_Store\n",
  vite: "node_modules/\ndist/\n.env\n.env.*\n!.env.example\nnpm-debug.log*\n.DS_Store\n",
  astro: "node_modules/\ndist/\n.astro/\n.env\n.env.*\n!.env.example\nnpm-debug.log*\n.DS_Store\n",
  python: "__pycache__/\n*.pyc\n.venv/\nvenv/\n.env\n.env.*\n!.env.example\n.DS_Store\n",
  go: "app\n*.exe\n.env\n.env.*\n!.env.example\n.DS_Store\n",
  docker: "node_modules/\n.env\n.env.*\n!.env.example\n.DS_Store\n",
  static: ".env\n.env.*\n.DS_Store\n"
};

const readme = (name, how) => "# " + name + "\n\nCreated with Stashr and deployed on Render's free plan. Every push to the default branch deploys automatically.\n\n## Run locally\n\n" + how + "\n\nSecrets belong in environment variables (see `.env.example`), never in the repo.\n";
const ENV_EXAMPLE = "# Copy to .env for local development. Real values live in Render / Stashr.\n";
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const VITE_BUILD = "npm install && npm run build";

/** A Vite single-page app: shared package.json and index.html, framework files supplied by the caller. */
const viteApp = (name, { deps, devDeps, entry, title, files }) => ({
  "package.json": json({ name, version: "1.0.0", private: true, type: "module", scripts: { dev: "vite", build: "vite build", preview: "vite preview" }, engines: { node: ">=20" }, dependencies: deps, devDependencies: devDeps }),
  "index.html": '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>' + title + '</title>\n</head>\n<body>\n  <div id="app"></div>\n  <script type="module" src="' + entry + '"></script>\n</body>\n</html>\n',
  ".gitignore": GITIGNORE.vite,
  ".env.example": ENV_EXAMPLE + "# Vite only exposes variables that start with VITE_ to the browser.\n",
  ...files
});

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
  nextjs: {
    label: "Next.js",
    render: { type: "web_service", runtime: "node", buildCommand: VITE_BUILD, startCommand: "npm start", healthCheckPath: "/health" },
    files: (name) => ({
      "package.json": json({ name, version: "1.0.0", private: true, scripts: { dev: "next dev", build: "next build", start: "next start" }, engines: { node: ">=20" }, dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" } }),
      "next.config.js": "/** @type {import('next').NextConfig} */\nmodule.exports = {};\n",
      "app/layout.js": 'export const metadata = { title: "' + name + '" };\n\nexport default function RootLayout({ children }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  );\n}\n',
      "app/page.js": 'export default function Home() {\n  return (\n    <main>\n      <h1>' + name + '</h1>\n      <p>Deployed with Stashr.</p>\n    </main>\n  );\n}\n',
      "app/health/route.js": 'export function GET() {\n  return Response.json({ status: "ok" });\n}\n',
      ".gitignore": GITIGNORE.next,
      ".env.example": ENV_EXAMPLE + "# Only variables that start with NEXT_PUBLIC_ are exposed to the browser.\n",
      "README.md": readme(name, "```bash\nnpm install\nnpm run dev\n```")
    })
  },
  react: {
    label: "React (Vite)",
    render: { type: "static_site", buildCommand: VITE_BUILD, publishPath: "dist" },
    files: (name) => viteApp(name, {
      deps: { react: "^19.0.0", "react-dom": "^19.0.0" }, devDeps: { vite: "^6.0.0", "@vitejs/plugin-react": "^4.3.0" }, entry: "/src/main.jsx", title: name,
      files: {
        "vite.config.js": 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({ plugins: [react()] });\n',
        "src/main.jsx": 'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App.jsx";\n\ncreateRoot(document.getElementById("app")).render(<App />);\n',
        "src/App.jsx": 'export default function App() {\n  return (\n    <main>\n      <h1>' + name + '</h1>\n      <p>Deployed with Stashr.</p>\n    </main>\n  );\n}\n',
        "README.md": readme(name, "```bash\nnpm install\nnpm run dev\n```")
      }
    })
  },
  vue: {
    label: "Vue (Vite)",
    render: { type: "static_site", buildCommand: VITE_BUILD, publishPath: "dist" },
    files: (name) => viteApp(name, {
      deps: { vue: "^3.5.0" }, devDeps: { vite: "^6.0.0", "@vitejs/plugin-vue": "^5.2.0" }, entry: "/src/main.js", title: name,
      files: {
        "vite.config.js": 'import { defineConfig } from "vite";\nimport vue from "@vitejs/plugin-vue";\n\nexport default defineConfig({ plugins: [vue()] });\n',
        "src/main.js": 'import { createApp } from "vue";\nimport App from "./App.vue";\n\ncreateApp(App).mount("#app");\n',
        "src/App.vue": "<template>\n  <main>\n    <h1>" + name + "</h1>\n    <p>Deployed with Stashr.</p>\n  </main>\n</template>\n",
        "README.md": readme(name, "```bash\nnpm install\nnpm run dev\n```")
      }
    })
  },
  svelte: {
    label: "Svelte (Vite)",
    render: { type: "static_site", buildCommand: VITE_BUILD, publishPath: "dist" },
    files: (name) => viteApp(name, {
      deps: { svelte: "^5.0.0" }, devDeps: { vite: "^6.0.0", "@sveltejs/vite-plugin-svelte": "^5.0.0" }, entry: "/src/main.js", title: name,
      files: {
        "vite.config.js": 'import { defineConfig } from "vite";\nimport { svelte } from "@sveltejs/vite-plugin-svelte";\n\nexport default defineConfig({ plugins: [svelte()] });\n',
        "svelte.config.js": 'import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";\n\nexport default { preprocess: vitePreprocess() };\n',
        "src/main.js": 'import { mount } from "svelte";\nimport App from "./App.svelte";\n\nexport default mount(App, { target: document.getElementById("app") });\n',
        "src/App.svelte": "<main>\n  <h1>" + name + "</h1>\n  <p>Deployed with Stashr.</p>\n</main>\n",
        "README.md": readme(name, "```bash\nnpm install\nnpm run dev\n```")
      }
    })
  },
  astro: {
    label: "Astro",
    render: { type: "static_site", buildCommand: VITE_BUILD, publishPath: "dist" },
    files: (name) => ({
      "package.json": json({ name, version: "1.0.0", private: true, type: "module", scripts: { dev: "astro dev", build: "astro build", preview: "astro preview" }, engines: { node: ">=20" }, dependencies: { astro: "^5.0.0" } }),
      "astro.config.mjs": 'import { defineConfig } from "astro/config";\n\nexport default defineConfig({});\n',
      "src/pages/index.astro": '---\nconst title = "' + name + '";\n---\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>{title}</title>\n  </head>\n  <body>\n    <h1>{title}</h1>\n    <p>Deployed with Stashr.</p>\n  </body>\n</html>\n',
      ".gitignore": GITIGNORE.astro,
      ".env.example": ENV_EXAMPLE,
      "README.md": readme(name, "```bash\nnpm install\nnpm run dev\n```")
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
  flask: {
    label: "Python (Flask)",
    render: { type: "web_service", runtime: "python", buildCommand: "pip install -r requirements.txt", startCommand: "gunicorn app:app --bind 0.0.0.0:$PORT", healthCheckPath: "/health" },
    files: (name) => ({
      "requirements.txt": "flask\ngunicorn\n",
      "app.py": 'from flask import Flask, jsonify\n\napp = Flask(__name__)\n\n\n@app.get("/health")\ndef health():\n    return jsonify(status="ok")\n\n\n@app.get("/")\ndef root():\n    return "Hello from ' + name + '"\n',
      ".gitignore": GITIGNORE.python,
      ".env.example": ENV_EXAMPLE,
      "README.md": readme(name, "```bash\npython -m venv .venv && source .venv/bin/activate\npip install -r requirements.txt\nflask --app app run\n```")
    })
  },
  go: {
    label: "Go",
    render: { type: "web_service", runtime: "go", buildCommand: "go build -tags netgo -ldflags '-s -w' -o app", startCommand: "./app", healthCheckPath: "/health" },
    files: (name) => ({
      "go.mod": "module " + name + "\n\ngo 1.22\n",
      "main.go": 'package main\n\nimport (\n\t"fmt"\n\t"log"\n\t"net/http"\n\t"os"\n)\n\nfunc main() {\n\tport := os.Getenv("PORT")\n\tif port == "" {\n\t\tport = "3000"\n\t}\n\n\thttp.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {\n\t\tw.Header().Set("Content-Type", "application/json")\n\t\tfmt.Fprint(w, `{"status":"ok"}`)\n\t})\n\thttp.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {\n\t\tfmt.Fprint(w, "Hello from ' + name + '")\n\t})\n\n\tlog.Println("Listening on " + port)\n\tlog.Fatal(http.ListenAndServe("0.0.0.0:"+port, nil))\n}\n',
      ".gitignore": GITIGNORE.go,
      ".env.example": ENV_EXAMPLE,
      "README.md": readme(name, "```bash\ngo run .\n```")
    })
  },
  docker: {
    label: "Docker (any language)",
    render: { type: "web_service", runtime: "docker", buildCommand: "", startCommand: "", healthCheckPath: "/health" },
    files: (name) => ({
      "Dockerfile": 'FROM node:20-alpine\nWORKDIR /app\nCOPY server.js .\nENV PORT=10000\nEXPOSE 10000\nCMD ["node", "server.js"]\n',
      "server.js": 'const http = require("http");\n\nconst port = process.env.PORT || 10000;\n\nhttp.createServer((req, res) => {\n  if (req.url === "/health") {\n    res.setHeader("Content-Type", "application/json");\n    return res.end(JSON.stringify({ status: "ok" }));\n  }\n  res.end("Hello from ' + name + '");\n}).listen(port, "0.0.0.0", () => console.log("Listening on " + port));\n',
      ".dockerignore": "node_modules\n.env\n.git\n",
      ".gitignore": GITIGNORE.docker,
      ".env.example": ENV_EXAMPLE,
      "README.md": readme(name, "```bash\ndocker build -t " + name + " .\ndocker run -p 10000:10000 " + name + "\n```\n\nReplace `server.js` and the `Dockerfile` with your own app (PHP/Laravel, Java/Spring Boot, .NET, Ruby, Rust, ...). Render builds whatever the Dockerfile describes.")
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

/**
 * Build/start defaults when you bring your own code (empty or existing repo). `publishPath` is where a static
 * site's build writes its files. Stacks Render has no native runtime for (PHP/Laravel, Java/Spring Boot, .NET)
 * deploy through "docker" with a Dockerfile in the repo.
 */
const NPM_BUILD = "npm install && npm run build";
const RUNTIMES = {
  node: { label: "Node.js (Express, Fastify, ...)", type: "web_service", runtime: "node", buildCommand: "npm install", startCommand: "npm start" },
  nextjs: { label: "Next.js", type: "web_service", runtime: "node", buildCommand: NPM_BUILD, startCommand: "npm start" },
  nuxt: { label: "Nuxt", type: "web_service", runtime: "node", buildCommand: NPM_BUILD, startCommand: "node .output/server/index.mjs" },
  sveltekit: { label: "SvelteKit (adapter-node)", type: "web_service", runtime: "node", buildCommand: NPM_BUILD, startCommand: "node build" },
  remix: { label: "Remix / React Router", type: "web_service", runtime: "node", buildCommand: NPM_BUILD, startCommand: "npm start" },
  nestjs: { label: "NestJS", type: "web_service", runtime: "node", buildCommand: NPM_BUILD, startCommand: "node dist/main" },
  python: { label: "Python (FastAPI)", type: "web_service", runtime: "python", buildCommand: "pip install -r requirements.txt", startCommand: "uvicorn app.main:app --host 0.0.0.0 --port $PORT" },
  flask: { label: "Python (Flask)", type: "web_service", runtime: "python", buildCommand: "pip install -r requirements.txt", startCommand: "gunicorn app:app --bind 0.0.0.0:$PORT" },
  django: { label: "Python (Django)", type: "web_service", runtime: "python", buildCommand: "pip install -r requirements.txt && python manage.py collectstatic --noinput", startCommand: "gunicorn config.wsgi:application --bind 0.0.0.0:$PORT" },
  go: { label: "Go", type: "web_service", runtime: "go", buildCommand: "go build -tags netgo -ldflags '-s -w' -o app", startCommand: "./app" },
  rails: { label: "Ruby on Rails", type: "web_service", runtime: "ruby", buildCommand: "bundle install && bundle exec rake assets:precompile", startCommand: "bundle exec rails server -b 0.0.0.0" },
  rust: { label: "Rust", type: "web_service", runtime: "rust", buildCommand: "cargo build --release", startCommand: "cargo run --release" },
  docker: { label: "Docker (PHP/Laravel, Java/Spring, .NET, ...)", type: "web_service", runtime: "docker", buildCommand: "", startCommand: "" },
  vite: { label: "React / Vue / Svelte (Vite) — static", type: "static_site", buildCommand: NPM_BUILD, startCommand: "", publishPath: "dist" },
  cra: { label: "React (Create React App) — static", type: "static_site", buildCommand: NPM_BUILD, startCommand: "", publishPath: "build" },
  // Angular writes to dist/<project>/browser; copy it to a fixed folder so any project name works.
  angular: { label: "Angular — static", type: "static_site", buildCommand: NPM_BUILD + " && mkdir -p site && cp -r dist/*/browser/. site/", startCommand: "", publishPath: "site" },
  astro: { label: "Astro — static", type: "static_site", buildCommand: NPM_BUILD, startCommand: "", publishPath: "dist" },
  static: { label: "Static site", type: "static_site", buildCommand: "", startCommand: "" },
  elixir: { label: "Elixir (Phoenix)", type: "web_service", runtime: "elixir", buildCommand: "mix deps.get --only prod && mix compile", startCommand: "mix phx.server" },
  bun: { label: "Bun (needs a Dockerfile)", type: "web_service", runtime: "docker", buildCommand: "", startCommand: "" },
  deno: { label: "Deno (needs a Dockerfile)", type: "web_service", runtime: "docker", buildCommand: "", startCommand: "" }
};

/** Free plan only, Render regions that support it. */
const REGIONS = ["oregon", "ohio", "virginia", "frankfurt", "singapore"];

module.exports = { TEMPLATES, RUNTIMES, REGIONS };

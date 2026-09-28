import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Keep the old REACT_APP_* variables working alongside VITE_*
  envPrefix: ["VITE_", "REACT_APP_"],
  server: { port: 3000 },
  preview: { port: 3000 },
  // Same output folder as Create React App, so hosting settings don't change
  // Sourcemaps so a crash's stack trace points at real file/line instead of
  // minified positions — worth the extra bytes while chasing bugs.
  build: { outDir: "build", sourcemap: true, chunkSizeWarningLimit: 900 },
});

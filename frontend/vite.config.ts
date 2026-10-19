import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run dev`            → talks to the FastAPI backend (VITE_API_URL, default http://localhost:8000)
// `npm run build:preview`  → one self-contained HTML file running on built-in demo data
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "preview" ? [viteSingleFile()] : [])],
  build: { outDir: mode === "preview" ? "dist-preview" : "dist" },
  server: { port: 5173 },
}));

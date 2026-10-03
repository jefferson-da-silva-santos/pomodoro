import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base relativa: o mesmo build roda no navegador e dentro do webview do Tauri.
export default defineConfig({
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2022", chunkSizeWarningLimit: 700 },
});

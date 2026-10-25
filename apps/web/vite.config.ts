import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// VISION_API_URL: aponta o editor para outro server (ex.: instância de teste)
const API = process.env.VISION_API_URL ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // API + arquivos de mídia servidos pelo server (staticFile do Remotion
      // resolve para /projects/... e /music/...)
      "/api": API,
      "/projects": API,
      "/music": API,
      "/library": API,
      // efeitos de media/sfx ("Efeitos sonoros" no painel de Áudio, template dinâmico)
      "/sfx": API,
    },
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { apiProxyTarget } from "./dev-proxy.ts";

// Start a disposable studio for development with `pnpm studio:fixture` (port 3101).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": apiProxyTarget(process.env) },
  },
});

import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@config": path.resolve(__dirname, "../hotel.config.ts"),
      "@shared": path.resolve(__dirname, "../shared")
    }
  }
});

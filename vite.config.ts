import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

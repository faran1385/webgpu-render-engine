import { defineConfig } from "vite";

export default defineConfig({
    build: {
        target: "esnext" // make Vite preserve top-level await
    },
    esbuild: {
        target: "esnext"
    }
});

import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs let the same build be opened from the Vite dev server
  // or served directly by the BBM API server on another port for hotspot play.
  base: "./",
  server: {
    // The dev server only serves the client. It is not the game server, so this
    // cannot be used by other devices without also pointing it at the API.
    host: true,
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        index: "index.html",
        play: "play.html",
      },
    },
  },
});

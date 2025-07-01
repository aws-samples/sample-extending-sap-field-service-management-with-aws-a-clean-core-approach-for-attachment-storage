import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // For local development, proxy the /api path to CloudFront:
      "/api": {
        target: "https://<cloudfront id>.cloudfront.net",
        changeOrigin: true,
      },
    },
  },
});

import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  workbox: {
    // New versions take over on the next reload instead of needing two.
    skipWaiting: true,
    clientsClaim: true,
  },
});

const nextConfig: NextConfig = {
  // node:sqlite is loaded via createRequire and must not be bundled.
  serverExternalPackages: ["@earendil-works/pi-ai", "@earendil-works/pi-agent-core"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withPWA(nextConfig);

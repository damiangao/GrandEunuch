import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
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

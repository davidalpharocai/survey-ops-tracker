import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Import .md files as raw strings (webpack 5 asset/source). The in-app User Guide
  // (/guide) imports USER_GUIDE.md this way so its content is bundled at build time —
  // no runtime fs, so it can never ENOENT on Vercel. (Dev runs on webpack here too.)
  webpack(config) {
    config.module.rules.push({ test: /\.md$/, type: 'asset/source' })
    return config
  },
  async headers() {
    return [
      {
        source: "/oauth/authorize",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;

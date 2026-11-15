import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project, so a package-lock.json in a parent folder
  // isn't mistaken for the monorepo root during output file tracing.
  outputFileTracingRoot: process.cwd(),
  images: {
    // Product photos returned by /api/scrape (Amazon's image CDN).
    remotePatterns: [
      { protocol: "https", hostname: "m.media-amazon.com" },
      { protocol: "https", hostname: "**.media-amazon.com" },
      { protocol: "https", hostname: "**.ssl-images-amazon.com" },
    ],
  },
};

export default nextConfig;

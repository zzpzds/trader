import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  typescript: {
    ignoreBuildErrors: process.env.NEXT_SKIP_TYPE_CHECK === "true",
  },
  experimental: {
    cpus: 1,
  },
};

export default nextConfig;

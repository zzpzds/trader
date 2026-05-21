import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: process.env.NEXT_SKIP_TYPE_CHECK === "true",
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permit the proxied development preview to load Next.js assets and HMR.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;

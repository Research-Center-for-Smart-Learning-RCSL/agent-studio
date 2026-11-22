import type { NextConfig } from "next";

// Cache Components stays off: every page is per-user and reads the session,
// so a static shell would buy nothing (docs/design.md, Architecture).
const nextConfig: NextConfig = {
  serverExternalPackages: ["pg"],
};

export default nextConfig;

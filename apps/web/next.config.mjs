/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone keeps the web image small (§2) — deploys stay fast because the
  // fat Playwright/LibreOffice image lives in the worker service only.
  output: "standalone",
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  transpilePackages: ["@course-prod/core"],
  experimental: {
    serverActions: { bodySizeLimit: "52mb" }, // §6.1 accepts uploads ≤ 50 MB
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

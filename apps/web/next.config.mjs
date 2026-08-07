import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone keeps the web image small (§2) — deploys stay fast because the
  // fat Playwright/LibreOffice image lives in the worker service only.
  output: "standalone",
  // fileURLToPath, not .pathname: the repo path contains a space, and
  // .pathname would hand Next a percent-encoded directory that never resolves,
  // silently skipping standalone output the Dockerfile depends on.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // Deliberately no serverExternalPackages. Every server dependency reaches
  // this app through @course-prod/core, a symlinked workspace package that
  // lives outside apps/web/node_modules — and Next only externalises and
  // traces requests that resolve *inside* node_modules. Anything listed here
  // would be dropped from the webpack graph and then never copied into the
  // standalone output, producing a build that passes and a server that dies at
  // boot with MODULE_NOT_FOUND.
  //
  // So everything gets bundled instead: pg, pg-boss and hash-wasm are all pure
  // JS/WASM, which is what makes that possible. Adding a dependency with a
  // native .node binding would break this and needs a different answer.
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

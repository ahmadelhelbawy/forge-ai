/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  experimental: {
    serverComponentsExternalPackages: ["forge"],
    // The `forge` workspace link points at the repo root, which contains
    // web/ itself: tracing it would recurse forever. The package resolves
    // live through the symlink at request time instead (the repo root must
    // be present wherever the standalone server runs — see DEPLOY.md).
    outputFileTracingExcludes: {
      "*": ["**/node_modules/forge/**"],
    },
  },
  webpack: (config, { isServer }) => {
    // The frozen FORGE core runs as real Node modules at request time, never
    // bundled: bundling breaks its import.meta.url-anchored file reads
    // (prompt template, YAML registries).
    if (isServer) {
      const current = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      config.externals = [...current, /^forge(\/.*)?$/];
    }
    return config;
  },
};

export default nextConfig;

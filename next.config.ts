import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static resolves its binary relative to its own folder, which bundling would break
  serverExternalPackages: ["ffmpeg-static"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // OAuth discovery for MCP clients. Clients also try the path-suffixed forms
  // (/.well-known/oauth-protected-resource/mcp), so both map to the same handler.
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/resource-metadata" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth/resource-metadata" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/as-metadata" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth/as-metadata" },
      { source: "/.well-known/openid-configuration", destination: "/api/oauth/as-metadata" },
      { source: "/.well-known/openid-configuration/:path*", destination: "/api/oauth/as-metadata" },
    ];
  },
  async headers() {
    return [
      {
        source: "/mcp",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version" },
          { key: "Access-Control-Expose-Headers", value: "WWW-Authenticate, Mcp-Session-Id" },
        ],
      },
    ];
  },
};

export default nextConfig;

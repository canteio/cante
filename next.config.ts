import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; " +
              // Next.js dev mode's bundler (HMR, react-refresh, sourcemap eval)
              // requires 'unsafe-eval' to run at all — without it, every client
              // component silently fails to hydrate (React never mounts, so
              // every button/dropdown/loading-state on every page is dead,
              // even though the underlying API calls succeed). Production
              // builds don't need eval, so this stays scoped to dev only —
              // the deployed CSP is unchanged and no less strict than before.
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}; ` +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: https:; font-src 'self' data:; " +
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
          },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default config;

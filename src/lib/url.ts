// Public origin of the site. APP_URL wins; otherwise it is read from the request,
// so a Cloudflare tunnel or a reverse proxy works without extra settings.
export function configuredUrl() {
  // RENDER_EXTERNAL_URL is set by Render for every web service
  const url = process.env.APP_URL?.trim() || process.env.RENDER_EXTERNAL_URL || "";
  return url.replace(/\/+$/, "");
}

export function baseUrl(req?: Request) {
  if (configuredUrl()) return configuredUrl();
  if (req) {
    const h = req.headers;
    const host = h.get("x-forwarded-host") || h.get("host");
    if (host) {
      const proto = h.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
      return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
    }
    return new URL(req.url).origin;
  }
  return "http://localhost:3000";
}

// A relative path only — blocks open redirects through ?next=
export function safeNext(raw: string | null | undefined, fallback = "/dashboard") {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

import { NextResponse } from "next/server";

export function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Protocol-Version");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export function preflight() {
  return withCors(new NextResponse(null, { status: 204 }));
}

// OAuth endpoints get form-encoded bodies by the spec; some clients send JSON.
export async function readForm(req: Request) {
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(json)) if (v != null) form.set(k, String(v));
    return form;
  }
  return new URLSearchParams(await req.text());
}

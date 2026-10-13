import { NextResponse } from "next/server";
import { handleJsonRpc } from "@/lib/mcp";
import { userIdFromBearer } from "@/lib/oauth";
import { baseUrl } from "@/lib/url";

export const runtime = "nodejs";

function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
  return res;
}

// Without a valid token the client is pointed at the OAuth metadata; Claude and ChatGPT
// then register, send the user to /oauth/authorize, and come back with a token.
function unauthorized(req: Request, error?: string) {
  const meta = `${baseUrl(req)}/.well-known/oauth-protected-resource`;
  const res = NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Kirish talab qilinadi" } },
    { status: 401 }
  );
  res.headers.set(
    "WWW-Authenticate",
    `Bearer resource_metadata="${meta}"${error ? `, error="${error}"` : ""}, scope="instagram"`
  );
  return cors(res);
}

async function authUserId(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return userIdFromBearer(token);
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

// No server-initiated SSE stream: Streamable HTTP clients fall back to plain POST.
export async function GET(req: Request) {
  if (!(await authUserId(req))) return unauthorized(req);
  const res = new NextResponse(null, { status: 405 });
  res.headers.set("Allow", "POST, OPTIONS");
  return cors(res);
}

export async function POST(req: Request) {
  const hadToken = Boolean(req.headers.get("authorization"));
  const userId = await authUserId(req);
  if (!userId) return unauthorized(req, hadToken ? "invalid_token" : undefined);

  const body = await req.json().catch(() => null);
  if (!body) {
    return cors(NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 }));
  }

  if (Array.isArray(body)) {
    const results = [];
    for (const item of body) {
      const r = await handleJsonRpc(userId, item, baseUrl(req));
      if (r) results.push(r);
    }
    if (!results.length) return cors(new NextResponse(null, { status: 202 }));
    return cors(NextResponse.json(results));
  }
  const result = await handleJsonRpc(userId, body, baseUrl(req));
  if (!result) return cors(new NextResponse(null, { status: 202 }));
  return cors(NextResponse.json(result));
}

export async function DELETE() {
  return cors(new NextResponse(null, { status: 204 }));
}

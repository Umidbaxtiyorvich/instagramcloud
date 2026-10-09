import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { handleJsonRpc } from "@/lib/mcp";

export const runtime = "nodejs";

function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, Mcp-Session-Id");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  return res;
}

async function userFromAuth(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const urlToken = new URL(req.url).searchParams.get("token");
  const mcpToken = token || urlToken;
  if (!mcpToken) return null;
  return prisma.user.findUnique({ where: { mcpToken } });
}

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET(req: Request) {
  // Return basic info without auth for Claude connector
  return cors(
    NextResponse.json({
      name: "instagram-cloud",
      version: "1.0.0",
      protocol: "mcp",
      tools: true,
    })
  );
}

export async function POST(req: Request) {
  const user = await userFromAuth(req);
  const body = await req.json();
  
  // For Claude connector, use first user if no auth
  let userId = user?.id;
  if (!userId) {
    const firstUser = await prisma.user.findFirst();
    if (firstUser) {
      userId = firstUser.id;
    } else {
      return cors(NextResponse.json({ error: "No users found" }, { status: 401 }));
    }
  }
  
  if (Array.isArray(body)) {
    const results = [];
    for (const item of body) {
      const r = await handleJsonRpc(userId, item);
      if (r) results.push(r);
    }
    return cors(NextResponse.json(results.length === 1 ? results[0] : results));
  }
  const result = await handleJsonRpc(userId, body);
  if (!result) return cors(new NextResponse(null, { status: 202 }));
  return cors(NextResponse.json(result));
}

export async function DELETE() {
  return cors(new NextResponse(null, { status: 204 }));
}

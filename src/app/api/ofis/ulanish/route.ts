import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { TAYYOR_MCP, tekshirUrl, tekshirVaSaqla, vositalar } from "@/lib/mcp-ulanish";
import type { McpServer } from "@prisma/client";

// AI Ofis «Ulanishlar»: foydalanuvchining MCP serverlari. Tokenlar hech qachon brauzerga qaytmaydi.

const korinish = (s: McpServer) => {
  const v = vositalar(s);
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    auth: s.auth,
    enabled: s.enabled,
    allowWrites: s.allowWrites,
    ulangan: s.auth === "none" || Boolean(s.accessTokenEnc),
    vositalar: v,
    oqishSoni: v ? v.filter((x) => x.readOnly).length : null,
    checkedAt: s.checkedAt,
    lastError: s.lastError,
  };
};

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const rows = await prisma.mcpServer.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({
    ulanishlar: rows.map(korinish),
    tayyor: TAYYOR_MCP,
    claude: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.OPENAI_API_KEY),
  });
}

const Yangi = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().max(500),
  auth: z.enum(["none", "token", "oauth"]),
  token: z.string().trim().max(4000).optional(),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const p = Yangi.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Ma'lumot noto'g'ri" }, { status: 400 });
  const { name, url, auth, token } = p.data;
  try {
    tekshirUrl(url);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (auth === "token" && !token) return NextResponse.json({ error: "API tokenni kiriting" }, { status: 400 });
  if (await prisma.mcpServer.count({ where: { userId: user.id } }) >= 20) {
    return NextResponse.json({ error: "Ko'pi bilan 20 ta ulanish" }, { status: 400 });
  }
  if (await prisma.mcpServer.findFirst({ where: { userId: user.id, name } })) {
    return NextResponse.json({ error: "Bu nomli ulanish bor" }, { status: 409 });
  }
  let s = await prisma.mcpServer.create({
    data: { userId: user.id, name, url, auth, accessTokenEnc: auth === "token" && token ? encryptSecret(token) : null },
  });
  if (auth !== "oauth") s = await tekshirVaSaqla(s);
  return NextResponse.json({ ulanish: korinish(s) });
}

const Ozgartir = z.object({
  id: z.string().max(64),
  enabled: z.boolean().optional(),
  allowWrites: z.boolean().optional(),
  token: z.string().trim().min(1).max(4000).optional(),
  tekshir: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const p = Ozgartir.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Ma'lumot noto'g'ri" }, { status: 400 });
  const eski = await prisma.mcpServer.findFirst({ where: { id: p.data.id, userId: user.id } });
  if (!eski) return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  let s = await prisma.mcpServer.update({
    where: { id: eski.id },
    data: {
      ...(p.data.enabled !== undefined ? { enabled: p.data.enabled } : {}),
      ...(p.data.allowWrites !== undefined ? { allowWrites: p.data.allowWrites } : {}),
      ...(p.data.token && eski.auth === "token" ? { accessTokenEnc: encryptSecret(p.data.token) } : {}),
    },
  });
  if (p.data.tekshir || p.data.token) s = await tekshirVaSaqla(s);
  return NextResponse.json({ ulanish: korinish(s) });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  await prisma.mcpServer.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}

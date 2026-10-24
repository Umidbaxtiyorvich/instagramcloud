import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

// AI apps (Claude, ChatGPT…) the user let in through OAuth
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const tokens = await prisma.oAuthToken.findMany({
    where: { userId: user.id, revokedAt: null, refreshExpiresAt: { gt: new Date() } },
    include: { client: true },
    orderBy: { createdAt: "desc" },
  });
  // refresh rotation leaves one live row per grant; group by client for display
  const byClient = new Map<string, { clientId: string; name: string; since: Date; lastUsedAt: Date | null }>();
  for (const t of tokens) {
    const prev = byClient.get(t.clientId);
    const last = [prev?.lastUsedAt, t.lastUsedAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] || null;
    byClient.set(t.clientId, { clientId: t.clientId, name: t.client.name, since: prev?.since && prev.since < t.createdAt ? prev.since : t.createdAt, lastUsedAt: last });
  }
  return NextResponse.json({ connections: [...byClient.values()] });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const clientId = new URL(req.url).searchParams.get("clientId") || "";
  await prisma.oAuthToken.updateMany({
    where: { userId: user.id, clientId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}

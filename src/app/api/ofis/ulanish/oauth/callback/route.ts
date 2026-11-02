import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { oauthYakunla, tekshirVaSaqla } from "@/lib/mcp-ulanish";
import { baseUrl } from "@/lib/url";

// MCP serverning ruxsat sahifasidan qaytish: kodni tokenga almashtiradi va vositalarni tekshiradi
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const qayt = (xabar: string) =>
    NextResponse.redirect(`${baseUrl(req)}/ofis?ulanish=${encodeURIComponent(xabar)}`, { status: 303 });
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${baseUrl(req)}/login?next=/ofis`, { status: 303 });
  const state = q.get("state") ?? "";
  const s = state ? await prisma.mcpServer.findUnique({ where: { oauthState: state } }) : null;
  if (!s || s.userId !== user.id) return qayt("Ulanish so'rovi topilmadi yoki eskirgan");
  if (q.get("error")) {
    await prisma.mcpServer.update({
      where: { id: s.id },
      data: { oauthState: null, oauthVerifierEnc: null, lastError: `Ruxsat berilmadi: ${q.get("error")}` },
    });
    return qayt(`${s.name}: ruxsat berilmadi`);
  }
  try {
    const t = await oauthYakunla(state, q.get("code") ?? "", req);
    const r = await tekshirVaSaqla(t);
    return qayt(r.lastError ? `${s.name} ulandi, lekin: ${r.lastError}` : `${s.name} ulandi`);
  } catch (e) {
    await prisma.mcpServer.update({ where: { id: s.id }, data: { lastError: (e as Error).message } });
    return qayt(`${s.name}: ${(e as Error).message}`);
  }
}

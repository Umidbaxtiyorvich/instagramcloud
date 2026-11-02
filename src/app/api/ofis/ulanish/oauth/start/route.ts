import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { oauthBoshla } from "@/lib/mcp-ulanish";
import { baseUrl } from "@/lib/url";

// MCP server bilan OAuth: foydalanuvchini serverning ruxsat sahifasiga yuboradi
export async function GET(req: Request) {
  const qayt = (xabar: string) =>
    NextResponse.redirect(`${baseUrl(req)}/ofis?ulanish=${encodeURIComponent(xabar)}`, { status: 303 });
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${baseUrl(req)}/login?next=/ofis`, { status: 303 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const s = await prisma.mcpServer.findFirst({ where: { id, userId: user.id, auth: "oauth" } });
  if (!s) return qayt("Ulanish topilmadi");
  try {
    return NextResponse.redirect(await oauthBoshla(s, req), { status: 303 });
  } catch (e) {
    await prisma.mcpServer.update({ where: { id: s.id }, data: { lastError: (e as Error).message } });
    return qayt((e as Error).message);
  }
}

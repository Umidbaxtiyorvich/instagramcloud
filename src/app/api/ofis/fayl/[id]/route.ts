import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { MIME, type FaylTur } from "@/lib/ofis-fayl";

export const runtime = "nodejs";

// Agent yasagan faylni yuklab berish — faqat egasiga
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Kirish kerak", { status: 401 });
  const { id } = await params;
  const f = await prisma.ofisFayl.findFirst({ where: { id, userId: user.id } });
  if (!f) return new Response("Fayl topilmadi yoki muddati o'tgan", { status: 404 });
  const ascii = f.nom.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(Buffer.from(f.data), {
    headers: {
      "Content-Type": MIME[f.tur as FaylTur] ?? "application/octet-stream",
      "Content-Length": String(f.hajm),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.nom)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

const schema = z.object({
  accountId: z.string(),
  type: z.enum(["comment", "dm"]),
  keywords: z.array(z.string()),
  matchMode: z.enum(["contains", "any"]).optional(),
  scope: z.enum(["all", "selected"]).optional(),
  mediaIds: z.array(z.string()).optional(),
  dmMessage: z.string().min(1),
  publicReplies: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});

async function owns(userId: string, accountId: string) {
  return prisma.instagramAccount.findFirst({ where: { id: accountId, userId } });
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const accountId = new URL(req.url).searchParams.get("accountId");
  if (!accountId || !(await owns(user.id, accountId))) return NextResponse.json({ rules: [] });
  const rules = await prisma.autoRule.findMany({ where: { accountId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ rules });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Ma'lumot to'liq emas" }, { status: 400 });
  if (parsed.data.matchMode !== "any" && !parsed.data.keywords.length) {
    return NextResponse.json({ error: "Kalit so'z kiriting yoki «Istalgan komment» ni tanlang" }, { status: 400 });
  }
  if (!(await owns(user.id, parsed.data.accountId))) return NextResponse.json({ error: "Yo'q" }, { status: 403 });
  const rule = await prisma.autoRule.create({
    data: {
      accountId: parsed.data.accountId,
      type: parsed.data.type,
      keywords: JSON.stringify(parsed.data.keywords),
      matchMode: parsed.data.matchMode || "contains",
      scope: parsed.data.scope || "all",
      mediaIds: JSON.stringify(parsed.data.mediaIds || []),
      dmMessage: parsed.data.dmMessage,
      publicReplies: JSON.stringify(parsed.data.publicReplies || ["Direct'ga yubordik 📩"]),
      enabled: parsed.data.enabled ?? true,
    },
  });
  return NextResponse.json({ rule });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const body = await req.json();
  const rule = await prisma.autoRule.findUnique({ where: { id: body.id } });
  if (!rule || !(await owns(user.id, rule.accountId))) return NextResponse.json({ error: "Yo'q" }, { status: 403 });
  const updated = await prisma.autoRule.update({
    where: { id: body.id },
    data: {
      enabled: body.enabled ?? rule.enabled,
      dmMessage: body.dmMessage ?? rule.dmMessage,
      keywords: body.keywords ? JSON.stringify(body.keywords) : rule.keywords,
      publicReplies: body.publicReplies ? JSON.stringify(body.publicReplies) : rule.publicReplies,
      matchMode: body.matchMode ?? rule.matchMode,
    },
  });
  return NextResponse.json({ rule: updated });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id kerak" }, { status: 400 });
  const rule = await prisma.autoRule.findUnique({ where: { id } });
  if (!rule || !(await owns(user.id, rule.accountId))) return NextResponse.json({ error: "Yo'q" }, { status: 403 });
  await prisma.autoRule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

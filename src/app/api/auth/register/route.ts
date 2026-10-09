import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(80).optional(),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Email va kamida 8 belgilik parol kerak" }, { status: 400 });
  }
  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (exists) return NextResponse.json({ error: "Bu email allaqachon ro'yxatdan o'tgan" }, { status: 409 });
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email.toLowerCase(),
      passwordHash: await hashPassword(parsed.data.password),
      name: parsed.data.name || parsed.data.email.split("@")[0],
      mcpToken: `ic_${randomToken(24)}`,
    },
  });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}

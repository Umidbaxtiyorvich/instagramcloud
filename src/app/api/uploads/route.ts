import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listUploads, saveUpload } from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  return NextResponse.json({ uploads: await listUploads(user.id) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Fayl tanlang" }, { status: 400 });
  try {
    const upload = await saveUpload(user.id, file);
    return NextResponse.json({ upload });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Yuklanmadi" }, { status: 400 });
  }
}

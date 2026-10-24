import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  davrOraligi,
  hujjatXulosa,
  kassaXulosa,
  moliyaHolati,
  moliyaRuxsat,
  qarzXulosa,
  tolovXulosa,
  tovarXulosa,
  type Davr,
} from "@/lib/ofis-moliya";

const DAVRLAR = new Set<Davr>(["bugun", "kecha", "hafta", "oy"]);

// AI Ofis «Moliya» paneli: CloudShop + Telegram to'lov boti (faqat o'qish)
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const holat = moliyaHolati();
  if (!moliyaRuxsat(user.email)) {
    return NextResponse.json({ ruxsat: false, holat });
  }
  const q = new URL(req.url).searchParams;
  const bolim = q.get("bolim") || "holat";
  const davr = (DAVRLAR.has(q.get("davr") as Davr) ? q.get("davr") : "bugun") as Davr;
  const [dan, gacha] = davrOraligi(davr);
  try {
    let data: unknown = null;
    if (bolim === "kassa") data = await kassaXulosa(dan, gacha);
    else if (bolim === "hujjatlar") data = await hujjatXulosa(dan, gacha);
    else if (bolim === "tovarlar") data = await tovarXulosa();
    else if (bolim === "qarzlar") data = await qarzXulosa();
    else if (bolim === "tolovlar") data = await tolovXulosa(dan, gacha);
    return NextResponse.json({ ruxsat: true, holat, data });
  } catch (e) {
    return NextResponse.json({ ruxsat: true, holat, error: e instanceof Error ? e.message : "Xato" }, { status: 502 });
  }
}

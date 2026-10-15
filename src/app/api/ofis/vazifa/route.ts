import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { JAMOALAR, lokalTaqsimot, type JamoaId, type Taqsimot } from "@/lib/ofis";

const JAMOA_IDLAR = JAMOALAR.map((j) => j.id) as [JamoaId, ...JamoaId[]];

const Kirish = z.object({
  matn: z.string().trim().min(2).max(2000),
  jamoa: z.enum(JAMOA_IDLAR).optional(),
  agentId: z.string().max(64).optional(),
  agentlar: z
    .array(
      z.object({
        id: z.string().max(64),
        ism: z.string().max(80),
        rol: z.string().max(120),
        jamoa: z.enum(JAMOA_IDLAR),
        konikmalar: z.array(z.string().max(60)).max(12),
      }),
    )
    .max(80),
  tarix: z
    .array(z.object({ kimdan: z.enum(["men", "agent"]), matn: z.string().max(4000) }))
    .max(20)
    .optional(),
});

const Javob = z.object({
  jamoa: z.enum(JAMOA_IDLAR),
  agentId: z.string().nullable(),
  yangiAgent: z
    .object({
      ism: z.string(),
      rol: z.string(),
      avatar: z.string(),
      konikmalar: z.array(z.string()),
    })
    .nullable(),
  qadamlar: z.array(z.string()),
  javob: z.string(),
  natija: z.string(),
  tasdiqKerak: z.boolean(),
});

const TIZIM = `Siz "AI Ofis"ning bosh dispetcherisiz. Foydalanuvchi o'zbek tilida vazifa aytadi.
Ofisda 8 ta jamoa bor:
${JAMOALAR.map((j) => `- ${j.id} (${j.nom}): ${j.tavsif}. Vositalar: ${j.vositalar.join(", ")}`).join("\n")}

Vazifangiz:
1. Vazifaga eng mos jamoani tanlang.
2. Shu jamoadagi mavjud agentlardan biri mos kelsa, uning id sini agentId ga yozing va yangiAgent = null.
   Hech biri mos kelmasa, agentId = null va yangiAgent da shu vazifaga ixtisoslashgan yangi agent yarating:
   qisqa o'zbekcha ism (1-3 so'z), rol, bitta emoji avatar, 2-4 ta ko'nikma (kebab-case, o'zbekcha).
3. qadamlar: agent bajaradigan 3-5 ta qisqa qadam.
4. javob: agentning foydalanuvchiga 1-2 jumlali samimiy javobi (u vazifani olganini aytadi).
5. natija: vazifaning o'zini imkon qadar bajaring — matn, reja, post matni, ssenariy, javob shabloni, hisob-kitob va hokazo.
   Tashqi tizimga kirish kerak bo'lsa (fayl, akkaunt), nima qilinishini aniq reja sifatida yozing. Markdown ishlatmang, oddiy matn.
6. tasdiqKerak: natija tashqariga chiqsa (joylash, yuborish, to'lov) true.
Hamma matn faqat o'zbek tilida (lotin yozuvida) bo'lsin.`;

let mijoz: Anthropic | null = null;
function claude() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  mijoz ??= new Anthropic();
  return mijoz;
}

export async function POST(req: Request) {
  const tahlil = Kirish.safeParse(await req.json().catch(() => null));
  if (!tahlil.success) {
    return NextResponse.json({ error: "Vazifa matni noto'g'ri" }, { status: 400 });
  }
  const { matn, jamoa, agentId, agentlar, tarix } = tahlil.data;

  const lokal = () => {
    const t = lokalTaqsimot(matn, agentlar, jamoa);
    if (agentId && agentlar.some((a) => a.id === agentId)) {
      const a = agentlar.find((x) => x.id === agentId)!;
      return { ...t, jamoa: a.jamoa, agentId, yangiAgent: null };
    }
    return t;
  };

  const client = claude();
  const user = client ? await getSessionUser() : null;
  if (!client || !user) {
    return NextResponse.json({ taqsimot: lokal(), eslatma: client ? "Claude uchun tizimga kiring" : undefined });
  }

  const kontekst = [
    `Mavjud agentlar:\n${agentlar.map((a) => `- id=${a.id} | ${a.ism} | ${a.rol} | jamoa=${a.jamoa} | ${a.konikmalar.join(", ")}`).join("\n")}`,
    jamoa ? `Foydalanuvchi ${jamoa} jamoasi xonasida turibdi.` : "",
    agentId ? `Foydalanuvchi to'g'ridan-to'g'ri agentId=${agentId} bilan gaplashyapti — shu agentni tanlang.` : "",
    tarix?.length ? `Oldingi suhbat:\n${tarix.map((x) => `${x.kimdan === "men" ? "Foydalanuvchi" : "Agent"}: ${x.matn}`).join("\n")}` : "",
    `Yangi vazifa: ${matn}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const res = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(Javob) },
      system: [{ type: "text", text: TIZIM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: kontekst }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) {
      return NextResponse.json({ taqsimot: lokal() });
    }
    const p = res.parsed_output;
    const borAgent = p.agentId && agentlar.some((a) => a.id === p.agentId) ? p.agentId : null;
    const taqsimot: Taqsimot = {
      ...p,
      agentId: borAgent,
      yangiAgent: borAgent ? null : p.yangiAgent ?? lokal().yangiAgent,
      manba: "claude",
    };
    return NextResponse.json({ taqsimot });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      console.error("ofis: Claude kaliti noto'g'ri");
    } else if (e instanceof Anthropic.RateLimitError) {
      console.error("ofis: Claude limiti tugadi");
    } else if (e instanceof Anthropic.APIError) {
      console.error(`ofis: Claude xatosi ${e.status}`, e.message);
    } else {
      console.error("ofis:", e);
    }
    return NextResponse.json({ taqsimot: lokal(), eslatma: "Claude javob bermadi, lokal rejim" });
  }
}

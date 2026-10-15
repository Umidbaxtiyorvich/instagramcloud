import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { JAMOALAR, lokalTaqsimot, type JamoaId, type Taqsimot } from "@/lib/ofis";
import { IG_VOSITALAR, amalNomi, igAkkaunt, igVosita, lokalInstagram, yangiTasdiqlar } from "@/lib/ofis-instagram";

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
Hamma matn faqat o'zbek tilida (lotin yozuvida) bo'lsin.

INSTAGRAM: foydalanuvchining Instagram Cloud akkaunti ulangan bo'lsa, sizda instagram_* vositalari bor.
- Statistika, Reels hisoboti, kommentlar, Direct, qoidalar haqidagi savollarda avval vositani chaqirib, HAQIQIY ma'lumot bilan javob bering (o'ylab topmang).
- Yozish vositalari (kommentga javob, Direct yuborish, komment yashirish, Reels joylash, qoida yaratish/o'zgartirish/o'chirish) darhol bajarilmaydi — foydalanuvchi tasdig'iga navbatga qo'yiladi. Ularni faqat foydalanuvchi aniq so'raganda chaqiring; bunda tasdiqKerak = true.
- Jamoalar: statistika va hisobotlar — tahlil; kommentlar, postlar, Reels, avto-javob qoidalari — ijtimoiy; Direct va mijoz savollari — mijozlar.
- natija ichida qaysi raqam/ma'lumot qayerdan olinganini qisqa ko'rsating.`;

// faqat o'qiydigan Instagram vositalari (qolganlari tasdiq navbatiga tushadi)
const NOMLAR_OQISH = new Set([
  "instagram_accounts",
  "instagram_reels_report",
  "instagram_insights",
  "instagram_list_comments",
  "instagram_list_dms",
  "instagram_list_rules",
  "instagram_inbox_topics",
]);

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

  const user = await getSessionUser();

  const lokal = async (): Promise<Taqsimot> => {
    let t = lokalTaqsimot(matn, agentlar, jamoa);
    const ig = user ? await lokalInstagram(user.id, matn).catch(() => null) : null;
    if (ig) {
      const boshqa = ig.jamoa !== t.jamoa ? lokalTaqsimot(matn, agentlar, ig.jamoa) : t;
      t = {
        ...boshqa,
        jamoa: ig.jamoa,
        qadamlar: [...ig.qadamlar, "Sizga ko'rsatish"],
        natija: ig.natija,
        tasdiqKerak: false,
        instagram: { amallar: ig.amallar, tasdiqlar: [] },
      };
      if (t.agentId && !agentlar.some((a) => a.id === t.agentId && a.jamoa === ig.jamoa)) t.agentId = null;
    }
    if (agentId && agentlar.some((a) => a.id === agentId)) {
      const a = agentlar.find((x) => x.id === agentId)!;
      return { ...t, jamoa: a.jamoa, agentId, yangiAgent: null };
    }
    return t;
  };

  const client = claude();
  if (!client || !user) {
    return NextResponse.json({ taqsimot: await lokal(), eslatma: client ? "Claude uchun tizimga kiring" : undefined });
  }

  const akk = await igAkkaunt(user.id);
  const kontekst = [
    akk ? `Ulangan Instagram: @${akk.username}${akk.isDemo ? " (demo)" : ""}, ${akk.followersCount} obunachi.` : "Instagram ulanmagan — instagram_* vositalari ishlamaydi.",
    `Mavjud agentlar:\n${agentlar.map((a) => `- id=${a.id} | ${a.ism} | ${a.rol} | jamoa=${a.jamoa} | ${a.konikmalar.join(", ")}`).join("\n")}`,
    jamoa ? `Foydalanuvchi ${jamoa} jamoasi xonasida turibdi.` : "",
    agentId ? `Foydalanuvchi to'g'ridan-to'g'ri agentId=${agentId} bilan gaplashyapti — shu agentni tanlang.` : "",
    tarix?.length ? `Oldingi suhbat:\n${tarix.map((x) => `${x.kimdan === "men" ? "Foydalanuvchi" : "Agent"}: ${x.matn}`).join("\n")}` : "",
    `Yangi vazifa: ${matn}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const vositalar: Anthropic.Beta.BetaTool[] = akk
    ? IG_VOSITALAR.map((v) => ({
        name: v.name,
        description: v.description,
        input_schema: v.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      }))
    : [];

  const boshlandi = new Date();
  const amallar: string[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: kontekst }];

  try {
    for (let qadam = 0; qadam < 8; qadam++) {
      const res = await client.beta.messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(Javob) },
        system: [{ type: "text", text: TIZIM, cache_control: { type: "ephemeral" } }],
        tools: vositalar.length ? vositalar : undefined,
        messages,
      });

      if (res.stop_reason === "tool_use" || res.stop_reason === "pause_turn") {
        // javobni o'zgartirmasdan tarixga qo'shamiz (parse qo'shgan maydonlarsiz)
        messages.push({
          role: "assistant",
          content: res.content.map((b) =>
            b.type === "text" ? { type: "text" as const, text: b.text } : (b as Anthropic.Beta.BetaContentBlockParam),
          ),
        });
        if (res.stop_reason === "pause_turn") continue;
        const natijalar: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const b of res.content) {
          if (b.type !== "tool_use") continue;
          try {
            const matnNatija = await igVosita(user.id, b.name, (b.input ?? {}) as Record<string, unknown>);
            if (!b.name.startsWith("list_") && !NOMLAR_OQISH.has(b.name)) {
              amallar.push(`Tasdiqqa qo'yildi: ${b.name.replace("instagram_", "")}`);
            } else {
              amallar.push(amalNomi(b.name));
            }
            natijalar.push({ type: "tool_result", tool_use_id: b.id, content: matnNatija.slice(0, 20000) });
          } catch (e) {
            natijalar.push({
              type: "tool_result",
              tool_use_id: b.id,
              content: e instanceof Error ? e.message : "Xato",
              is_error: true,
            });
          }
        }
        messages.push({ role: "user", content: natijalar });
        continue;
      }

      if (res.stop_reason === "refusal" || !res.parsed_output) {
        return NextResponse.json({ taqsimot: await lokal() });
      }
      const p = res.parsed_output;
      const tasdiqlar = await yangiTasdiqlar(user.id, boshlandi);
      const borAgent = p.agentId && agentlar.some((a) => a.id === p.agentId) ? p.agentId : null;
      const taqsimot: Taqsimot = {
        ...p,
        tasdiqKerak: p.tasdiqKerak || tasdiqlar.length > 0,
        agentId: borAgent,
        yangiAgent: borAgent ? null : p.yangiAgent ?? (await lokal()).yangiAgent,
        manba: "claude",
        instagram: amallar.length || tasdiqlar.length ? { amallar, tasdiqlar } : undefined,
      };
      return NextResponse.json({ taqsimot });
    }
    return NextResponse.json({ taqsimot: await lokal(), eslatma: "Vazifa juda uzun bo'lib ketdi, lokal rejim" });
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
    return NextResponse.json({ taqsimot: await lokal(), eslatma: "Claude javob bermadi, lokal rejim" });
  }
}

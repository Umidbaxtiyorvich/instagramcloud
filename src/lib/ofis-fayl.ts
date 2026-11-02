import ExcelJS from "exceljs";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import PptxGenJS from "pptxgenjs";
import { z } from "zod";
import { prisma } from "./db";

// AI Ofis agentlari uchun hujjat yasash: Excel, Word, PowerPoint. Model tuzilgan mazmun beradi
// (bo'limlar: matn, ro'yxat, jadval), biz undan haqiqiy fayl yasab bazaga qo'yamiz va
// chatda «Yuklab olish» tugmasi chiqadi.

export const FAYL_TURLARI = ["xlsx", "docx", "pptx"] as const;
export type FaylTur = (typeof FAYL_TURLARI)[number];

export const MIME: Record<FaylTur, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const Katak = z.union([z.string(), z.number(), z.null()]);
const Bolim = z.object({
  sarlavha: z.string().max(200),
  matn: z.string().max(8000).optional().nullable(),
  punktlar: z.array(z.string().max(500)).max(40).optional().nullable(),
  jadval: z
    .object({
      ustunlar: z.array(z.string().max(100)).min(1).max(20),
      qatorlar: z.array(z.array(Katak).max(20)).max(2000),
    })
    .optional()
    .nullable(),
});
export const Hujjat = z.object({
  tur: z.enum(FAYL_TURLARI),
  nom: z.string().min(1).max(120),
  sarlavha: z.string().max(200),
  bolimlar: z.array(Bolim).min(1).max(40),
});
export type Hujjat = z.infer<typeof Hujjat>;

export const HUJJAT_VOSITA = {
  name: "hujjat_yarat",
  description:
    "Excel (xlsx), Word (docx) yoki PowerPoint (pptx) fayl yasaydi; foydalanuvchiga chatda «Yuklab olish» tugmasi chiqadi. " +
    "Foydalanuvchi hisobot/jadval/taqdimotni fayl qilib so'rasa ishlating. Avval kerakli ma'lumotni boshqa vositalardan oling — " +
    "jadvalga faqat haqiqiy raqamlarni yozing. Excel: har bir jadvalli bo'lim alohida varaq. PowerPoint: har bir bo'lim — slayd " +
    "(punktlar 3-6 ta qisqa). Word: bo'limlar sarlavha + matn/punkt/jadval.",
  inputSchema: {
    type: "object",
    properties: {
      tur: { type: "string", enum: [...FAYL_TURLARI] },
      nom: { type: "string", description: "Fayl nomi, kengaytmasiz, masalan «Oktyabr hisoboti»" },
      sarlavha: { type: "string" },
      bolimlar: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sarlavha: { type: "string" },
            matn: { type: "string" },
            punktlar: { type: "array", items: { type: "string" } },
            jadval: {
              type: "object",
              properties: {
                ustunlar: { type: "array", items: { type: "string" } },
                qatorlar: { type: "array", items: { type: "array", items: { type: ["string", "number", "null"] } } },
              },
              required: ["ustunlar", "qatorlar"],
            },
          },
          required: ["sarlavha"],
        },
      },
    },
    required: ["tur", "nom", "sarlavha", "bolimlar"],
  },
};

// "1 250 000" yoki "12,5%" kabi matnli raqamlarni Excel'da raqam qilib qo'yamiz
function raqam(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^-?[\d\s]+([.,]\d+)?$/.test(s) && /\d/.test(s)) return Number(s.replace(/\s/g, "").replace(",", "."));
  return s;
}

function varaqNomi(s: string, band: Set<string>) {
  let n = s.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 28) || "Varaq";
  const asl = n;
  for (let i = 2; band.has(n.toLowerCase()); i++) n = `${asl.slice(0, 25)} ${i}`;
  band.add(n.toLowerCase());
  return n;
}

async function excel(h: Hujjat) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AI Ofis";
  const band = new Set<string>();
  const izohlar: Hujjat["bolimlar"] = [];
  for (const b of h.bolimlar) {
    if (!b.jadval) {
      izohlar.push(b);
      continue;
    }
    const ws = wb.addWorksheet(varaqNomi(b.sarlavha, band));
    ws.addRow([b.sarlavha]).font = { bold: true, size: 14 };
    if (b.matn) ws.addRow([b.matn]);
    ws.addRow([]);
    const bosh = ws.addRow(b.jadval.ustunlar);
    bosh.font = { bold: true, color: { argb: "FFFFFFFF" } };
    bosh.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
      c.alignment = { vertical: "middle", wrapText: true };
    });
    for (const q of b.jadval.qatorlar) ws.addRow(q.map(raqam));
    ws.views = [{ state: "frozen", ySplit: bosh.number }];
    ws.autoFilter = { from: { row: bosh.number, column: 1 }, to: { row: bosh.number, column: b.jadval.ustunlar.length } };
    b.jadval.ustunlar.forEach((u, i) => {
      const uzun = Math.max(u.length, ...b.jadval!.qatorlar.map((q) => String(q[i] ?? "").length));
      const col = ws.getColumn(i + 1);
      col.width = Math.min(60, Math.max(10, uzun + 2));
      col.numFmt = "#,##0.##";
    });
  }
  if (izohlar.length || !wb.worksheets.length) {
    const ws = wb.addWorksheet(varaqNomi(wb.worksheets.length ? "Izoh" : h.sarlavha, band));
    ws.getColumn(1).width = 100;
    ws.addRow([h.sarlavha]).font = { bold: true, size: 14 };
    for (const b of izohlar) {
      ws.addRow([]);
      ws.addRow([b.sarlavha]).font = { bold: true };
      if (b.matn) ws.addRow([b.matn]).alignment = { wrapText: true };
      for (const p of b.punktlar ?? []) ws.addRow([`• ${p}`]);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function word(h: Hujjat) {
  const children: (Paragraph | Table)[] = [new Paragraph({ text: h.sarlavha, heading: HeadingLevel.TITLE })];
  for (const b of h.bolimlar) {
    children.push(new Paragraph({ text: b.sarlavha, heading: HeadingLevel.HEADING_1 }));
    for (const qism of (b.matn ?? "").split(/\n{1,}/).filter((x) => x.trim())) children.push(new Paragraph({ text: qism.trim() }));
    for (const p of b.punktlar ?? []) children.push(new Paragraph({ text: p, bullet: { level: 0 } }));
    if (b.jadval) {
      const qator = (k: (string | number | null)[], bosh: boolean) =>
        new TableRow({
          tableHeader: bosh,
          children: b.jadval!.ustunlar.map(
            (_, i) =>
              new TableCell({
                shading: bosh ? { fill: "2F5597" } : undefined,
                children: [
                  new Paragraph({
                    alignment: typeof k[i] === "number" ? AlignmentType.RIGHT : AlignmentType.LEFT,
                    children: [new TextRun({ text: String(k[i] ?? ""), bold: bosh, color: bosh ? "FFFFFF" : undefined })],
                  }),
                ],
              }),
          ),
        });
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [qator(b.jadval.ustunlar, true), ...b.jadval.qatorlar.map((q) => qator(q.map(raqam), false))],
        }),
        new Paragraph({ text: "" }),
      );
    }
  }
  return Packer.toBuffer(new Document({ creator: "AI Ofis", title: h.sarlavha, sections: [{ children }] }));
}

async function slayd(h: Hujjat) {
  const p = new PptxGenJS();
  p.layout = "LAYOUT_WIDE";
  p.title = h.sarlavha;
  const KOK = "2F5597";
  const s0 = p.addSlide();
  s0.background = { color: KOK };
  s0.addText(h.sarlavha, { x: 0.6, y: 2.4, w: 12, h: 1.5, fontSize: 40, bold: true, color: "FFFFFF" });
  s0.addText(new Date().toLocaleDateString("uz-UZ"), { x: 0.6, y: 4.0, w: 12, h: 0.6, fontSize: 18, color: "DDE6F7" });
  for (const b of h.bolimlar) {
    const yangi = () => {
      const s = p.addSlide();
      s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: KOK } });
      s.addText(b.sarlavha, { x: 0.5, y: 0.35, w: 12.3, h: 0.9, fontSize: 28, bold: true, color: "1F2937" });
      return s;
    };
    const s = yangi();
    let y = 1.4;
    if (b.matn) {
      s.addText(b.matn.slice(0, 600), { x: 0.6, y, w: 12.1, h: 1.2, fontSize: 16, color: "374151", valign: "top" });
      y += 1.3;
    }
    if (b.punktlar?.length) {
      s.addText(
        b.punktlar.slice(0, 8).map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
        { x: 0.6, y, w: 12.1, h: Math.min(4.8, 0.55 * b.punktlar.length + 0.3), fontSize: 20, color: "111827", valign: "top" },
      );
      y += Math.min(4.8, 0.55 * b.punktlar.length + 0.4);
    }
    if (b.jadval) {
      // katta jadval bir nechta slaydga bo'linadi
      const sig = 10;
      const bosh = b.jadval.ustunlar.map((u) => ({ text: u, options: { bold: true, color: "FFFFFF", fill: { color: KOK } } }));
      const qatorlar = b.jadval.qatorlar.map((q) => b.jadval!.ustunlar.map((_, i) => ({ text: String(q[i] ?? "") })));
      for (let i = 0; i < Math.max(1, qatorlar.length); i += sig) {
        const sl = i === 0 && y < 4 ? s : yangi();
        const yy = sl === s ? y : 1.4;
        sl.addTable([bosh, ...qatorlar.slice(i, i + sig)], { x: 0.5, y: yy, w: 12.3, fontSize: 12, border: { type: "solid", color: "D1D5DB", pt: 0.5 } });
      }
    }
  }
  return Buffer.from((await p.write({ outputType: "nodebuffer" })) as ArrayBuffer);
}

export function faylNomi(h: Pick<Hujjat, "nom" | "tur">) {
  const toza = h.nom.replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 100) || "hujjat";
  return `${toza.replace(/\.(xlsx|docx|pptx)$/i, "")}.${h.tur}`;
}

export async function hujjatYarat(userId: string, kirish: unknown) {
  const h = Hujjat.parse(kirish);
  const data = h.tur === "xlsx" ? await excel(h) : h.tur === "docx" ? await word(h) : await slayd(h);
  // eski fayllar bazani to'ldirmasin
  await prisma.ofisFayl.deleteMany({ where: { userId, createdAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
  const f = await prisma.ofisFayl.create({
    data: { userId, nom: faylNomi(h), tur: h.tur, hajm: data.length, data: new Uint8Array(data) },
    select: { id: true, nom: true, tur: true },
  });
  return f;
}

// Foydalanuvchi matnida qaysi fayl turi so'ralgan (lokal rejim va maslahat uchun)
export function soralganTur(matn: string): FaylTur | null {
  const m = matn.toLowerCase();
  if (/excel|xlsx|eksel|jadval fayl|spreadsheet/.test(m)) return "xlsx";
  if (/power ?point|pptx|prezentats|taqdimot|slayd/.test(m)) return "pptx";
  if (/\bword\b|docx|vord|hujjat fayl/.test(m)) return "docx";
  return null;
}

// AI yo'q (lokal rejim): tayyor natija matnidan oddiy fayl — qatorlar bo'lim/punkt bo'ladi
export function matndanHujjat(tur: FaylTur, nom: string, matn: string): Hujjat {
  const qatorlar = matn.split("\n").map((s) => s.trim()).filter(Boolean);
  if (tur === "xlsx") {
    return {
      tur,
      nom,
      sarlavha: nom,
      bolimlar: [{ sarlavha: nom, jadval: { ustunlar: ["Ma'lumot"], qatorlar: qatorlar.map((q) => [q.replace(/^[•\-–]\s*/, "")]) } }],
    };
  }
  return { tur, nom, sarlavha: nom, bolimlar: [{ sarlavha: nom, punktlar: qatorlar.slice(0, 40).map((q) => q.replace(/^[•\-–]\s*/, "")) }] };
}

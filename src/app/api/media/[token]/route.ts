import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Public, unguessable URL that Instagram downloads the video/photo from while publishing.
// Supports Range requests, which video fetchers commonly use.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await prisma.mediaUpload.findUnique({
    where: { publicToken: token },
    select: { data: true, mimeType: true, expiresAt: true },
  });
  if (!row?.data || row.expiresAt < new Date()) return new Response("Not found", { status: 404 });

  const body = Buffer.from(row.data);
  const total = body.length;
  const headers = {
    "Content-Type": row.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") || "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start >= total || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
    }
    return new Response(body.subarray(start, end + 1), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(body, { headers: { ...headers, "Content-Length": String(total) } });
}

export async function HEAD(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const res = await GET(req, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}

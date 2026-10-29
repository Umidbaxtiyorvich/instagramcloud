import { NextResponse } from "next/server";
import { saveBytes, userFromUploadToken } from "@/lib/uploads";

export const runtime = "nodejs";

// Raw-body upload for AI clients: `curl -X POST --data-binary @video.mp4 -H "Content-Type: video/mp4" <url>`.
// The token comes from the instagram_upload_url MCP tool and expires after 30 minutes.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const userId = await userFromUploadToken(url.searchParams.get("token") || "");
  if (!userId) return NextResponse.json({ error: "Havola yaroqsiz yoki muddati o'tgan" }, { status: 401 });
  const mimeType = (req.headers.get("content-type") || "").split(";")[0].trim();
  const filename = url.searchParams.get("filename") || (mimeType === "image/jpeg" ? "photo.jpg" : "video.mp4");
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    const upload = await saveBytes(userId, bytes, filename, mimeType);
    return NextResponse.json({ upload_id: upload.id, filename: upload.filename, kind: upload.kind, size: upload.size });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Yuklanmadi" }, { status: 400 });
  }
}

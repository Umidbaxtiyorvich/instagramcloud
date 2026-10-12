import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { clearPendingIg, readPendingIg } from "@/lib/ig-pending";
import { saveInstagramAccount } from "@/lib/ig-save";

function cleanUsername(raw: string) {
  return raw.replace(/^@/, "").trim().replace(/[^\w.]/g, "").slice(0, 30);
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const decision = body.decision;

  if (decision !== "approve") {
    await clearPendingIg();
    return NextResponse.json({ ok: true, status: "cancelled" });
  }

  const pending = await readPendingIg();
  const username = cleanUsername(String(body.username || pending?.username || user.name || "instagram")) || "instagram";

  const account = await saveInstagramAccount(
    user.id,
    pending && !pending.isDemo
      ? pending
      : {
          igUserId: pending?.igUserId || `ig_${username}`,
          username,
          name: pending?.name || username,
          profilePic: pending?.profilePic || "",
          followersCount: pending?.followersCount || 12480,
          accessToken: pending?.accessToken || randomToken(16),
          tokenExpiresAt: pending?.tokenExpiresAt || null,
          isDemo: !pending || pending.isDemo,
        }
  );
  await clearPendingIg();
  return NextResponse.json({ ok: true, status: "connected", accountId: account.id });
}

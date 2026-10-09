import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { readPendingIg } from "@/lib/ig-pending";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Kirish kerak" }, { status: 401 });
  const pending = await readPendingIg();
  if (!pending) return NextResponse.json({ pending: null });
  return NextResponse.json({
    pending: {
      username: pending.username,
      name: pending.name,
      profilePic: pending.profilePic,
      followersCount: pending.followersCount,
      isDemo: pending.isDemo,
    },
  });
}

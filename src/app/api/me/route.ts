import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale,
      mcpToken: user.mcpToken,
      accounts: user.accounts.map((a) => ({
        id: a.id,
        username: a.username,
        name: a.name,
        profilePic: a.profilePic,
        isDemo: a.isDemo,
        dmAutoReplyEnabled: a.dmAutoReplyEnabled,
        defaultDmReply: a.defaultDmReply,
        defaultDmMode: a.defaultDmMode,
        commentRepliesOn: a.commentRepliesOn,
        followersCount: a.followersCount,
      })),
    },
  });
}

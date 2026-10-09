import { prisma } from "./db";
import { encryptSecret } from "./crypto";
import { seedDemoMedia } from "./auto-reply";
import type { PendingIg } from "./ig-pending";

export async function saveInstagramAccount(userId: string, pending: PendingIg) {
  const account = await prisma.instagramAccount.upsert({
    where: { userId_igUserId: { userId, igUserId: pending.igUserId } },
    create: {
      userId,
      igUserId: pending.igUserId,
      username: pending.username,
      name: pending.name,
      profilePic: pending.profilePic,
      followersCount: pending.followersCount,
      accessTokenEnc: encryptSecret(pending.accessToken),
      tokenExpiresAt: pending.tokenExpiresAt ? new Date(pending.tokenExpiresAt) : null,
      isDemo: pending.isDemo,
      defaultDmReply: "Salom! Tez orada javob beramiz. «stop» yozsangiz avto-javob o'chadi.",
      defaultDmMode: "first",
    },
    update: {
      username: pending.username,
      name: pending.name,
      profilePic: pending.profilePic,
      followersCount: pending.followersCount,
      accessTokenEnc: encryptSecret(pending.accessToken),
      tokenExpiresAt: pending.tokenExpiresAt ? new Date(pending.tokenExpiresAt) : null,
      isDemo: pending.isDemo,
    },
  });

  if (pending.isDemo) await seedDemoMedia(account.id);

  const existing = await prisma.autoRule.count({ where: { accountId: account.id } });
  if (!existing) {
    await prisma.autoRule.createMany({
      data: [
        {
          accountId: account.id,
          type: "comment",
          keywords: JSON.stringify(["narx", "necha pul", "qancha", "price"]),
          dmMessage:
            "Salom! Ko'ylak — 390 000 so'm, to'plam — 690 000. Buyurtma: yourbrand.uz/linen",
          publicReplies: JSON.stringify(["Direct'ga yubordik 📩", "Havolani Direct'ga yozdik"]),
        },
        {
          accountId: account.id,
          type: "dm",
          keywords: JSON.stringify(["yetkazib berish", "dostavka", "delivery"]),
          dmMessage: "Shahar bo'ylab 24 soatda yetkazamiz. Viloyatlarga 2–3 kun.",
          publicReplies: JSON.stringify([]),
        },
      ],
    });
  }

  return account;
}

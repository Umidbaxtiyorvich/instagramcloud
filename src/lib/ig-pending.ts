import { cookies } from "next/headers";
import { encryptSecret, decryptSecret } from "./crypto";

const PENDING = "ic_ig_pending";
const OAUTH_STATE = "ic_ig_oauth";

export type PendingIg = {
  igUserId: string;
  username: string;
  name: string;
  profilePic: string;
  followersCount: number;
  accessToken: string;
  tokenExpiresAt: string | null;
  isDemo: boolean;
};

async function setCookie(name: string, value: string, maxAge: number) {
  const jar = await cookies();
  jar.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function setOauthState(state: string) {
  await setCookie(OAUTH_STATE, state, 600);
}

export async function readOauthState() {
  const jar = await cookies();
  return jar.get(OAUTH_STATE)?.value || null;
}

export async function clearOauthState() {
  const jar = await cookies();
  jar.delete(OAUTH_STATE);
}

export async function setPendingIg(data: PendingIg) {
  await setCookie(PENDING, encryptSecret(JSON.stringify(data)), 600);
}

export async function readPendingIg(): Promise<PendingIg | null> {
  const jar = await cookies();
  const raw = jar.get(PENDING)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(decryptSecret(raw)) as PendingIg;
  } catch {
    return null;
  }
}

export async function clearPendingIg() {
  const jar = await cookies();
  jar.delete(PENDING);
}

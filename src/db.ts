import { encodeBase64Url } from "jsr:@std/encoding";
import { crypto } from "jsr:@std/crypto/crypto";

// Custom Types

export type ShortLink = {
  shortCode: string;
  longUrl: string;
  createdAt: number;
  userId: string;
  clickCount: number;
  lastClickEvent?: string;
};

export type GitHubUser = {
  login: string; // username
  avatar_url: string;
  html_url: string;
};

export type ClickAnalytics = {
  shortUrl: string;
  createdAt: number;
  ipAddress: string;
  userAgent: string;
  country?: string;
};

// Read & Write Data with Deno KV

function normalizeUrl(longUrl: string): string {
  let url = longUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  return url;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return !!parsed.hostname && parsed.hostname.length > 2;
  } catch {
    return false;
  }
}

function randomShortCode(length = 7): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export async function generateShortCode(longUrl: string): Promise<string> {
  const normalizedUrl = normalizeUrl(longUrl);
  if (!isValidUrl(normalizedUrl)) {
    throw new Error("Invalid URL provided. Please enter a valid web address.");
  }

  // Try up to 5 times to avoid rare collision
  for (let i = 0; i < 5; i++) {
    const shortCode = randomShortCode();
    const exists = await getShortLink(shortCode);
    if (!exists) {
      return shortCode;
    }
  }
  throw new Error("Could not generate a unique short code. Please try again.");
}


// Initialize KV with error handling
let kv: Deno.Kv;

try {
  kv = await Deno.openKv();
} catch (error) {
  console.error("Failed to initialize Deno KV:", error);
  console.error("Make sure to run with --unstable-kv flag");
  throw new Error("KV initialization failed. Run with --unstable-kv flag.");
}

export async function storeShortLink(
  longUrl: string,
  shortCode: string,
  userId: string,
) {
  const shortLinkKey = ["shortlinks", shortCode];
  const data: ShortLink = {
    shortCode,
    longUrl,
    userId,
    createdAt: Date.now(),
    clickCount: 0,
  };

  const userKey = [userId, shortCode];

  const res = await kv.atomic()
    .set(shortLinkKey, data)
    .set(userKey, shortCode)
    .commit();

  return res;
}

export async function getShortLink(shortCode: string) {
  const link = await kv.get<ShortLink>(["shortlinks", shortCode]);
  return link.value;
}

export async function getAllLinks() {
  const list = kv.list<ShortLink>({ prefix: ["shortlinks"] });
  const res = await Array.fromAsync(list);
  const linkValues = res.map((v) => v.value);
  return linkValues;
}

export async function storeUser(sessionId: string, userData: GitHubUser) {
  const key = ["sessions", sessionId];
  const res = await kv.set(key, userData);
  return res;
}

export async function getUser(sessionId: string) {
  const key = ["sessions", sessionId];
  const res = await kv.get<GitHubUser>(key);
  return res.value;
}

export async function getUserLinks(userId: string) {
  const list = kv.list<string>({ prefix: [userId] });
  const res = await Array.fromAsync(list);
  const userShortLinkKeys = res.map((v) => ["shortlinks", v.value]);

  const userRes = await kv.getMany<ShortLink[]>(userShortLinkKeys);
  const userShortLinks = await Array.fromAsync(userRes);

  return userShortLinks.map((v) => v.value);
}

// Realtime Analytics

export function watchShortLink(shortCode: string) {
  const shortLinkKey = ["shortlinks", shortCode];
  const shortLinkStream = kv.watch<ShortLink[]>([shortLinkKey]).getReader();
  return shortLinkStream;
}

export async function getClickEvent(shortCode: string, clickId: number) {
  const analytics = await kv.get<ClickAnalytics>([
    "analytics",
    shortCode,
    clickId,
  ]);
  return analytics.value;
}

export async function incrementClickCount(
  shortCode: string,
  data?: Partial<ClickAnalytics>,
) {
  const shortLinkKey = ["shortlinks", shortCode];
  const shortLink = await kv.get(shortLinkKey);
  const shortLinkData = shortLink.value as ShortLink;

  const newClickCount = shortLinkData?.clickCount + 1;

  const analyticsKey = ["analytics", shortCode, newClickCount];
  const analyticsData = {
    shortCode,
    createdAt: Date.now(),
    ...data,
    // ipAddress: "192.168.1.1",
    // userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    // country: "United States"
  };

  const res = await kv.atomic()
    .check(shortLink)
    .set(shortLinkKey, {
      ...shortLinkData,
      clickCount: newClickCount,
    })
    .set(analyticsKey, analyticsData)
    .commit();

  if (!res.ok) {
    console.error("Error recording click!");
  }

  return res;
}
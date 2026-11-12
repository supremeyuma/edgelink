/**
 * Static bot heuristic. Bots are still served the redirect (so link previews
 * and crawlers work); they are only excluded from unique-visitor counts and
 * reported separately.
 *
 * False-positive policy: a user agent that contains any marker below is
 * counted as a bot. We intentionally do not block suspicious agents, because
 * blocking breaks previews and privacy-focused browsers. If a real user is
 * misclassified, the impact is a lower unique count, never a broken link.
 */
const BOT_MARKERS = [
  "bot",
  "crawler",
  "spider",
  "curl",
  "wget",
  "python-requests",
  "python-urllib",
  "go-http-client",
  "java/",
  "okhttp",
  "headlesschrome",
  "phantomjs",
  "puppeteer",
  "playwright",
  "slurp",
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "discordbot",
  "telegrambot",
  "whatsapp",
  "embedly",
  "quora link preview",
  "outbrain",
  "pinterest",
  "vkshare",
  "w3c_validator",
  "ahrefs",
  "semrush",
  "mj12",
  "dotbot",
  "bytespider",
  "petalbot",
  "applebot",
  "bingpreview",
  "google-inspectiontool",
  "adsbot-google",
  "mediapartners-google",
];

export function isBot(userAgent: string | null | undefined, asn?: number | null): boolean {
  if (!userAgent || userAgent.trim() === "") return true;
  const ua = userAgent.toLowerCase();
  if (BOT_MARKERS.some((marker) => ua.includes(marker))) return true;
  // Optional ASN deny list for known hosting/scanning networks.
  if (asn !== undefined && asn !== null && BOT_ASNS.has(asn)) return true;
  return false;
}

/** Populated only with well-known hosting/scanning ASNs, kept intentionally small. */
const BOT_ASNS = new Set<number>([
  16276, // OVH
  24940, // Hetzner
  14061, // DigitalOcean
  16509, // Amazon
  14618, // Amazon
  8075, // Microsoft
  15169, // Google (crawlers; previews are still served)
]);

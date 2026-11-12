import { describe, expect, it } from "vitest";
import { isBot } from "../../src/lib/bot";
import { classifyDevice } from "../../src/lib/device";
import { getClientIp, hashIp } from "../../src/lib/ip";
import { isBlockedTarget } from "../../src/lib/target-blocklist";

describe("bot heuristic", () => {
  it("classifies common agents", () => {
    expect(isBot("curl/8.5.0")).toBe(true);
    expect(isBot("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
    expect(isBot("facebookexternalhit/1.1")).toBe(true);
    expect(isBot("python-requests/2.31")).toBe(true);
    expect(isBot("")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(
      isBot(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      ),
    ).toBe(false);
    expect(
      isBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15"),
    ).toBe(false);
  });

  it("uses the optional ASN deny list", () => {
    expect(isBot("Mozilla/5.0 Chrome/120", 16509)).toBe(true);
    expect(isBot("Mozilla/5.0 Chrome/120", 64500)).toBe(false);
  });
});

describe("device classification", () => {
  it("distinguishes mobile, tablet, and desktop", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148")).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("tablet");
    expect(classifyDevice("Mozilla/5.0 (X11; Linux x86_64) Chrome/120")).toBe("desktop");
    expect(classifyDevice(null)).toBe("desktop");
  });
});

describe("IP hashing", () => {
  it("is deterministic per salt and changes with the salt", async () => {
    const first = await hashIp("203.0.113.7", "salt-a");
    const second = await hashIp("203.0.113.7", "salt-a");
    const rotated = await hashIp("203.0.113.7", "salt-b");
    expect(first).toBe(second);
    expect(first).not.toBe(rotated);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain("203.0.113.7");
  });

  it("uses CF-Connecting-IP before forwarded headers and falls back locally", () => {
    const cf = new Request("https://x", {
      headers: { "CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "10.0.0.1" },
    });
    expect(getClientIp(cf)).toBe("203.0.113.7");

    const forwarded = new Request("https://x", {
      headers: { "X-Forwarded-For": "10.0.0.2, 10.0.0.3" },
    });
    expect(getClientIp(forwarded)).toBe("10.0.0.2");
    expect(getClientIp(new Request("https://x"))).toBe("127.0.0.1");
  });
});

describe("target blocklist", () => {
  it("blocks exact domains and subdomains", () => {
    expect(isBlockedTarget("https://phishing.example/login")).toBe(true);
    expect(isBlockedTarget("https://evil.phishing.example/login")).toBe(true);
    expect(isBlockedTarget("https://example.com")).toBe(false);
    expect(isBlockedTarget("not a url")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { isAuthorized, timingSafeEqual } from "../../src/lib/auth";
import { hashPassword, verifyPassword } from "../../src/lib/password";

describe("timingSafeEqual", () => {
  it("compares equal and unequal strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});

describe("isAuthorized", () => {
  it("accepts only the exact bearer token", () => {
    expect(isAuthorized("Bearer secret", "secret")).toBe(true);
    expect(isAuthorized("Bearer  secret", "secret")).toBe(true);
    expect(isAuthorized("bearer secret", "secret")).toBe(false);
    expect(isAuthorized("Bearer wrong", "secret")).toBe(false);
    expect(isAuthorized(undefined, "secret")).toBe(false);
    expect(isAuthorized("Bearer secret", "")).toBe(false);
  });
});

describe("password hashing", () => {
  it("produces a verifiable pbkdf2 hash with a random salt", async () => {
    const first = await hashPassword("hunter2");
    const second = await hashPassword("hunter2");
    expect(first).toMatch(/^pbkdf2\$100000\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword("hunter2", first)).toBe(true);
    expect(await verifyPassword("hunter3", first)).toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    for (const stored of ["", "plain", "pbkdf2$abc$c2FsdA$aGFzaA", "md5$1$a$b"]) {
      expect(await verifyPassword("hunter2", stored)).toBe(false);
    }
  });
});

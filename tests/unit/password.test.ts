import { describe, expect, it } from "vitest";

import {
  fakeVerifyPassword,
  hashPassword,
  verifyPassword,
} from "@/server/auth/password";

describe("password hashing", () => {
  it("produces a bcrypt hash that does not contain the plaintext", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");

    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(hash).not.toContain("correct-horse-battery-staple");
  });

  it("salts each hash, so identical passwords hash differently", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same-password"),
      hashPassword("same-password"),
    ]);

    expect(a).not.toBe(b);
  });

  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");

    await expect(verifyPassword("correct-horse-battery-staple", hash)).resolves.toBe(
      true,
    );
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");

    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("always reports failure for the timing-equalisation path", async () => {
    await expect(fakeVerifyPassword("anything")).resolves.toBe(false);
  });
});

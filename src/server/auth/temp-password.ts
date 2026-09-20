import { randomInt } from "node:crypto";

/**
 * One-time passwords for accounts an administrator creates on someone's
 * behalf.
 *
 * There is no email delivery in V1, so the password is shown once to the
 * administrator who created the account and handed over in person. Look-alike
 * characters (0/O, 1/l/I) are excluded because it will be read aloud or copied
 * off a screen.
 *
 * The result always satisfies `passwordSchema`: 12 characters with at least
 * one letter and one digit.
 */
const LETTERS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALPHABET = LETTERS + DIGITS;

export function generateTemporaryPassword(length = 12): string {
  const chars = [
    LETTERS[randomInt(LETTERS.length)]!,
    DIGITS[randomInt(DIGITS.length)]!,
  ];

  while (chars.length < length) {
    chars.push(ALPHABET[randomInt(ALPHABET.length)]!);
  }

  // Fisher-Yates, so the guaranteed letter and digit are not always first.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }

  return chars.join("");
}

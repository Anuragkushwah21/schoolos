import bcrypt from "bcryptjs";

/**
 * bcrypt work factor. 12 is the current sensible default: roughly 250ms on
 * modern hardware, which is slow enough to make offline cracking expensive
 * without making login feel sluggish.
 */
const BCRYPT_COST = 12;

/**
 * A pre-computed hash of a value no user can have.
 *
 * Login compares against this when the email doesn't exist, so a request for a
 * non-existent account costs the same time as one for a real account. Without
 * it, response timing leaks which email addresses are registered.
 */
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing-equalisation", BCRYPT_COST);

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

/**
 * Burn the same amount of CPU as a real password check. Call this on the
 * "user not found" branch of login so the branch is not observable.
 */
export async function fakeVerifyPassword(plaintext: string): Promise<false> {
  await bcrypt.compare(plaintext, DUMMY_HASH);
  return false;
}

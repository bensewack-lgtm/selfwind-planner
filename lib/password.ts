import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt is built into Node, memory-hard, and recommended by OWASP for passwords.
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } satisfies ScryptOptions;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, params: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, params, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

// Stored as: scrypt$N$r$p$salt$hash (base64), so parameters can be raised later.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(password, Buffer.from(salt, "base64"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PARAMS.maxmem,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Used when the email doesn't exist, so a failed login takes the same time either way.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(password, await dummyHash);
}

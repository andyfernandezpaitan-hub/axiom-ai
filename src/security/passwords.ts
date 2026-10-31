import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Hash de contraseñas con scrypt (incluido en Node, sin dependencias nativas).
 * Parametros por defecto segun OWASP: N=2^17, r=8, p=1.
 * Formato guardado: scrypt$N$r$p$salt(base64)$hash(base64)
 */
export interface ScryptParams {
    N: number;
    r: number;
    p: number;
}

export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 17, r: 8, p: 1 };

const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(
            password.normalize("NFKC"),
            salt,
            KEY_LENGTH,
            { ...params, maxmem: 256 * 1024 * 1024 },
            (error, key) => (error ? reject(error) : resolve(key))
        );
    });
}

export async function hashPassword(
    password: string,
    params: ScryptParams = DEFAULT_SCRYPT
): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(password, salt, params);
    return ["scrypt", params.N, params.r, params.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
        return false;
    }
    const expected = Buffer.from(hashB64 ?? "", "base64");
    const key = await derive(password, Buffer.from(saltB64 ?? "", "base64"), params);
    return expected.length === key.length && timingSafeEqual(expected, key);
}

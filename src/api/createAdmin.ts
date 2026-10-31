import path from "node:path";
import { createInterface } from "node:readline";

import { AxiomDatabase } from "../database/AxiomDatabase";
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../security/passwords";

/**
 * Crea (o asciende) una cuenta ADMIN desde la consola.
 * Uso: npm run create-admin -- correo@ejemplo.com
 * La contraseña se pide por teclado y no se muestra.
 */
function askHidden(question: string): Promise<string> {
    return new Promise((resolve) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        const output = rl as unknown as { _writeToOutput: (text: string) => void };
        let muted = false;
        output._writeToOutput = (text: string) => {
            if (!muted || text.includes("\n")) process.stdout.write(muted ? "\n" : text);
        };
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
        muted = true;
    });
}

async function main(): Promise<void> {
    try {
        process.loadEnvFile(".env");
    } catch {
        // Sin .env.
    }

    const email = (process.argv[2] ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        throw new Error("Uso: npm run create-admin -- correo@ejemplo.com");
    }

    const dbPath = process.env.AXIOM_DB_PATH ?? path.join(process.cwd(), "data", "axiom.db");
    const db = new AxiomDatabase(dbPath);

    try {
        const existing = db.getUserByEmail(email);
        if (existing) {
            db.setUserRole(existing.id, "ADMIN");
            db.deleteUserSessions(existing.id);
            console.log(`La cuenta ${email} ahora es ADMIN.`);
            return;
        }

        const password = await askHidden("Contraseña para el admin: ");
        const repeat = await askHidden("Repite la contraseña: ");
        if (password !== repeat) throw new Error("Las contraseñas no coinciden.");
        if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
            throw new Error(`La contraseña debe tener entre ${MIN_PASSWORD_LENGTH} y ${MAX_PASSWORD_LENGTH} caracteres.`);
        }

        db.createUser(email, await hashPassword(password), "ADMIN", "Administrador");
        console.log(`Cuenta ADMIN creada: ${email}`);
    } finally {
        db.close();
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Error desconocido.");
    process.exit(1);
});

import path from "node:path";

import { AxiomDatabase } from "../database/AxiomDatabase";
import { buildServer } from "./server";

/**
 * Arranca la API de AXIOM.
 * Variables (.env):
 * - AXIOM_API_PORT (opcional, por defecto 3000)
 * - AXIOM_DB_PATH (opcional, por defecto data/axiom.db)
 */
async function main(): Promise<void> {
    try {
        process.loadEnvFile(".env");
    } catch {
        // Sin .env: se usan las variables del sistema.
    }

    const port = Number.parseInt(process.env.AXIOM_API_PORT ?? "3000", 10);
    const dbPath = process.env.AXIOM_DB_PATH ?? path.join(process.cwd(), "data", "axiom.db");

    const db = new AxiomDatabase(dbPath);
    const app = await buildServer({ db, logger: true });

    // Solo escucha en esta computadora. Para publicarla hara falta HTTPS
    // (proxy inverso o hosting) y login de usuarios.
    await app.listen({ host: "127.0.0.1", port });

    const shutdown = async () => {
        await app.close();
        db.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
    console.error(
        "No se pudo iniciar la API de AXIOM:",
        error instanceof Error ? error.message : "Error desconocido."
    );
    process.exit(1);
});

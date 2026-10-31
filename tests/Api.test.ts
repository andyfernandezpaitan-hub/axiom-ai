import assert from "node:assert/strict";
import test from "node:test";

import { AxiomAI, type AxiomMessage } from "../src/ai/AxiomAI";
import { buildServer } from "../src/api/server";
import { AxiomDatabase } from "../src/database/AxiomDatabase";

const TOKEN = "t".repeat(40);
const AUTH = { authorization: `Bearer ${TOKEN}` };

async function setup(options: { rateLimitPerMinute?: number; received?: AxiomMessage[][] } = {}) {
    const db = new AxiomDatabase(":memory:");
    const received = options.received ?? [];
    const app = await buildServer({
        db,
        apiToken: TOKEN,
        rateLimitPerMinute: options.rateLimitPerMinute ?? 1000,
        createAxiom: () =>
            new AxiomAI({
                complete: async (messages) => {
                    received.push(messages);
                    return `respuesta ${received.length}`;
                }
            })
    });
    return { app, db, received };
}

async function createStudent(app: Awaited<ReturnType<typeof setup>>["app"]) {
    const res = await app.inject({
        method: "POST",
        url: "/api/students",
        headers: AUTH,
        payload: { name: "Ana" }
    });
    assert.equal(res.statusCode, 201);
    return res.json() as { id: string };
}

test("rechaza un token corto al crear el servidor", async () => {
    await assert.rejects(
        () => buildServer({ db: new AxiomDatabase(":memory:"), apiToken: "corto" }),
        /al menos 32/
    );
});

test("/health es publico y responde con security headers", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.match(String(res.headers["content-security-policy"]), /frame-ancestors 'none'/);
});

test("401 sin token o con token incorrecto", async () => {
    const { app } = await setup();
    const sin = await app.inject({ method: "POST", url: "/api/students", payload: { name: "Ana" } });
    assert.equal(sin.statusCode, 401);
    const malo = await app.inject({
        method: "POST",
        url: "/api/students",
        headers: { authorization: "Bearer otro-token" },
        payload: { name: "Ana" }
    });
    assert.equal(malo.statusCode, 401);
});

test("400 con input invalido (campos extra, id mal formado, nombre vacio)", async () => {
    const { app } = await setup();
    const extra = await app.inject({
        method: "POST",
        url: "/api/students",
        headers: AUTH,
        payload: { name: "Ana", level: "avanzado" }
    });
    assert.equal(extra.statusCode, 400);

    const badId = await app.inject({ method: "GET", url: "/api/students/1 OR 1=1", headers: AUTH });
    assert.equal(badId.statusCode, 400);

    const vacio = await app.inject({
        method: "POST",
        url: "/api/students",
        headers: AUTH,
        payload: { name: "\u0000\u0001" }
    });
    assert.equal(vacio.statusCode, 400);
});

test("crea un estudiante y devuelve solo los datos necesarios", async () => {
    const { app } = await setup();
    const student = await createStudent(app);
    const res = await app.inject({ method: "GET", url: `/api/students/${student.id}`, headers: AUTH });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.name, "Ana");
    assert.equal(body.exercisesCompleted, 0);
    assert.equal(body.exerciseHistory, undefined);
});

test("404 para un estudiante que no existe", async () => {
    const { app } = await setup();
    const res = await app.inject({
        method: "GET",
        url: "/api/students/00000000-0000-4000-8000-000000000000",
        headers: AUTH
    });
    assert.equal(res.statusCode, 404);
});

test("ejercicio: el cliente no recibe la respuesta y no puede responder dos veces", async () => {
    const { app, db } = await setup();
    const student = await createStudent(app);

    const created = await app.inject({
        method: "POST",
        url: `/api/students/${student.id}/exercises`,
        headers: AUTH
    });
    assert.equal(created.statusCode, 201);
    const exercise = created.json();
    assert.equal(exercise.answer, undefined);

    const correctAnswer = db.getExercise(exercise.exerciseId)?.exercise.answer;
    const first = await app.inject({
        method: "POST",
        url: `/api/exercises/${exercise.exerciseId}/answer`,
        headers: AUTH,
        payload: { answer: correctAnswer }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().correct, true);

    const second = await app.inject({
        method: "POST",
        url: `/api/exercises/${exercise.exerciseId}/answer`,
        headers: AUTH,
        payload: { answer: correctAnswer }
    });
    assert.equal(second.statusCode, 409);

    const progress = await app.inject({ method: "GET", url: `/api/students/${student.id}`, headers: AUTH });
    assert.equal(progress.json().correctAnswers, 1);
});

test("respuesta incorrecta devuelve los pasos de la explicacion", async () => {
    const { app } = await setup();
    const student = await createStudent(app);
    const { exerciseId } = (
        await app.inject({ method: "POST", url: `/api/students/${student.id}/exercises`, headers: AUTH })
    ).json();
    const res = await app.inject({
        method: "POST",
        url: `/api/exercises/${exerciseId}/answer`,
        headers: AUTH,
        payload: { answer: 999999 }
    });
    assert.equal(res.json().correct, false);
    assert.ok(res.json().steps.length > 0);
});

test("chat guarda el historial, lo reenvia al modelo y se puede borrar", async () => {
    const received: AxiomMessage[][] = [];
    const { app } = await setup({ received });
    const student = await createStudent(app);
    const url = `/api/students/${student.id}/chat`;

    await app.inject({ method: "POST", url, headers: AUTH, payload: { message: "hola" } });
    const second = await app.inject({ method: "POST", url, headers: AUTH, payload: { message: "otra" } });
    assert.equal(second.json().message, "respuesta 2");
    assert.deepEqual(received[1], [
        { role: "user", content: "hola" },
        { role: "assistant", content: "respuesta 1" },
        { role: "user", content: "otra" }
    ]);

    const history = await app.inject({ method: "GET", url: `/api/students/${student.id}/messages`, headers: AUTH });
    assert.equal(history.json().messages.length, 4);

    const del = await app.inject({ method: "DELETE", url: `/api/students/${student.id}/messages`, headers: AUTH });
    assert.equal(del.json().deleted, 4);
});

test("503 si el tutor no esta conectado y 502 sin filtrar el error del proveedor", async () => {
    const db = new AxiomDatabase(":memory:");
    const originalProvider = process.env.AXIOM_PROVIDER;
    const originalKey = process.env.ANTHROPIC_API_KEY;
    const originalUrl = process.env.AXIOM_OPENJARVIS_URL;
    delete process.env.AXIOM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AXIOM_OPENJARVIS_URL;
    try {
        const app = await buildServer({ db, apiToken: TOKEN });
        const student = await createStudent(app);
        const res = await app.inject({
            method: "POST",
            url: `/api/students/${student.id}/chat`,
            headers: AUTH,
            payload: { message: "hola" }
        });
        assert.equal(res.statusCode, 503);
    } finally {
        if (originalProvider !== undefined) process.env.AXIOM_PROVIDER = originalProvider;
        if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
        if (originalUrl !== undefined) process.env.AXIOM_OPENJARVIS_URL = originalUrl;
    }

    const roto = await buildServer({
        db: new AxiomDatabase(":memory:"),
        apiToken: TOKEN,
        createAxiom: () =>
            new AxiomAI({
                complete: async () => {
                    throw new Error("401 sk-secreta");
                }
            })
    });
    const student = await createStudent(roto);
    const res = await roto.inject({
        method: "POST",
        url: `/api/students/${student.id}/chat`,
        headers: AUTH,
        payload: { message: "hola" }
    });
    assert.equal(res.statusCode, 502);
    assert.doesNotMatch(res.body, /sk-secreta/);
});

test("429 al superar el limite de peticiones", async () => {
    const { app } = await setup({ rateLimitPerMinute: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
        codes.push((await app.inject({ method: "GET", url: "/health" })).statusCode);
    }
    assert.deepEqual(codes, [200, 200, 200, 429]);
});

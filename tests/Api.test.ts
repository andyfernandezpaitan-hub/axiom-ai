import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { FastifyInstance } from "fastify";

import { AxiomAI, type AxiomMessage } from "../src/ai/AxiomAI";
import { buildServer, SESSION_COOKIE } from "../src/api/server";
import { AxiomDatabase } from "../src/database/AxiomDatabase";
import { hashPassword, verifyPassword } from "../src/security/passwords";

const FAST_SCRYPT = { N: 2 ** 10, r: 8, p: 1 };
const PASSWORD = "clave-segura-123";

async function setup(
    options: { rateLimitPerMinute?: number; authRateLimitPerMinute?: number; received?: AxiomMessage[][] } = {}
) {
    const db = new AxiomDatabase(":memory:");
    const received = options.received ?? [];
    const app = await buildServer({
        db,
        scrypt: FAST_SCRYPT,
        rateLimitPerMinute: options.rateLimitPerMinute ?? 1000,
        authRateLimitPerMinute: options.authRateLimitPerMinute ?? 1000,
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

function sessionCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
    const c = res.cookies.find((x) => x.name === SESSION_COOKIE);
    assert.ok(c, "debe devolver la cookie de sesion");
    return `${SESSION_COOKIE}=${c.value}`;
}

async function register(app: FastifyInstance, email = "ana@ejemplo.com") {
    const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email, password: PASSWORD, name: "Ana" }
    });
    assert.equal(res.statusCode, 201);
    return { cookie: sessionCookie(res), user: res.json() as { id: string; role: string } };
}

async function makeUser(db: AxiomDatabase, email: string, role: "TEACHER" | "ADMIN") {
    db.createUser(email, await hashPassword(PASSWORD, FAST_SCRYPT), role, "Staff");
}

async function login(app: FastifyInstance, email: string) {
    const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: PASSWORD }
    });
    assert.equal(res.statusCode, 200);
    return sessionCookie(res);
}

test("contraseñas: se guardan con hash y se verifican", async () => {
    const stored = await hashPassword("mi-clave-secreta", FAST_SCRYPT);
    assert.doesNotMatch(stored, /mi-clave-secreta/);
    assert.equal(await verifyPassword("mi-clave-secreta", stored), true);
    assert.equal(await verifyPassword("otra-clave-xx", stored), false);
    assert.equal(await verifyPassword("x", "basura"), false);
});

test("/health es publico y responde con security headers", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.match(String(res.headers["content-security-policy"]), /frame-ancestors 'none'/);
});

test("registro: crea un STUDENT, cookie protegida y sin contraseña en la respuesta", async () => {
    const { app } = await setup();
    const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email: "Ana@Ejemplo.com", password: PASSWORD, name: "Ana" }
    });
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.role, "STUDENT");
    assert.equal(body.email, "ana@ejemplo.com");
    assert.doesNotMatch(res.body, /password|hash/i);

    const setCookie = String(res.headers["set-cookie"]);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Strict/);
});

test("registro: no deja elegir rol, exige contraseña larga y no repite correos", async () => {
    const { app } = await setup();
    const conRol = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email: "a@b.com", password: PASSWORD, name: "A", role: "ADMIN" }
    });
    assert.equal(conRol.statusCode, 400);

    const corta = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email: "a@b.com", password: "123", name: "A" }
    });
    assert.equal(corta.statusCode, 400);

    const mal = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email: "no-es-correo", password: PASSWORD, name: "A" }
    });
    assert.equal(mal.statusCode, 400);

    await register(app, "a@b.com");
    const repetido = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email: "a@b.com", password: PASSWORD, name: "A" }
    });
    assert.equal(repetido.statusCode, 409);
});

test("login: mismo error para correo inexistente o contraseña incorrecta", async () => {
    const { app } = await setup();
    await register(app);
    const malaClave = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "ana@ejemplo.com", password: "incorrecta-123" }
    });
    const noExiste = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: "nadie@ejemplo.com", password: "incorrecta-123" }
    });
    assert.equal(malaClave.statusCode, 401);
    assert.equal(noExiste.statusCode, 401);
    assert.equal(malaClave.body, noExiste.body);

    const ok = await login(app, "ana@ejemplo.com");
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: ok } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().progress.name, "Ana");
});

test("401 sin sesion y despues de cerrar sesion", async () => {
    const { app } = await setup();
    const sin = await app.inject({ method: "GET", url: "/api/me" });
    assert.equal(sin.statusCode, 401);

    const { cookie } = await register(app);
    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    assert.equal(out.statusCode, 204);
    const despues = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    assert.equal(despues.statusCode, 401);

    const inventada = await app.inject({
        method: "GET",
        url: "/api/me",
        headers: { cookie: `${SESSION_COOKIE}=inventada` }
    });
    assert.equal(inventada.statusCode, 401);
});

test("la base de datos guarda el hash de la sesion, no el token", async () => {
    const { app, db } = await setup();
    const { cookie } = await register(app);
    const token = cookie.split("=")[1] ?? "";
    // El token en claro funciona, pero no se puede buscar tal cual en la tabla.
    assert.ok(db.getSessionUser(token));
    assert.equal(db.getSessionUser(createHash("sha256").update(token).digest("hex")), undefined);
});

test("ejercicio: no expone la respuesta, no se responde dos veces y otro usuario no puede usarlo", async () => {
    const { app, db } = await setup();
    const ana = await register(app, "ana@ejemplo.com");
    const beto = await register(app, "beto@ejemplo.com");

    const created = await app.inject({ method: "POST", url: "/api/me/exercises", headers: { cookie: ana.cookie } });
    assert.equal(created.statusCode, 201);
    const exercise = created.json();
    assert.equal(exercise.answer, undefined);
    const correct = db.getExercise(exercise.exerciseId)?.exercise.answer;
    const url = `/api/exercises/${exercise.exerciseId}/answer`;

    const ajeno = await app.inject({ method: "POST", url, headers: { cookie: beto.cookie }, payload: { answer: correct } });
    assert.equal(ajeno.statusCode, 404);

    const first = await app.inject({ method: "POST", url, headers: { cookie: ana.cookie }, payload: { answer: correct } });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().correct, true);

    const second = await app.inject({ method: "POST", url, headers: { cookie: ana.cookie }, payload: { answer: correct } });
    assert.equal(second.statusCode, 409);

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: ana.cookie } });
    assert.equal(me.json().progress.correctAnswers, 1);
});

test("respuesta incorrecta devuelve los pasos de la explicacion", async () => {
    const { app } = await setup();
    const { cookie } = await register(app);
    const { exerciseId } = (await app.inject({ method: "POST", url: "/api/me/exercises", headers: { cookie } })).json();
    const res = await app.inject({
        method: "POST",
        url: `/api/exercises/${exerciseId}/answer`,
        headers: { cookie },
        payload: { answer: 999999 }
    });
    assert.equal(res.json().correct, false);
    assert.ok(res.json().steps.length > 0);
});

test("chat: guarda historial por usuario, lo reenvia al modelo y se puede borrar", async () => {
    const received: AxiomMessage[][] = [];
    const { app } = await setup({ received });
    const ana = await register(app, "ana@ejemplo.com");
    const beto = await register(app, "beto@ejemplo.com");

    await app.inject({ method: "POST", url: "/api/me/chat", headers: { cookie: ana.cookie }, payload: { message: "hola" } });
    const second = await app.inject({
        method: "POST",
        url: "/api/me/chat",
        headers: { cookie: ana.cookie },
        payload: { message: "otra" }
    });
    assert.equal(second.json().message, "respuesta 2");
    assert.deepEqual(received[1], [
        { role: "user", content: "hola" },
        { role: "assistant", content: "respuesta 1" },
        { role: "user", content: "otra" }
    ]);

    const deBeto = await app.inject({ method: "GET", url: "/api/me/messages", headers: { cookie: beto.cookie } });
    assert.equal(deBeto.json().messages.length, 0);

    const del = await app.inject({ method: "DELETE", url: "/api/me/messages", headers: { cookie: ana.cookie } });
    assert.equal(del.json().deleted, 4);
});

test("chat: 502 sin filtrar el error del proveedor", async () => {
    const app = await buildServer({
        db: new AxiomDatabase(":memory:"),
        scrypt: FAST_SCRYPT,
        createAxiom: () =>
            new AxiomAI({
                complete: async () => {
                    throw new Error("401 sk-secreta");
                }
            })
    });
    const { cookie } = await register(app);
    const res = await app.inject({ method: "POST", url: "/api/me/chat", headers: { cookie }, payload: { message: "hola" } });
    assert.equal(res.statusCode, 502);
    assert.doesNotMatch(res.body, /sk-secreta/);
});

test("roles: un estudiante no ve a otros (403); profesor y admin si", async () => {
    const { app, db } = await setup();
    const ana = await register(app, "ana@ejemplo.com");
    const studentId = db.getStudentIdForUser(ana.user.id);
    const url = `/api/students/${studentId}`;

    const comoEstudiante = await app.inject({ method: "GET", url, headers: { cookie: ana.cookie } });
    assert.equal(comoEstudiante.statusCode, 403);

    await makeUser(db, "profe@ejemplo.com", "TEACHER");
    const profe = await login(app, "profe@ejemplo.com");
    const comoProfe = await app.inject({ method: "GET", url, headers: { cookie: profe } });
    assert.equal(comoProfe.statusCode, 200);
    assert.equal(comoProfe.json().name, "Ana");

    const badId = await app.inject({ method: "GET", url: "/api/students/1 OR 1=1", headers: { cookie: profe } });
    assert.equal(badId.statusCode, 400);
});

test("roles: solo el admin cambia roles, no el suyo, y la sesion del afectado se cierra", async () => {
    const { app, db } = await setup();
    const ana = await register(app, "ana@ejemplo.com");
    await makeUser(db, "admin@ejemplo.com", "ADMIN");
    const admin = await login(app, "admin@ejemplo.com");
    const adminId = db.getUserByEmail("admin@ejemplo.com")?.id;

    const url = `/api/admin/users/${ana.user.id}/role`;
    const porEstudiante = await app.inject({
        method: "PATCH",
        url,
        headers: { cookie: ana.cookie },
        payload: { role: "ADMIN" }
    });
    assert.equal(porEstudiante.statusCode, 403);

    const rolInvalido = await app.inject({ method: "PATCH", url, headers: { cookie: admin }, payload: { role: "DIOS" } });
    assert.equal(rolInvalido.statusCode, 400);

    const propio = await app.inject({
        method: "PATCH",
        url: `/api/admin/users/${adminId}/role`,
        headers: { cookie: admin },
        payload: { role: "STUDENT" }
    });
    assert.equal(propio.statusCode, 400);

    const ok = await app.inject({ method: "PATCH", url, headers: { cookie: admin }, payload: { role: "TEACHER" } });
    assert.equal(ok.statusCode, 200);
    assert.equal(db.getUser(ana.user.id)?.role, "TEACHER");

    const sesionVieja = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: ana.cookie } });
    assert.equal(sesionVieja.statusCode, 401);
});

test("429 al superar el limite de intentos de login", async () => {
    const { app } = await setup({ authRateLimitPerMinute: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
        const res = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            payload: { email: "x@y.com", password: "incorrecta-123" }
        });
        codes.push(res.statusCode);
    }
    assert.deepEqual(codes, [401, 401, 401, 429]);
});

test("migracion: una base de datos antigua sin user_id se actualiza", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(tmpdir(), "axiom-"));
    const file = path.join(dir, "old.db");
    const old = new DatabaseSync(file);
    old.exec(
        "CREATE TABLE students (id TEXT PRIMARY KEY, name TEXT NOT NULL, profile_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    );
    old.close();
    try {
        const db = new AxiomDatabase(file);
        const { user, studentId } = db.createUser("a@b.com", "x", "STUDENT", "A");
        assert.equal(db.getStudentIdForUser(user.id), studentId);
        db.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

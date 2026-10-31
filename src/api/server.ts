import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import { AxiomAI, MAX_HISTORY_MESSAGES, MAX_MESSAGE_LENGTH } from "../ai/AxiomAI";
import { type AxiomDatabase, type StoredUser, type UserRole, USER_ROLES } from "../database/AxiomDatabase";
import { EducationEngine } from "../education/EducationEngine";
import {
    DEFAULT_SCRYPT,
    hashPassword,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    type ScryptParams,
    verifyPassword
} from "../security/passwords";

export interface ServerOptions {
    db: AxiomDatabase;
    /** Crea una instancia de AxiomAI (inyectable para tests). */
    createAxiom?: () => AxiomAI;
    /** Peticiones por minuto por IP (global). */
    rateLimitPerMinute?: number;
    /** Intentos de login/registro por minuto por IP. */
    authRateLimitPerMinute?: number;
    /** Coste de scrypt (solo se baja en tests). */
    scrypt?: ScryptParams;
    /** Duracion de la sesion en ms (por defecto 7 dias). */
    sessionTtlMs?: number;
    logger?: boolean;
}

declare module "fastify" {
    interface FastifyRequest {
        user?: StoredUser;
    }
}

export const SESSION_COOKIE = "axiom_session";
const DEFAULT_SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
const LOGIN_ERROR = "Correo o contraseña incorrectos.";

// Quita caracteres de control (salvo salto de linea y tabulador).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
function clean(text: string): string {
    return text.replace(CONTROL_CHARS, "").trim();
}

const idParams = {
    type: "object",
    required: ["id"],
    additionalProperties: false,
    properties: { id: { type: "string", pattern: UUID_PATTERN } }
} as const;

const emailSchema = { type: "string", minLength: 3, maxLength: 254, format: "email" } as const;
const passwordSchema = {
    type: "string",
    minLength: MIN_PASSWORD_LENGTH,
    maxLength: MAX_PASSWORD_LENGTH
} as const;

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
    const { db } = options;
    const education = new EducationEngine();
    const createAxiom = options.createAxiom ?? (() => new AxiomAI());
    const scryptParams = options.scrypt ?? DEFAULT_SCRYPT;
    const sessionTtl = options.sessionTtlMs ?? DEFAULT_SESSION_TTL;
    const authLimit = { max: options.authRateLimitPerMinute ?? 5, timeWindow: "1 minute" };

    // Hash de relleno: se verifica contra el cuando el correo no existe,
    // para que el tiempo de respuesta no revele que cuentas existen.
    const dummyHash = await hashPassword("contraseña-de-relleno", scryptParams);

    const app = Fastify({
        logger: options.logger ?? false,
        bodyLimit: 16 * 1024,
        ajv: { customOptions: { removeAdditional: false, coerceTypes: false } }
    });

    await app.register(cookie);
    await app.register(helmet, {
        contentSecurityPolicy: {
            directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] }
        }
    });
    await app.register(rateLimit, {
        max: options.rateLimitPerMinute ?? 100,
        timeWindow: "1 minute"
    });

    // ---- Sesion: identifica al usuario a partir de la cookie ---------------
    app.addHook("onRequest", async (request) => {
        const token = request.cookies[SESSION_COOKIE];
        if (token && token.length <= 128) {
            const user = db.getSessionUser(token);
            if (user) request.user = user;
        }
    });

    const requireUser = async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.user) return reply.code(401).send({ error: "Inicia sesión." });
    };
    const requireRole =
        (...roles: UserRole[]) =>
        async (request: FastifyRequest, reply: FastifyReply) => {
            if (!request.user) return reply.code(401).send({ error: "Inicia sesión." });
            if (!roles.includes(request.user.role)) {
                return reply.code(403).send({ error: "No tienes permiso." });
            }
        };

    const setSessionCookie = (reply: FastifyReply, userId: string) => {
        const token = db.createSession(userId, sessionTtl);
        reply.setCookie(SESSION_COOKIE, token, {
            httpOnly: true,
            secure: true,
            sameSite: "strict",
            path: "/",
            maxAge: Math.floor(sessionTtl / 1000)
        });
    };

    // ---- Errores: mensaje generico, detalle solo en el log -------------------
    app.setErrorHandler(
        (error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
            if (error.validation) return reply.code(400).send({ error: "Datos inválidos." });
            if (error.statusCode === 429) {
                return reply.code(429).send({ error: "Demasiadas peticiones. Espera un momento." });
            }
            if (error.statusCode === 413) {
                return reply.code(413).send({ error: "La petición es demasiado grande." });
            }
            if (error.statusCode === 415) {
                return reply.code(415).send({ error: "Formato no soportado." });
            }
            request.log.error(error);
            return reply.code(500).send({ error: "Error interno." });
        }
    );

    const myStudent = (request: FastifyRequest) => {
        const studentId = request.user && db.getStudentIdForUser(request.user.id);
        return studentId ? db.getStudent(studentId) : undefined;
    };

    const progressOf = (student: NonNullable<ReturnType<AxiomDatabase["getStudent"]>>) => {
        const p = student.profile;
        return {
            name: p.name,
            level: p.level,
            exercisesCompleted: p.exercisesCompleted,
            correctAnswers: p.correctAnswers,
            incorrectAnswers: p.incorrectAnswers,
            accuracy: p.getAccuracy(),
            contents: education.getContentProgressSummaries(p).map((c) => ({
                topic: c.topic,
                exercisesCompleted: c.exercisesCompleted,
                accuracy: c.accuracy
            }))
        };
    };

    // ---- Rutas publicas -----------------------------------------------------

    app.get("/health", async () => ({ status: "ok" }));

    // El registro publico solo crea estudiantes: el rol nunca lo elige el cliente.
    app.post<{ Body: { email: string; password: string; name: string } }>(
        "/api/auth/register",
        {
            config: { rateLimit: authLimit },
            schema: {
                body: {
                    type: "object",
                    required: ["email", "password", "name"],
                    additionalProperties: false,
                    properties: {
                        email: emailSchema,
                        password: passwordSchema,
                        name: { type: "string", minLength: 1, maxLength: 60 }
                    }
                }
            }
        },
        async (request, reply) => {
            const email = request.body.email.trim().toLowerCase();
            const name = clean(request.body.name);
            if (!name) return reply.code(400).send({ error: "Datos inválidos." });
            if (db.emailExists(email)) {
                return reply.code(409).send({ error: "No se pudo crear la cuenta." });
            }
            const passwordHash = await hashPassword(request.body.password, scryptParams);
            const { user } = db.createUser(email, passwordHash, "STUDENT", name);
            setSessionCookie(reply, user.id);
            return reply.code(201).send({ id: user.id, email: user.email, role: user.role, name });
        }
    );

    app.post<{ Body: { email: string; password: string } }>(
        "/api/auth/login",
        {
            config: { rateLimit: authLimit },
            schema: {
                body: {
                    type: "object",
                    required: ["email", "password"],
                    additionalProperties: false,
                    properties: {
                        email: { type: "string", minLength: 1, maxLength: 254 },
                        password: { type: "string", minLength: 1, maxLength: MAX_PASSWORD_LENGTH }
                    }
                }
            }
        },
        async (request, reply) => {
            const user = db.getUserByEmail(request.body.email.trim().toLowerCase());
            const ok = await verifyPassword(request.body.password, user?.passwordHash ?? dummyHash);
            if (!user || !ok) return reply.code(401).send({ error: LOGIN_ERROR });
            setSessionCookie(reply, user.id);
            return { id: user.id, email: user.email, role: user.role };
        }
    );

    app.post("/api/auth/logout", async (request, reply) => {
        const token = request.cookies[SESSION_COOKIE];
        if (token) db.deleteSession(token);
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        return reply.code(204).send();
    });

    // ---- Rutas del usuario con sesion (solo sus propios datos) ---------------

    app.get("/api/me", { preHandler: requireUser }, async (request) => {
        const user = request.user as StoredUser;
        const student = myStudent(request);
        return {
            id: user.id,
            email: user.email,
            role: user.role,
            progress: student ? progressOf(student) : null
        };
    });

    // El servidor elige el contenido y guarda la respuesta correcta:
    // el cliente nunca la recibe.
    app.post("/api/me/exercises", { preHandler: requireUser }, async (request, reply) => {
        const student = myStudent(request);
        if (!student) return reply.code(404).send({ error: "No encontrado." });
        const contentId = education.selectContent(student.profile);
        const difficulty = education.determineDifficulty(student.profile, contentId);
        const exercise = education.createMathExercise(difficulty, contentId);
        const exerciseId = db.createExercise(student.id, exercise);
        return reply.code(201).send({
            exerciseId,
            question: exercise.question,
            topic: exercise.topic,
            difficulty: exercise.difficulty
        });
    });

    app.post<{ Params: { id: string }; Body: { answer: number } }>(
        "/api/exercises/:id/answer",
        {
            preHandler: requireUser,
            schema: {
                params: idParams,
                body: {
                    type: "object",
                    required: ["answer"],
                    additionalProperties: false,
                    properties: { answer: { type: "number", minimum: -1e9, maximum: 1e9 } }
                }
            }
        },
        async (request, reply) => {
            const student = myStudent(request);
            const stored = db.getExercise(request.params.id);
            // Un ejercicio ajeno se trata igual que uno inexistente.
            if (!student || !stored || stored.studentId !== student.id) {
                return reply.code(404).send({ error: "No encontrado." });
            }
            if (!db.markExerciseAnswered(stored.id)) {
                return reply.code(409).send({ error: "Este ejercicio ya fue respondido." });
            }
            const { exercise } = stored;
            const result = education.evaluateAnswer(exercise, request.body.answer);
            student.profile.registerAnswer(result.correct, exercise.difficulty, exercise.contentId);
            db.saveStudentProfile(student.id, student.profile);
            return {
                correct: result.correct,
                message: result.message,
                steps: result.correct ? [] : education.createStepByStepExplanation(exercise).steps,
                level: student.profile.level
            };
        }
    );

    app.post<{ Body: { message: string } }>(
        "/api/me/chat",
        {
            preHandler: requireUser,
            config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
            schema: {
                body: {
                    type: "object",
                    required: ["message"],
                    additionalProperties: false,
                    properties: {
                        message: { type: "string", minLength: 1, maxLength: MAX_MESSAGE_LENGTH }
                    }
                }
            }
        },
        async (request, reply) => {
            const student = myStudent(request);
            if (!student) return reply.code(404).send({ error: "No encontrado." });
            const message = clean(request.body.message);
            if (!message) return reply.code(400).send({ error: "Datos inválidos." });

            const axiom = createAxiom();
            if (!axiom.isConnected()) {
                return reply.code(503).send({ error: "El tutor IA no está conectado." });
            }
            axiom.loadHistory(db.getRecentMessages(student.id, MAX_HISTORY_MESSAGES));

            let response;
            try {
                response = await axiom.respond(message);
            } catch (error) {
                request.log.error(error);
                return reply.code(502).send({ error: "No se pudo obtener respuesta del tutor." });
            }
            db.addMessage(student.id, { role: "user", content: message });
            db.addMessage(student.id, { role: "assistant", content: response.message });
            return { message: response.message, timestamp: response.timestamp };
        }
    );

    app.get("/api/me/messages", { preHandler: requireUser }, async (request, reply) => {
        const student = myStudent(request);
        if (!student) return reply.code(404).send({ error: "No encontrado." });
        return { messages: db.getRecentMessages(student.id, 100) };
    });

    // El estudiante puede borrar su historial con el tutor.
    app.delete("/api/me/messages", { preHandler: requireUser }, async (request, reply) => {
        const student = myStudent(request);
        if (!student) return reply.code(404).send({ error: "No encontrado." });
        return { deleted: db.deleteMessages(student.id) };
    });

    // ---- Profesores y administradores ----------------------------------------

    app.get<{ Params: { id: string } }>(
        "/api/students/:id",
        { preHandler: requireRole("TEACHER", "ADMIN"), schema: { params: idParams } },
        async (request, reply) => {
            const student = db.getStudent(request.params.id);
            if (!student) return reply.code(404).send({ error: "No encontrado." });
            return { id: student.id, ...progressOf(student) };
        }
    );

    app.patch<{ Params: { id: string }; Body: { role: UserRole } }>(
        "/api/admin/users/:id/role",
        {
            preHandler: requireRole("ADMIN"),
            schema: {
                params: idParams,
                body: {
                    type: "object",
                    required: ["role"],
                    additionalProperties: false,
                    properties: { role: { type: "string", enum: [...USER_ROLES] } }
                }
            }
        },
        async (request, reply) => {
            if (request.params.id === request.user?.id) {
                return reply.code(400).send({ error: "No puedes cambiar tu propio rol." });
            }
            if (!db.setUserRole(request.params.id, request.body.role)) {
                return reply.code(404).send({ error: "No encontrado." });
            }
            // Cierra sus sesiones para que el nuevo rol se aplique de inmediato.
            db.deleteUserSessions(request.params.id);
            return { id: request.params.id, role: request.body.role };
        }
    );

    return app;
}

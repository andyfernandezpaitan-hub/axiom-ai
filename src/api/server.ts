import { timingSafeEqual, createHash } from "node:crypto";

import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import { AxiomAI, MAX_HISTORY_MESSAGES, MAX_MESSAGE_LENGTH } from "../ai/AxiomAI";
import type { AxiomDatabase } from "../database/AxiomDatabase";
import { EducationEngine } from "../education/EducationEngine";

export interface ServerOptions {
    db: AxiomDatabase;
    /** Token que deben enviar los clientes en `Authorization: Bearer <token>`. */
    apiToken: string;
    /** Crea una instancia de AxiomAI (inyectable para tests). */
    createAxiom?: () => AxiomAI;
    /** Peticiones por minuto por IP (global). */
    rateLimitPerMinute?: number;
    logger?: boolean;
}

const MIN_TOKEN_LENGTH = 32;
const UUID_PATTERN =
    "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

// Quita caracteres de control (salvo salto de linea y tabulador).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
function clean(text: string): string {
    return text.replace(CONTROL_CHARS, "").trim();
}

function tokensMatch(presented: string, expected: string): boolean {
    // Se comparan los hashes para que la longitud no filtre informacion.
    const a = createHash("sha256").update(presented).digest();
    const b = createHash("sha256").update(expected).digest();
    return timingSafeEqual(a, b);
}

const idParams = {
    type: "object",
    required: ["id"],
    additionalProperties: false,
    properties: { id: { type: "string", pattern: UUID_PATTERN } }
} as const;

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
    if (!options.apiToken || options.apiToken.length < MIN_TOKEN_LENGTH) {
        throw new Error(`AXIOM_API_TOKEN debe tener al menos ${MIN_TOKEN_LENGTH} caracteres.`);
    }

    const { db } = options;
    const education = new EducationEngine();
    const createAxiom = options.createAxiom ?? (() => new AxiomAI());

    const app = Fastify({
        logger: options.logger ?? false,
        bodyLimit: 16 * 1024,
        ajv: { customOptions: { removeAdditional: false, coerceTypes: false } }
    });

    await app.register(helmet, {
        contentSecurityPolicy: {
            directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] }
        }
    });
    await app.register(rateLimit, {
        max: options.rateLimitPerMinute ?? 100,
        timeWindow: "1 minute"
    });

    // ---- Autenticacion (todas las rutas excepto /health) --------------------
    app.addHook("onRequest", async (request, reply) => {
        if (request.url === "/health") return;
        const header = request.headers.authorization ?? "";
        const [scheme, token] = header.split(" ");
        if (scheme !== "Bearer" || !token || !tokensMatch(token, options.apiToken)) {
            return reply.code(401).send({ error: "No autorizado." });
        }
    });

    // ---- Errores: mensaje generico, detalle solo en el log -------------------
    app.setErrorHandler((error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
        if (error.validation) {
            return reply.code(400).send({ error: "Datos inválidos." });
        }
        if (error.statusCode === 429) {
            return reply.code(429).send({ error: "Demasiadas peticiones. Espera un momento." });
        }
        if (error.statusCode === 413) {
            return reply.code(413).send({ error: "La petición es demasiado grande." });
        }
        request.log.error(error);
        return reply.code(500).send({ error: "Error interno." });
    });

    const getStudentOr404 = (request: FastifyRequest<{ Params: { id: string } }>) =>
        db.getStudent(request.params.id);

    // ---- Rutas ---------------------------------------------------------------

    app.get("/health", async () => ({ status: "ok" }));

    app.post<{ Body: { name: string } }>(
        "/api/students",
        {
            schema: {
                body: {
                    type: "object",
                    required: ["name"],
                    additionalProperties: false,
                    properties: { name: { type: "string", minLength: 1, maxLength: 60 } }
                }
            }
        },
        async (request, reply) => {
            const name = clean(request.body.name);
            if (!name) return reply.code(400).send({ error: "Datos inválidos." });
            const { id, profile } = db.createStudent(name);
            return reply.code(201).send({ id, name: profile.name, level: profile.level });
        }
    );

    app.get<{ Params: { id: string } }>(
        "/api/students/:id",
        { schema: { params: idParams } },
        async (request, reply) => {
            const student = getStudentOr404(request);
            if (!student) return reply.code(404).send({ error: "No encontrado." });
            const p = student.profile;
            return {
                id: student.id,
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
        }
    );

    // El servidor elige el contenido y guarda la respuesta correcta:
    // el cliente nunca la recibe.
    app.post<{ Params: { id: string } }>(
        "/api/students/:id/exercises",
        { schema: { params: idParams } },
        async (request, reply) => {
            const student = getStudentOr404(request);
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
        }
    );

    app.post<{ Params: { id: string }; Body: { answer: number } }>(
        "/api/exercises/:id/answer",
        {
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
            const stored = db.getExercise(request.params.id);
            if (!stored) return reply.code(404).send({ error: "No encontrado." });
            if (!db.markExerciseAnswered(stored.id)) {
                return reply.code(409).send({ error: "Este ejercicio ya fue respondido." });
            }
            const student = db.getStudent(stored.studentId);
            if (!student) return reply.code(404).send({ error: "No encontrado." });

            const { exercise } = stored;
            const result = education.evaluateAnswer(exercise, request.body.answer);
            student.profile.registerAnswer(result.correct, exercise.difficulty, exercise.contentId);
            db.saveStudentProfile(student.id, student.profile);

            return {
                correct: result.correct,
                message: result.message,
                steps: result.correct
                    ? []
                    : education.createStepByStepExplanation(exercise).steps,
                level: student.profile.level
            };
        }
    );

    app.post<{ Params: { id: string }; Body: { message: string } }>(
        "/api/students/:id/chat",
        {
            config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
            schema: {
                params: idParams,
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
            const student = getStudentOr404(request);
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

    app.get<{ Params: { id: string } }>(
        "/api/students/:id/messages",
        { schema: { params: idParams } },
        async (request, reply) => {
            const student = getStudentOr404(request);
            if (!student) return reply.code(404).send({ error: "No encontrado." });
            return { messages: db.getRecentMessages(student.id, 100) };
        }
    );

    // El estudiante puede borrar su historial con el tutor.
    app.delete<{ Params: { id: string } }>(
        "/api/students/:id/messages",
        { schema: { params: idParams } },
        async (request, reply) => {
            const student = getStudentOr404(request);
            if (!student) return reply.code(404).send({ error: "No encontrado." });
            return { deleted: db.deleteMessages(student.id) };
        }
    );

    return app;
}

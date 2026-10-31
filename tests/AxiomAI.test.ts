import assert from "node:assert/strict";
import test from "node:test";

import {
    AxiomAI,
    MAX_HISTORY_MESSAGES,
    MAX_MESSAGE_LENGTH,
    type AxiomMessage,
    type AxiomModelClient
} from "../src/ai/AxiomAI";

test("responde usando el modelo inyectado", async () => {
    const fakeClient: AxiomModelClient = {
        complete: async (messages: AxiomMessage[]) =>
            `Respuesta simulada a: ${messages[messages.length - 1].content}`
    };
    const axiom = new AxiomAI(fakeClient);

    const response = await axiom.respond("Hola");

    assert.equal(response.message, "Respuesta simulada a: Hola");
    assert.ok(response.timestamp);
    assert.equal(axiom.isConnected(), true);
});

test("lanza error explicito si no hay modelo conectado (nunca finge una respuesta)", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
        const axiom = new AxiomAI();

        assert.equal(axiom.isConnected(), false);
        await assert.rejects(
            () => axiom.respond("Hola"),
            /no tiene un modelo conectado/
        );
    } finally {
        if (originalKey !== undefined) {
            process.env.ANTHROPIC_API_KEY = originalKey;
        }
    }
});

test("rechaza mensajes vacios sin llegar a llamar al modelo", async () => {
    const axiom = new AxiomAI({
        complete: async () => "no deberia llegar aqui"
    });

    await assert.rejects(() => axiom.respond("   "), /no puede estar vacío/);
});

test("rechaza mensajes demasiado largos sin llamar al modelo", async () => {
    let called = false;
    const axiom = new AxiomAI({
        complete: async () => {
            called = true;
            return "x";
        }
    });

    await assert.rejects(
        () => axiom.respond("a".repeat(MAX_MESSAGE_LENGTH + 1)),
        /demasiado largo/
    );
    assert.equal(called, false);
});

test("oculta el error interno del proveedor y no guarda historial", async () => {
    const axiom = new AxiomAI({
        complete: async () => {
            throw new Error("401 invalid x-api-key sk-secreta");
        }
    });

    await assert.rejects(
        () => axiom.respond("Hola"),
        (error: Error) => {
            assert.match(error.message, /No se pudo obtener respuesta/);
            assert.doesNotMatch(error.message, /sk-secreta/);
            return true;
        }
    );
    assert.equal(axiom.getHistory().length, 0);
});

test("lanza error si el modelo devuelve una respuesta vacia", async () => {
    const axiom = new AxiomAI({ complete: async () => "   " });

    await assert.rejects(() => axiom.respond("Hola"), /respuesta vacía/);
    assert.equal(axiom.getHistory().length, 0);
});

test("envia el historial de la conversacion al modelo", async () => {
    const received: AxiomMessage[][] = [];
    const axiom = new AxiomAI({
        complete: async (messages) => {
            received.push(messages);
            return `r${received.length}`;
        }
    });

    await axiom.respond("primero");
    await axiom.respond("segundo");

    assert.deepEqual(received[1], [
        { role: "user", content: "primero" },
        { role: "assistant", content: "r1" },
        { role: "user", content: "segundo" }
    ]);
    assert.equal(axiom.getHistory().length, 4);

    axiom.resetHistory();
    assert.equal(axiom.getHistory().length, 0);
});

test("limita el historial y siempre empieza con un mensaje del usuario", async () => {
    const axiom = new AxiomAI({ complete: async () => "ok" });

    for (let i = 0; i < MAX_HISTORY_MESSAGES; i++) {
        await axiom.respond(`m${i}`);
    }

    const history = axiom.getHistory();
    assert.equal(history.length, MAX_HISTORY_MESSAGES);
    assert.equal(history[0].role, "user");
});

test("OpenJarvisModelClient llama a /v1/chat/completions con el historial", async () => {
    const { createServer } = await import("node:http");
    const { OpenJarvisModelClient } = await import("../src/ai/AxiomAI");
    let receivedBody: any;
    let receivedPath = "";

    const server = createServer((req, res) => {
        receivedPath = req.url ?? "";
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
            receivedBody = JSON.parse(raw);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ choices: [{ message: { content: "hola desde jarvis" } }] }));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    try {
        const axiom = new AxiomAI(new OpenJarvisModelClient(`http://127.0.0.1:${port}`, "qwen3.5:2b"));
        const response = await axiom.respond("hola");

        assert.equal(response.message, "hola desde jarvis");
        assert.equal(receivedPath, "/v1/chat/completions");
        assert.equal(receivedBody.model, "qwen3.5:2b");
        assert.equal(receivedBody.messages[0].role, "system");
        assert.deepEqual(receivedBody.messages[1], { role: "user", content: "hola" });
    } finally {
        server.close();
    }
});

test("OpenJarvisModelClient rechaza URLs que no son http(s)", async () => {
    const { OpenJarvisModelClient } = await import("../src/ai/AxiomAI");
    assert.throws(() => new OpenJarvisModelClient("file:///etc/passwd"), /HTTPS/);
    assert.throws(() => new OpenJarvisModelClient("no es una url"), /no es válida/);
});

test("OpenJarvisModelClient exige HTTPS para servidores remotos", async () => {
    const { OpenJarvisModelClient } = await import("../src/ai/AxiomAI");
    assert.throws(() => new OpenJarvisModelClient("http://ejemplo.com"), /HTTPS/);
    assert.doesNotThrow(() => new OpenJarvisModelClient("https://ejemplo.com"));
    assert.doesNotThrow(() => new OpenJarvisModelClient("http://localhost:8000"));
});
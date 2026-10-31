import { strict as assert } from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { StudentProfile } from "../src/education/StudentProfile";
import { MemoryManager } from "../src/memory/MemoryManager";

test("guarda y recupera el historial de ejercicios", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "axiom-ai-"));
    const filePath = path.join(directory, "student-memory.json");

    try {
        const manager = new MemoryManager(filePath);
        const student = new StudentProfile("Ana");

        student.registerAnswer(true, "facil", "matematicas-sumas");
        student.registerAnswer(false, "medio", "matematicas-sumas");
        await manager.saveStudent(student);

        const loaded = await manager.loadStudent("Ana");

        assert.equal(loaded.exercisesCompleted, 2);
        assert.equal(loaded.correctAnswers, 1);
        assert.equal(loaded.incorrectAnswers, 1);
        assert.deepEqual(loaded.getContentProgress("matematicas-sumas"), {
            exercisesCompleted: 2,
            correctAnswers: 1,
            incorrectAnswers: 1
        });
        assert.deepEqual(
            loaded.exerciseHistory.map((attempt) => ({
                difficulty: attempt.difficulty,
                correct: attempt.correct,
                contentId: attempt.contentId
            })),
            [
                {
                    difficulty: "facil",
                    correct: true,
                    contentId: "matematicas-sumas"
                },
                {
                    difficulty: "medio",
                    correct: false,
                    contentId: "matematicas-sumas"
                }
            ]
        );
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("carga perfiles anteriores que no tienen historial", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "axiom-ai-"));
    const filePath = path.join(directory, "student-memory.json");

    try {
        await fs.writeFile(
            filePath,
            JSON.stringify({
                name: "Ana",
                level: "intermedio",
                exercisesCompleted: 5,
                correctAnswers: 5,
                incorrectAnswers: 0
            }),
            "utf-8"
        );

        const loaded = await new MemoryManager(filePath).loadStudent("Ana");

        assert.equal(loaded.exercisesCompleted, 5);
        assert.equal(loaded.exerciseHistory.length, 0);
        assert.deepEqual(loaded.contentProgress, {});
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("no persiste datos cuando la memoria no esta autorizada", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "axiom-ai-"));
    const filePath = path.join(directory, "student-memory.json");

    try {
        const manager = new MemoryManager(filePath, false);
        const student = new StudentProfile("Ana");

        student.registerAnswer(true, "facil", "matematicas-sumas");
        await manager.saveStudent(student);

        const loaded = await manager.loadStudent("Ana");

        assert.equal(manager.isEnabled(), false);
        assert.equal(loaded.exercisesCompleted, 0);
        await assert.rejects(fs.access(filePath));
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

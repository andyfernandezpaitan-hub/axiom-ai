import { strict as assert } from "node:assert";
import { test } from "node:test";

import { SessionTracker } from "../src/education/SessionTracker";

test("resume varios ejercicios de una misma sesion", () => {
    const session = new SessionTracker();

    session.registerExercise(
        {
            question: "¿Cuánto es 3 + 2?",
            answer: 5,
            difficulty: "facil",
            contentId: "matematicas-sumas",
            topic: "sumas",
            learningObjective: "Resolver sumas.",
            operation: "suma",
            operands: [3, 2]
        },
        { correct: true, message: "Correcto" }
    );
    session.registerExercise(
        {
            question: "¿Cuánto es 8 - 3?",
            answer: 5,
            difficulty: "facil",
            contentId: "matematicas-restas",
            topic: "restas",
            learningObjective: "Resolver restas.",
            operation: "resta",
            operands: [8, 3]
        },
        { correct: false, message: "Incorrecto" }
    );

    assert.deepEqual(session.getOverview(), {
        exercisesCompleted: 2,
        correctAnswers: 1,
        incorrectAnswers: 1,
        accuracy: 50,
        topics: ["sumas", "restas"]
    });
});

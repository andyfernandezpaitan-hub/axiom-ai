import { strict as assert } from "node:assert";
import { test } from "node:test";

import { EducationEngine } from "../src/education/EducationEngine";
import { StudentProfile } from "../src/education/StudentProfile";

test("preserva la dificultad facil durante los tres primeros ejercicios", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    student.registerAnswer(true, "facil");
    student.registerAnswer(true, "facil");

    assert.equal(education.determineDifficulty(student), "facil");
});

test("adapta la dificultad usando el rendimiento reciente", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    for (let attempt = 0; attempt < 5; attempt++) {
        student.registerAnswer(true, "medio");
    }

    student.registerAnswer(false, "dificil");
    student.registerAnswer(false, "dificil");
    student.registerAnswer(false, "dificil");

    assert.equal(student.getAccuracy(), 63);
    assert.equal(student.getRecentAccuracy(), 40);
    assert.equal(education.determineDifficulty(student), "facil");
});

test("mantiene el comportamiento anterior para perfiles sin historial", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    student.exercisesCompleted = 5;
    student.correctAnswers = 5;

    assert.equal(student.getRecentAccuracy(), undefined);
    assert.equal(education.determineDifficulty(student), "dificil");
});

test("ofrece una guia de refuerzo tras varios errores recientes", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    student.registerAnswer(false, "facil");
    student.registerAnswer(false, "facil");
    student.registerAnswer(false, "facil");

    const feedback = education.createAdaptiveFeedback(
        { correct: false, message: "Incorrecto" },
        student
    );

    assert.match(feedback.message, /paso a paso/);
});

test("reconoce un rendimiento reciente sobresaliente", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    for (let attempt = 0; attempt < 5; attempt++) {
        student.registerAnswer(true, "medio");
    }

    const feedback = education.createAdaptiveFeedback(
        { correct: true, message: "Correcto" },
        student
    );

    assert.match(feedback.message, /Excelente progreso/);
});

test("adapta la dificultad segun el rendimiento del contenido actual", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    for (let attempt = 0; attempt < 5; attempt++) {
        student.registerAnswer(false, "facil", "matematicas-restas");
    }

    for (let attempt = 0; attempt < 3; attempt++) {
        student.registerAnswer(true, "medio", "matematicas-sumas");
    }

    assert.equal(
        student.getRecentAccuracyForContent("matematicas-sumas"),
        100
    );
    assert.equal(
        education.determineDifficulty(student, "matematicas-sumas"),
        "dificil"
    );
});

test("avanza a restas despues de dominar sumas", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    for (let attempt = 0; attempt < 3; attempt++) {
        student.registerAnswer(true, "medio", "matematicas-sumas");
    }

    assert.equal(education.selectContent(student), "matematicas-restas");
    assert.equal(
        education.determineDifficulty(student, "matematicas-restas"),
        "facil"
    );
});

test("avanza a multiplicaciones despues de dominar restas", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    for (let attempt = 0; attempt < 3; attempt++) {
        student.registerAnswer(true, "medio", "matematicas-restas");
    }

    assert.equal(
        education.selectContent(student),
        "matematicas-multiplicaciones"
    );
    assert.equal(
        education.determineDifficulty(
            student,
            "matematicas-multiplicaciones"
        ),
        "facil"
    );
});

test("avanza a divisiones despues de dominar multiplicaciones", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    for (let attempt = 0; attempt < 3; attempt++) {
        student.registerAnswer(
            true,
            "medio",
            "matematicas-multiplicaciones"
        );
    }

    assert.equal(education.selectContent(student), "matematicas-divisiones");
    assert.equal(
        education.determineDifficulty(student, "matematicas-divisiones"),
        "facil"
    );
});

test("mantiene el contenido cuando hay errores recientes repetidos", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    student.registerAnswer(false, "facil", "matematicas-sumas");
    student.registerAnswer(false, "facil", "matematicas-sumas");
    student.registerAnswer(true, "facil", "matematicas-sumas");

    const guidance = education.createReinforcementGuidance(
        student,
        "matematicas-sumas"
    );

    assert.equal(
        education.needsReinforcement(student, "matematicas-sumas"),
        true
    );
    assert.equal(education.selectContent(student), "matematicas-sumas");
    assert.match(guidance.message ?? "", /Mantendremos la practica/);
});

test("finaliza el refuerzo cuando el rendimiento reciente se recupera", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    student.registerAnswer(false, "facil", "matematicas-sumas");
    student.registerAnswer(false, "facil", "matematicas-sumas");
    student.registerAnswer(true, "facil", "matematicas-sumas");
    student.registerAnswer(true, "facil", "matematicas-sumas");
    student.registerAnswer(true, "facil", "matematicas-sumas");
    student.registerAnswer(true, "facil", "matematicas-sumas");

    assert.equal(
        education.needsReinforcement(student, "matematicas-sumas"),
        false
    );
});

test("acumula el progreso de manera independiente por contenido", () => {
    const student = new StudentProfile("Ana");

    student.registerAnswer(true, "facil", "matematicas-sumas");
    student.registerAnswer(false, "facil", "matematicas-sumas");
    student.registerAnswer(true, "facil", "matematicas-restas");

    assert.deepEqual(student.getContentProgress("matematicas-sumas"), {
        exercisesCompleted: 2,
        correctAnswers: 1,
        incorrectAnswers: 1
    });
    assert.equal(student.getContentAccuracy("matematicas-sumas"), 50);
    assert.equal(student.getContentAccuracy("matematicas-restas"), 100);
});

test("identifica cuando se alcanza el objetivo de un contenido", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    for (let attempt = 0; attempt < 3; attempt++) {
        student.registerAnswer(true, "medio", "matematicas-sumas");
    }

    const status = education.getLearningObjectiveStatus(
        student,
        "matematicas-sumas"
    );

    assert.equal(status.objective, "Resolver sumas de numeros naturales con precision.");
    assert.equal(status.mastered, true);
    assert.equal(education.isContentMastered(student, "matematicas-sumas"), true);
});

test("mantiene un objetivo en progreso hasta alcanzar sus criterios", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    student.registerAnswer(true, "facil", "matematicas-restas");
    student.registerAnswer(false, "facil", "matematicas-restas");

    const status = education.getLearningObjectiveStatus(
        student,
        "matematicas-restas"
    );

    assert.equal(status.mastered, false);
    assert.equal(status.minimumExercises, 3);
    assert.equal(status.minimumAccuracy, 85);
});

test("resume una sesion con objetivo dominado y siguiente contenido", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    for (let attempt = 0; attempt < 3; attempt++) {
        student.registerAnswer(true, "medio", "matematicas-sumas");
    }

    const summary = education.createSessionSummary(
        {
            question: "¿Cuánto es 4 + 3?",
            answer: 7,
            difficulty: "medio",
            contentId: "matematicas-sumas",
            topic: "sumas",
            learningObjective: "Resolver sumas.",
            operation: "suma",
            operands: [4, 3]
        },
        { correct: true, message: "Correcto" },
        student
    );

    assert.equal(summary.objectiveStatus.mastered, true);
    assert.match(summary.recommendation, /restas/);
});

test("resume una sesion de refuerzo cuando hay errores recientes", () => {
    const student = new StudentProfile("Ana");
    const education = new EducationEngine();

    student.registerAnswer(false, "facil", "matematicas-restas");
    student.registerAnswer(false, "facil", "matematicas-restas");
    student.registerAnswer(true, "facil", "matematicas-restas");

    const summary = education.createSessionSummary(
        {
            question: "¿Cuánto es 9 - 4?",
            answer: 5,
            difficulty: "facil",
            contentId: "matematicas-restas",
            topic: "restas",
            learningObjective: "Resolver restas.",
            operation: "resta",
            operands: [9, 4]
        },
        { correct: true, message: "Correcto" },
        student
    );

    assert.match(summary.recommendation, /Mantendremos la practica/);
});

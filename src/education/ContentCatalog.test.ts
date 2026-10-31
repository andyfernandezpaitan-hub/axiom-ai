import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
    ContentCatalog,
    DIVISION_CONTENT_ID,
    MULTIPLICATION_CONTENT_ID,
    PROGRAMMING_MODULO_CONTENT_ID,
    SUBTRACTION_CONTENT_ID
} from "../src/education/ContentCatalog";
import { EducationEngine } from "../src/education/EducationEngine";

test("expone contenido matematico validado para sumas", () => {
    const catalog = new ContentCatalog();
    const content = catalog.getById("matematicas-sumas");

    assert.ok(content);
    assert.equal(content.subject, "matematicas");
    assert.equal(content.topic, "sumas");
    assert.deepEqual(content.supportedDifficulties, [
        "facil",
        "medio",
        "dificil"
    ]);
    assert.deepEqual(content.masteryCriteria, {
        minimumExercises: 3,
        minimumAccuracy: 85
    });
});

test("incluye restas como contenido validado", () => {
    const content = new ContentCatalog().getById(SUBTRACTION_CONTENT_ID);

    assert.ok(content);
    assert.equal(content.topic, "restas");
    assert.match(content.learningObjective, /restas/);
});

test("incluye multiplicaciones como contenido validado", () => {
    const content = new ContentCatalog().getById(MULTIPLICATION_CONTENT_ID);

    assert.ok(content);
    assert.equal(content.topic, "multiplicaciones");
});

test("incluye divisiones exactas como contenido validado", () => {
    const content = new ContentCatalog().getById(DIVISION_CONTENT_ID);

    assert.ok(content);
    assert.equal(content.topic, "divisiones");
    assert.match(content.learningObjective, /exactas/);
});

test("expone los contenidos disponibles para una eleccion manual", () => {
    const contents = new EducationEngine().getAvailableContents();

    assert.deepEqual(
        contents.map((content) => content.id),
        [
            "matematicas-sumas",
            "matematicas-restas",
            "matematicas-multiplicaciones",
            "matematicas-divisiones",
            "programacion-modulo"
        ]
    );
});

test("incluye el operador modulo como contenido validado de programacion", () => {
    const content = new ContentCatalog().getById(PROGRAMMING_MODULO_CONTENT_ID);

    assert.ok(content);
    assert.equal(content.subject, "programacion");
    assert.match(content.learningObjective, /modulo/);
});

test("genera ejercicios de modulo con resto correcto", () => {
    const exercise = new EducationEngine().createMathExercise(
        "dificil",
        PROGRAMMING_MODULO_CONTENT_ID
    );

    assert.equal(exercise.operation, "modulo");
    assert.match(exercise.question, /%/);
    assert.equal(exercise.answer, exercise.operands[0] % exercise.operands[1]);
});

test("crea una explicacion paso a paso para el operador modulo", () => {
    const explanation = new EducationEngine().createStepByStepExplanation({
        question: "¿Cuánto es 10 % 3?",
        answer: 1,
        difficulty: "facil",
        contentId: PROGRAMMING_MODULO_CONTENT_ID,
        topic: "operador modulo (%)",
        learningObjective: "Calcular el resto de una division entera.",
        operation: "modulo",
        operands: [10, 3]
    });

    assert.equal(explanation.title, "Como resolver el operador modulo");
    assert.match(explanation.steps.at(-1) ?? "", /El resto \(modulo\) es/);
});

test("asocia cada ejercicio al contenido validado que lo genero", () => {
    const exercise = new EducationEngine().createMathExercise("medio");

    assert.equal(exercise.contentId, "matematicas-sumas");
    assert.equal(exercise.topic, "sumas");
    assert.match(exercise.learningObjective, /sumas/);
});

test("genera restas sin resultados negativos", () => {
    const exercise = new EducationEngine().createMathExercise(
        "dificil",
        SUBTRACTION_CONTENT_ID
    );

    assert.equal(exercise.topic, "restas");
    assert.match(exercise.question, /-/);
    assert.ok(exercise.answer >= 0);
});

test("genera multiplicaciones vinculadas a su contenido", () => {
    const exercise = new EducationEngine().createMathExercise(
        "facil",
        MULTIPLICATION_CONTENT_ID
    );

    assert.equal(exercise.operation, "multiplicacion");
    assert.match(exercise.question, /×/);
    assert.equal(exercise.answer, exercise.operands[0] * exercise.operands[1]);
});

test("genera divisiones exactas y con divisor distinto de cero", () => {
    const exercise = new EducationEngine().createMathExercise(
        "dificil",
        DIVISION_CONTENT_ID
    );

    assert.equal(exercise.operation, "division");
    assert.match(exercise.question, /÷/);
    assert.ok(exercise.operands[1] > 0);
    assert.equal(exercise.operands[0] % exercise.operands[1], 0);
    assert.equal(exercise.answer, exercise.operands[0] / exercise.operands[1]);
});

test("crea una explicacion para una suma", () => {
    const education = new EducationEngine();
    const explanation = education.createStepByStepExplanation({
        question: "¿Cuánto es 8 + 7?",
        answer: 15,
        difficulty: "facil",
        contentId: "matematicas-sumas",
        topic: "sumas",
        learningObjective: "Resolver sumas.",
        operation: "suma",
        operands: [8, 7]
    });

    assert.equal(explanation.title, "Como resolver la suma");
    assert.deepEqual(explanation.steps, [
        "Comienza con 8.",
        "Añade 7.",
        "El resultado es 15."
    ]);
});

test("crea una explicacion para una resta", () => {
    const education = new EducationEngine();
    const explanation = education.createStepByStepExplanation({
        question: "¿Cuánto es 12 - 5?",
        answer: 7,
        difficulty: "facil",
        contentId: "matematicas-restas",
        topic: "restas",
        learningObjective: "Resolver restas.",
        operation: "resta",
        operands: [12, 5]
    });

    assert.equal(explanation.title, "Como resolver la resta");
    assert.equal(explanation.steps.at(-1), "El resultado es 7.");
});

test("crea una explicacion para una multiplicacion", () => {
    const explanation = new EducationEngine().createStepByStepExplanation({
        question: "¿Cuánto es 4 × 3?",
        answer: 12,
        difficulty: "facil",
        contentId: MULTIPLICATION_CONTENT_ID,
        topic: "multiplicaciones",
        learningObjective: "Resolver multiplicaciones.",
        operation: "multiplicacion",
        operands: [4, 3]
    });

    assert.equal(explanation.title, "Como resolver la multiplicacion");
    assert.match(
        explanation.steps[1] ?? "",
        /4 un total de 3 veces/
    );
});

test("crea una explicacion para una division", () => {
    const explanation = new EducationEngine().createStepByStepExplanation({
        question: "¿Cuánto es 12 ÷ 3?",
        answer: 4,
        difficulty: "facil",
        contentId: DIVISION_CONTENT_ID,
        topic: "divisiones",
        learningObjective: "Resolver divisiones exactas.",
        operation: "division",
        operands: [12, 3]
    });

    assert.equal(explanation.title, "Como resolver la division");
    assert.match(explanation.steps[1] ?? "", /3 multiplicado por 4/);
});

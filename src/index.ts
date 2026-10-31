import { createInterface, type Interface } from "readline/promises";
import { stdin as input, stdout as output } from "process";

import { AxiomAI } from "./ai/AxiomAI";
import { EducationEngine } from "./education/EducationEngine";
import { SessionTracker } from "./education/SessionTracker";
import { MemoryManager } from "./memory/MemoryManager";
import { StudentProfile } from "./education/StudentProfile";

const EXIT_WORDS = ["salir", "exit", "fin"];

/** Carga .env si existe (Node 20.12+). Sin .env, AXIOM funciona sin modelo. */
function loadEnv(): void {
    try {
        process.loadEnvFile(".env");
    } catch {
        // No hay .env: se continua sin variables extra.
    }
}

/**
 * Conversacion libre con el tutor. Cada mensaje fallido se informa sin
 * cortar la sesion; los detalles internos del error nunca se muestran.
 */
async function tutorChat(
    rl: Interface,
    axiom: AxiomAI,
    initialMessage?: string
): Promise<void> {
    axiom.resetHistory();

    console.log("TUTOR AXIOM");
    console.log(`Escribe tu pregunta. Para terminar escribe: ${EXIT_WORDS.join(" / ")}`);
    console.log("---------------------------------");

    let pending = initialMessage;

    while (true) {
        const message = pending ?? (await rl.question("Tú: "));
        pending = undefined;

        if (EXIT_WORDS.includes(message.trim().toLowerCase())) {
            break;
        }

        if (!message.trim()) {
            continue;
        }

        try {
            const response = await axiom.respond(message);
            console.log("");
            console.log(`AXIOM: ${response.message}`);
            console.log("");
        } catch (error) {
            const text = error instanceof Error ? error.message : "Error desconocido.";
            console.log(`AXIOM: ${text}`);
            console.log("");
        }
    }

    console.log("---------------------------------");
    console.log("");
}

async function main(): Promise<void> {
    loadEnv();

    const axiom = new AxiomAI();
    const education = new EducationEngine();

    const rl = createInterface({
        input,
        output
    });

    try {
        const authorizationAnswer = await rl.question(
            "¿Autorizas guardar tu progreso localmente? (s/n): "
        );
        const memoryEnabled = ["s", "si", "sí"].includes(
            authorizationAnswer.trim().toLowerCase()
        );
        const memory = new MemoryManager(undefined, memoryEnabled);
        const student: StudentProfile =
            await memory.loadStudent("Estudiante");

        console.log("");
        console.log("=================================");
        console.log("AXIOM AI: " + axiom.getName());
        console.log(
            `Tutor IA: ${axiom.isConnected() ? "conectado" : "no conectado (falta ANTHROPIC_API_KEY o AXIOM_OPENJARVIS_URL)"}`
        );
        console.log("=================================");
        console.log("");

        console.log("PROGRESO ACTUAL");
        console.log(`Nivel: ${student.level}`);
        console.log(`Ejercicios: ${student.exercisesCompleted}`);
        console.log(`Correctas: ${student.correctAnswers}`);
        console.log(`Incorrectas: ${student.incorrectAnswers}`);
        console.log(`Precision: ${student.getAccuracy()}%`);
        console.log("");

        const modeAnswer = await rl.question(
            axiom.isConnected()
                ? "Modo: adaptativo (a), elegir contenido (c) o conversar con el tutor (t): "
                : "Modo de aprendizaje: adaptativo (a) o elegir contenido (c): "
        );
        const mode = modeAnswer.trim().toLowerCase();
        let selectedContentId: string | undefined;
        let runExercises = true;

        if (mode === "t") {
            if (axiom.isConnected()) {
                console.log("");
                await tutorChat(rl, axiom);
                runExercises = false;
            } else {
                console.log(
                    "AXIOM: El tutor IA no está conectado. Usaremos el itinerario adaptativo."
                );
                console.log("");
            }
        }

        if (mode === "c") {
            const contents = education.getAvailableContents();

            console.log("");
            console.log("CONTENIDOS DISPONIBLES");

            for (const [index, content] of contents.entries()) {
                console.log(`${index + 1}. ${content.topic}`);
            }

            const selectionAnswer = await rl.question(
                "Elige el numero de contenido: "
            );
            const selectedIndex = Number(selectionAnswer.trim()) - 1;
            const selectedContent = contents[selectedIndex];

            if (Number.isInteger(selectedIndex) && selectedContent) {
                selectedContentId = selectedContent.id;
            } else {
                console.log(
                    "AXIOM: Seleccion no valida. Usaremos el itinerario adaptativo."
                );
            }

            console.log("");
        }

        const session = new SessionTracker();
        let continueSession = runExercises;

        while (continueSession) {
            const contentId =
                selectedContentId ?? education.selectContent(student);
            const difficulty =
                education.determineDifficulty(student, contentId);
            const objective =
                education.getLearningObjectiveStatus(student, contentId);

            console.log("APRENDIZAJE ADAPTATIVO");
            console.log(`Dificultad seleccionada: ${difficulty}`);
            console.log("");

            console.log("OBJETIVO ACTUAL");
            console.log(`Tema: ${objective.topic}`);
            console.log(`Objetivo: ${objective.objective}`);
            console.log(
                `Dominio: ${objective.exercisesCompleted}/${objective.minimumExercises} ejercicios, ${objective.accuracy}%/${objective.minimumAccuracy}% precision`
            );
            console.log(
                `Estado: ${objective.mastered ? "dominado" : "en progreso"}`
            );
            console.log("");

            const exercise = education.createMathExercise(
                difficulty,
                contentId
            );

            console.log("EJERCICIO");
            console.log("---------------------------------");
            console.log(exercise.question);
            console.log(`Tema: ${exercise.topic}`);
            console.log(`Objetivo: ${exercise.learningObjective}`);
            console.log("---------------------------------");
            console.log("");

            let userAnswer: number | undefined;

            while (userAnswer === undefined) {
                const answerInput = await rl.question("Tu respuesta: ");
                const candidate = Number(answerInput.trim());

                if (Number.isFinite(candidate)) {
                    userAnswer = candidate;
                } else {
                    console.log("AXIOM: Por favor, introduce un numero valido.");
                }
            }

            const result = education.evaluateAnswer(exercise, userAnswer);

            student.registerAnswer(
                result.correct,
                exercise.difficulty,
                exercise.contentId
            );
            session.registerExercise(exercise, result);

            const feedback = education.createAdaptiveFeedback(result, student);
            const reinforcement = education.createReinforcementGuidance(
                student,
                exercise.contentId
            );
            const sessionSummary = education.createSessionSummary(
                exercise,
                result,
                student
            );

            console.log("");
            console.log("RESULTADO");
            console.log("---------------------------------");
            console.log(result.message);
            console.log("---------------------------------");
            console.log("");

            if (!result.correct) {
                const explanation =
                    education.createStepByStepExplanation(exercise);

                console.log(explanation.title.toUpperCase());
                console.log("---------------------------------");

                for (const step of explanation.steps) {
                    console.log(`- ${step}`);
                }

                console.log("---------------------------------");
                console.log("");

                if (axiom.isConnected()) {
                    const askAnswer = await rl.question(
                        "¿Quieres preguntarle al tutor sobre este ejercicio? (s/n): "
                    );

                    if (["s", "si", "sí"].includes(askAnswer.trim().toLowerCase())) {
                        console.log("");
                        await tutorChat(
                            rl,
                            axiom,
                            `Estoy resolviendo: "${exercise.question}". ` +
                                `Respondí ${userAnswer} y la respuesta correcta es ${exercise.answer}. ` +
                                "Explícame en qué me equivoqué, paso a paso y de forma sencilla."
                        );
                    }
                }
            }

            if (reinforcement.needsReinforcement) {
                console.log("PLAN DE REFUERZO");
                console.log("---------------------------------");
                console.log(reinforcement.message);
                console.log("---------------------------------");
                console.log("");
            }

            console.log("GUIA DE AXIOM");
            console.log("---------------------------------");
            console.log(feedback.message);
            console.log("---------------------------------");
            console.log("");

            await memory.saveStudent(student);

            console.log(
                memory.isEnabled()
                    ? "Progreso guardado."
                    : "Progreso disponible solo durante esta sesion."
            );
            console.log("");

            console.log("RESUMEN DEL EJERCICIO");
            console.log(`Contenido practicado: ${sessionSummary.topic}`);
            console.log(
                `Resultado: ${sessionSummary.correct ? "correcto" : "por reforzar"}`
            );
            console.log(
                `Objetivo: ${sessionSummary.objectiveStatus.mastered ? "dominado" : "en progreso"}`
            );
            console.log(`Siguiente paso: ${sessionSummary.recommendation}`);
            console.log("");

            const nextAnswer = await rl.question(
                "¿Quieres resolver otro ejercicio? (s/n): "
            );
            continueSession = ["s", "si", "sí"].includes(
                nextAnswer.trim().toLowerCase()
            );
            console.log("");
        }

        const overview = session.getOverview();

        if (overview.exercisesCompleted > 0) {
            console.log("RESUMEN FINAL DE LA SESION");
            console.log(`Ejercicios: ${overview.exercisesCompleted}`);
            console.log(`Correctas: ${overview.correctAnswers}`);
            console.log(`Incorrectas: ${overview.incorrectAnswers}`);
            console.log(`Precision de la sesion: ${overview.accuracy}%`);
            console.log(`Temas practicados: ${overview.topics.join(", ")}`);
            console.log("");
        }

        console.log("NUEVO PROGRESO");
        console.log(`Nivel: ${student.level}`);
        console.log(`Ejercicios: ${student.exercisesCompleted}`);
        console.log(`Correctas: ${student.correctAnswers}`);
        console.log(`Incorrectas: ${student.incorrectAnswers}`);
        console.log(`Precision: ${student.getAccuracy()}%`);
        console.log("");

        const contentProgress = education.getContentProgressSummaries(student);

        if (contentProgress.length > 0) {
            console.log("PROGRESO POR CONTENIDO");

            for (const progress of contentProgress) {
                console.log(
                    `${progress.topic}: ${progress.correctAnswers}/${progress.exercisesCompleted} correctas (${progress.accuracy}%)`
                );
            }

            console.log("");
        }

    } finally {
        rl.close();
    }
}

main().catch((error: unknown) => {
    // Solo el mensaje: el objeto completo podria incluir detalles internos.
    console.error(
        "Error en AXIOM AI:",
        error instanceof Error ? error.message : "Error desconocido."
    );
    process.exit(1);
});
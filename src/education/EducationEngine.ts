import {
    type ContentProgress,
    type ExerciseDifficulty,
    StudentProfile
} from "./StudentProfile";
import {
    ContentCatalog,
    DEFAULT_MATH_CONTENT_ID,
    DIVISION_CONTENT_ID,
    MULTIPLICATION_CONTENT_ID,
    PROGRAMMING_MODULO_CONTENT_ID,
    SUBTRACTION_CONTENT_ID,
    type ValidatedContent
} from "./ContentCatalog";

export type Difficulty = ExerciseDifficulty;
export type MathOperation =
    | "suma"
    | "resta"
    | "multiplicacion"
    | "division"
    | "modulo";

export interface Exercise {
    question: string;
    answer: number;
    difficulty: Difficulty;
    contentId: string;
    topic: string;
    learningObjective: string;
    operation: MathOperation;
    operands: [number, number];
}

export interface EvaluationResult {
    correct: boolean;
    message: string;
}

export interface AdaptiveFeedback {
    message: string;
}

export interface StepByStepExplanation {
    title: string;
    steps: string[];
}

export interface ReinforcementGuidance {
    needsReinforcement: boolean;
    message?: string;
}

export interface ContentProgressSummary extends ContentProgress {
    contentId: string;
    topic: string;
    accuracy: number;
}

export interface LearningObjectiveStatus {
    contentId: string;
    topic: string;
    objective: string;
    exercisesCompleted: number;
    accuracy: number;
    minimumExercises: number;
    minimumAccuracy: number;
    mastered: boolean;
}

export interface SessionSummary {
    topic: string;
    correct: boolean;
    objectiveStatus: LearningObjectiveStatus;
    recommendation: string;
}

export class EducationEngine {
    private readonly contentCatalog: ContentCatalog;

    constructor(contentCatalog = new ContentCatalog()) {
        this.contentCatalog = contentCatalog;
    }

    public getAvailableContents(): readonly ValidatedContent[] {
        return this.contentCatalog.getContents();
    }

    public selectContent(student: StudentProfile): string {
        if (this.needsReinforcement(student, PROGRAMMING_MODULO_CONTENT_ID)) {
            return PROGRAMMING_MODULO_CONTENT_ID;
        }

        if (this.needsReinforcement(student, DIVISION_CONTENT_ID)) {
            return DIVISION_CONTENT_ID;
        }

        if (this.needsReinforcement(student, MULTIPLICATION_CONTENT_ID)) {
            return MULTIPLICATION_CONTENT_ID;
        }

        if (this.needsReinforcement(student, SUBTRACTION_CONTENT_ID)) {
            return SUBTRACTION_CONTENT_ID;
        }

        if (this.needsReinforcement(student, DEFAULT_MATH_CONTENT_ID)) {
            return DEFAULT_MATH_CONTENT_ID;
        }

        if (this.isContentMastered(student, DIVISION_CONTENT_ID)) {
            return PROGRAMMING_MODULO_CONTENT_ID;
        }

        if (this.isContentMastered(student, MULTIPLICATION_CONTENT_ID)) {
            return DIVISION_CONTENT_ID;
        }

        if (this.isContentMastered(student, SUBTRACTION_CONTENT_ID)) {
            return MULTIPLICATION_CONTENT_ID;
        }

        if (this.isContentMastered(student, DEFAULT_MATH_CONTENT_ID)) {
            return SUBTRACTION_CONTENT_ID;
        }

        return DEFAULT_MATH_CONTENT_ID;
    }

    public getLearningObjectiveStatus(
        student: StudentProfile,
        contentId: string
    ): LearningObjectiveStatus {
        const content = this.contentCatalog.getById(contentId);

        if (!content) {
            throw new Error("No existe contenido validado para este objetivo.");
        }

        const progress = student.getContentProgress(contentId);
        const exercisesCompleted = progress?.exercisesCompleted ?? 0;
        const accuracy = student.getContentAccuracy(contentId) ?? 0;
        const { minimumExercises, minimumAccuracy } = content.masteryCriteria;

        return {
            contentId,
            topic: content.topic,
            objective: content.learningObjective,
            exercisesCompleted,
            accuracy,
            minimumExercises,
            minimumAccuracy,
            mastered:
                exercisesCompleted >= minimumExercises &&
                accuracy >= minimumAccuracy
        };
    }

    public isContentMastered(
        student: StudentProfile,
        contentId: string
    ): boolean {
        return this.getLearningObjectiveStatus(student, contentId).mastered;
    }

    public createSessionSummary(
        exercise: Exercise,
        result: EvaluationResult,
        student: StudentProfile
    ): SessionSummary {
        const objectiveStatus = this.getLearningObjectiveStatus(
            student,
            exercise.contentId
        );
        const reinforcement = this.createReinforcementGuidance(
            student,
            exercise.contentId
        );

        if (reinforcement.needsReinforcement) {
            return {
                topic: exercise.topic,
                correct: result.correct,
                objectiveStatus,
                recommendation:
                    reinforcement.message ??
                    "Continuaremos reforzando este contenido."
            };
        }

        if (objectiveStatus.mastered) {
            const nextContent = this.contentCatalog.getById(
                this.selectContent(student)
            );

            return {
                topic: exercise.topic,
                correct: result.correct,
                objectiveStatus,
                recommendation:
                    nextContent?.id === exercise.contentId
                        ? "Has consolidado este objetivo. Sigue practicando para mantener el dominio."
                        : `Has consolidado este objetivo. En la proxima sesion trabajaremos ${nextContent?.topic ?? "un nuevo contenido"}.`
            };
        }

        const exercisesRemaining = Math.max(
            0,
            objectiveStatus.minimumExercises -
                objectiveStatus.exercisesCompleted
        );

        return {
            topic: exercise.topic,
            correct: result.correct,
            objectiveStatus,
            recommendation:
                exercisesRemaining > 0
                    ? `Completa al menos ${exercisesRemaining} ejercicio(s) mas de ${exercise.topic} para evaluar el dominio.`
                    : `Sigue practicando ${exercise.topic} para alcanzar ${objectiveStatus.minimumAccuracy}% de precision.`
        };
    }

    public needsReinforcement(
        student: StudentProfile,
        contentId: string
    ): boolean {
        const attempts = student.getRecentAttemptsForContent(contentId);

        if (attempts.length < 3) {
            return false;
        }

        const correctAnswers = attempts.filter(
            (attempt) => attempt.correct
        ).length;

        return (correctAnswers / attempts.length) < 0.6;
    }

    public createReinforcementGuidance(
        student: StudentProfile,
        contentId: string
    ): ReinforcementGuidance {
        if (!this.needsReinforcement(student, contentId)) {
            return {
                needsReinforcement: false
            };
        }

        const topic = this.contentCatalog.getById(contentId)?.topic ??
            "este contenido";

        return {
            needsReinforcement: true,
            message:
                `Detecte dificultades recientes en ${topic}. Mantendremos la practica de este tema hasta recuperar seguridad.`
        };
    }

    public getContentProgressSummaries(
        student: StudentProfile
    ): ContentProgressSummary[] {
        return Object.entries(student.contentProgress).map(
            ([contentId, progress]) => ({
                contentId,
                topic:
                    this.contentCatalog.getById(contentId)?.topic ??
                    contentId,
                ...progress,
                accuracy: Math.round(
                    (progress.correctAnswers /
                        progress.exercisesCompleted) *
                    100
                )
            })
        );
    }

    public determineDifficulty(
        student: StudentProfile,
        contentId?: string
    ): Difficulty {

        const accuracy = student.getAccuracy();

        if (student.exercisesCompleted < 3) {
            return "facil";
        }

        const contentAttemptCount = contentId === undefined
            ? 0
            : student.getRecentAttemptCountForContent(contentId);

        if (
            contentId !== undefined &&
            contentId !== DEFAULT_MATH_CONTENT_ID &&
            contentAttemptCount < 3
        ) {
            return "facil";
        }

        const hasEnoughContentHistory = contentAttemptCount >= 3;
        const recentAccuracy = hasEnoughContentHistory
            ? student.getRecentAccuracyForContent(
                contentId ?? DEFAULT_MATH_CONTENT_ID
            )
            : student.getRecentAccuracy();

        if (recentAccuracy !== undefined) {
            if (recentAccuracy < 60) {
                return "facil";
            }

            if (recentAccuracy < 85) {
                return "medio";
            }

            return "dificil";
        }

        if (accuracy < 60) {
            return "facil";
        }

        if (accuracy < 85) {
            return "medio";
        }

        return "dificil";
    }

    public createMathExercise(
        difficulty: Difficulty,
        contentId = DEFAULT_MATH_CONTENT_ID
    ): Exercise {

        const content = this.contentCatalog.getById(contentId);

        if (!content || !content.supportedDifficulties.includes(difficulty)) {
            throw new Error(
                "No existe contenido validado para esta dificultad."
            );
        }

        const [a, b] = this.createOperands(difficulty, content.id);

        const isSubtraction = content.id === SUBTRACTION_CONTENT_ID;
        const isMultiplication = content.id === MULTIPLICATION_CONTENT_ID;
        const isDivision = content.id === DIVISION_CONTENT_ID;
        const isModulo = content.id === PROGRAMMING_MODULO_CONTENT_ID;
        const operator = isSubtraction
            ? "-"
            : isMultiplication
                ? "×"
                : isDivision
                    ? "÷"
                    : isModulo
                        ? "%"
                        : "+";
        const answer = isSubtraction
            ? a - b
            : isMultiplication
                ? a * b
                : isDivision
                    ? a / b
                    : isModulo
                        ? a % b
                        : a + b;

        return {
            question: `¿Cuánto es ${a} ${operator} ${b}?`,
            answer,
            difficulty,
            contentId: content.id,
            topic: content.topic,
            learningObjective: content.learningObjective,
            operation: isSubtraction
                ? "resta"
                : isMultiplication
                    ? "multiplicacion"
                    : isDivision
                        ? "division"
                        : isModulo
                            ? "modulo"
                            : "suma",
            operands: [a, b]
        };
    }

    private createOperands(
        difficulty: Difficulty,
        contentId: string
    ): [number, number] {
        let a: number;
        let b: number;

        if (contentId === MULTIPLICATION_CONTENT_ID) {
            switch (difficulty) {
                case "facil":
                    a = Math.floor(Math.random() * 5) + 1;
                    b = Math.floor(Math.random() * 5) + 1;
                    break;

                case "medio":
                    a = Math.floor(Math.random() * 9) + 2;
                    b = Math.floor(Math.random() * 9) + 2;
                    break;

                case "dificil":
                    a = Math.floor(Math.random() * 8) + 5;
                    b = Math.floor(Math.random() * 8) + 5;
                    break;
            }

            return [a, b];
        }

        if (contentId === DIVISION_CONTENT_ID) {
            let divisor: number;
            let quotient: number;

            switch (difficulty) {
                case "facil":
                    divisor = Math.floor(Math.random() * 4) + 2;
                    quotient = Math.floor(Math.random() * 5) + 1;
                    break;

                case "medio":
                    divisor = Math.floor(Math.random() * 8) + 2;
                    quotient = Math.floor(Math.random() * 9) + 2;
                    break;

                case "dificil":
                    divisor = Math.floor(Math.random() * 8) + 5;
                    quotient = Math.floor(Math.random() * 8) + 5;
                    break;
            }

            return [divisor * quotient, divisor];
        }

        if (contentId === PROGRAMMING_MODULO_CONTENT_ID) {
            let divisor: number;
            let dividend: number;

            switch (difficulty) {
                case "facil":
                    divisor = Math.floor(Math.random() * 4) + 2;
                    dividend = Math.floor(Math.random() * 10) + 1;
                    break;

                case "medio":
                    divisor = Math.floor(Math.random() * 8) + 2;
                    dividend = Math.floor(Math.random() * 30) + 1;
                    break;

                case "dificil":
                    divisor = Math.floor(Math.random() * 12) + 5;
                    dividend = Math.floor(Math.random() * 100) + 1;
                    break;
            }

            return [dividend, divisor];
        }

        switch (difficulty) {

            case "facil":
                a = Math.floor(Math.random() * 10) + 1;
                b = Math.floor(Math.random() * 10) + 1;
                break;

            case "medio":
                a = Math.floor(Math.random() * 50) + 1;
                b = Math.floor(Math.random() * 30) + 1;
                break;

            case "dificil":
                a = Math.floor(Math.random() * 100) + 1;
                b = Math.floor(Math.random() * 100) + 1;
                break;
        }

        if (contentId === SUBTRACTION_CONTENT_ID && b > a) {
            return [b, a];
        }

        return [a, b];
    }

    public evaluateAnswer(
        exercise: Exercise,
        userAnswer: number
    ): EvaluationResult {

        const correct =
            exercise.answer === userAnswer;

        if (correct) {
            return {
                correct: true,
                message: "¡Correcto! Muy bien."
            };
        }

        return {
            correct: false,
            message:
                `No es correcto. La respuesta era ${exercise.answer}.`
        };
    }

    public createAdaptiveFeedback(
        result: EvaluationResult,
        student: StudentProfile
    ): AdaptiveFeedback {
        const recentAccuracy = student.getRecentAccuracy();

        if (result.correct) {
            if (recentAccuracy !== undefined && recentAccuracy >= 85) {
                return {
                    message:
                        "Excelente progreso. Mantengamos este ritmo con un reto mayor."
                };
            }

            return {
                message:
                    "Buen trabajo. Sigue practicando para consolidar este tipo de ejercicio."
            };
        }

        if (recentAccuracy !== undefined && recentAccuracy < 60) {
            return {
                    message:
                    "Vamos paso a paso: separa la operacion en partes pequeñas y vuelve a comprobar el resultado."
            };
        }

        return {
            message:
                "Un error también ayuda a aprender. Revisa cada número y prueba una estrategia distinta."
        };
    }

    public createStepByStepExplanation(
        exercise: Exercise
    ): StepByStepExplanation {
        const [firstOperand, secondOperand] = exercise.operands;

        if (exercise.operation === "resta") {
            return {
                title: "Como resolver la resta",
                steps: [
                    `Comienza con ${firstOperand}.`,
                    `Quita ${secondOperand}.`,
                    `El resultado es ${exercise.answer}.`
                ]
            };
        }

        if (exercise.operation === "multiplicacion") {
            return {
                title: "Como resolver la multiplicacion",
                steps: [
                    `Multiplica ${firstOperand} por ${secondOperand}.`,
                    `Puedes sumar ${firstOperand} un total de ${secondOperand} veces.`,
                    `El resultado es ${exercise.answer}.`
                ]
            };
        }

        if (exercise.operation === "division") {
            return {
                title: "Como resolver la division",
                steps: [
                    `Busca cuantas veces cabe ${secondOperand} en ${firstOperand}.`,
                    `${secondOperand} multiplicado por ${exercise.answer} da ${firstOperand}.`,
                    `El resultado es ${exercise.answer}.`
                ]
            };
        }

        if (exercise.operation === "modulo") {
            const quotient = Math.floor(firstOperand / secondOperand);

            return {
                title: "Como resolver el operador modulo",
                steps: [
                    `Divide ${firstOperand} entre ${secondOperand}: cabe ${quotient} vez/veces de forma entera.`,
                    `${secondOperand} multiplicado por ${quotient} da ${secondOperand * quotient}.`,
                    `El resto (modulo) es ${firstOperand} - ${secondOperand * quotient} = ${exercise.answer}.`
                ]
            };
        }

        return {
            title: "Como resolver la suma",
            steps: [
                `Comienza con ${firstOperand}.`,
                `Añade ${secondOperand}.`,
                `El resultado es ${exercise.answer}.`
            ]
        };
    }
}

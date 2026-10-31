import type { Exercise, EvaluationResult } from "./EducationEngine";

export interface SessionOverview {
    exercisesCompleted: number;
    correctAnswers: number;
    incorrectAnswers: number;
    accuracy: number;
    topics: string[];
}

export class SessionTracker {
    private exercisesCompleted = 0;
    private correctAnswers = 0;
    private incorrectAnswers = 0;
    private readonly topics = new Set<string>();

    public registerExercise(
        exercise: Exercise,
        result: EvaluationResult
    ): void {
        this.exercisesCompleted++;
        this.topics.add(exercise.topic);

        if (result.correct) {
            this.correctAnswers++;
        } else {
            this.incorrectAnswers++;
        }
    }

    public getOverview(): SessionOverview {
        return {
            exercisesCompleted: this.exercisesCompleted,
            correctAnswers: this.correctAnswers,
            incorrectAnswers: this.incorrectAnswers,
            accuracy: this.exercisesCompleted === 0
                ? 0
                : Math.round(
                    (this.correctAnswers / this.exercisesCompleted) * 100
                ),
            topics: [...this.topics]
        };
    }
}

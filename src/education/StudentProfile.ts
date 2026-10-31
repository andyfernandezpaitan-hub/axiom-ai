export type StudentLevel = "principiante" | "intermedio" | "avanzado";

export type ExerciseDifficulty = "facil" | "medio" | "dificil";

export interface ExerciseAttempt {
    difficulty: ExerciseDifficulty;
    correct: boolean;
    completedAt: string;
    contentId?: string;
}

export interface ContentProgress {
    exercisesCompleted: number;
    correctAnswers: number;
    incorrectAnswers: number;
}

export class StudentProfile {
    private static readonly MAX_EXERCISE_HISTORY = 20;

    public name: string;
    public level: StudentLevel;

    public exercisesCompleted: number;
    public correctAnswers: number;
    public incorrectAnswers: number;
    public exerciseHistory: ExerciseAttempt[];
    public contentProgress: Record<string, ContentProgress>;

    constructor(name: string) {
        this.name = name;
        this.level = "principiante";

        this.exercisesCompleted = 0;
        this.correctAnswers = 0;
        this.incorrectAnswers = 0;
        this.exerciseHistory = [];
        this.contentProgress = {};
    }

    public registerAnswer(
        correct: boolean,
        difficulty?: ExerciseDifficulty,
        contentId?: string
    ): void {
        this.exercisesCompleted++;

        if (correct) {
            this.correctAnswers++;
        } else {
            this.incorrectAnswers++;
        }

        if (difficulty) {
            const attempt: ExerciseAttempt = {
                difficulty,
                correct,
                completedAt: new Date().toISOString()
            };

            if (contentId) {
                attempt.contentId = contentId;
                this.updateContentProgress(contentId, correct);
            }

            this.exerciseHistory.push(attempt);

            if (
                this.exerciseHistory.length >
                StudentProfile.MAX_EXERCISE_HISTORY
            ) {
                this.exerciseHistory.shift();
            }
        }

        this.updateLevel();
    }

    public getAccuracy(): number {
        if (this.exercisesCompleted === 0) {
            return 0;
        }

        return Math.round(
            (this.correctAnswers / this.exercisesCompleted) * 100
        );
    }

    public getRecentAccuracy(limit = 5): number | undefined {
        const attempts = this.exerciseHistory.slice(-limit);

        return this.calculateAccuracy(attempts);
    }

    public getRecentAccuracyForContent(
        contentId: string,
        limit = 5
    ): number | undefined {
        const attempts = this.exerciseHistory
            .filter((attempt) => attempt.contentId === contentId)
            .slice(-limit);

        return this.calculateAccuracy(attempts);
    }

    public getRecentAttemptCountForContent(
        contentId: string,
        limit = 5
    ): number {
        return this.exerciseHistory
            .filter((attempt) => attempt.contentId === contentId)
            .slice(-limit).length;
    }

    public getRecentAttemptsForContent(
        contentId: string,
        limit = 3
    ): ExerciseAttempt[] {
        return this.exerciseHistory
            .filter((attempt) => attempt.contentId === contentId)
            .slice(-limit);
    }

    public getContentProgress(
        contentId: string
    ): ContentProgress | undefined {
        return this.contentProgress[contentId];
    }

    public getContentAccuracy(contentId: string): number | undefined {
        const progress = this.getContentProgress(contentId);

        if (!progress || progress.exercisesCompleted === 0) {
            return undefined;
        }

        return Math.round(
            (progress.correctAnswers / progress.exercisesCompleted) * 100
        );
    }

    public rebuildContentProgress(): void {
        this.contentProgress = {};

        for (const attempt of this.exerciseHistory) {
            if (attempt.contentId) {
                this.updateContentProgress(
                    attempt.contentId,
                    attempt.correct
                );
            }
        }
    }

    private updateContentProgress(
        contentId: string,
        correct: boolean
    ): void {
        const progress = this.contentProgress[contentId] ?? {
            exercisesCompleted: 0,
            correctAnswers: 0,
            incorrectAnswers: 0
        };

        progress.exercisesCompleted++;

        if (correct) {
            progress.correctAnswers++;
        } else {
            progress.incorrectAnswers++;
        }

        this.contentProgress[contentId] = progress;
    }

    private calculateAccuracy(
        attempts: ExerciseAttempt[]
    ): number | undefined {

        if (attempts.length === 0) {
            return undefined;
        }

        const correctAnswers = attempts.filter(
            (attempt) => attempt.correct
        ).length;

        return Math.round(
            (correctAnswers / attempts.length) * 100
        );
    }

    private updateLevel(): void {
        const accuracy = this.getAccuracy();

        if (this.exercisesCompleted >= 10 && accuracy >= 85) {
            this.level = "avanzado";
        } else if (this.exercisesCompleted >= 5 && accuracy >= 70) {
            this.level = "intermedio";
        } else {
            this.level = "principiante";
        }
    }
}

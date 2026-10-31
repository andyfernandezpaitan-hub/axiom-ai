import { promises as fs } from "fs";
import path from "path";
import {
    type ContentProgress,
    type ExerciseAttempt,
    StudentProfile
} from "../education/StudentProfile";

interface StoredStudentProfile {
    level: StudentProfile["level"];
    exercisesCompleted: number;
    correctAnswers: number;
    incorrectAnswers: number;
    exerciseHistory?: ExerciseAttempt[];
    contentProgress?: Record<string, ContentProgress>;
}

export class MemoryManager {
    private readonly filePath: string;
    private readonly enabled: boolean;

    constructor(filePath?: string, enabled = true) {
        this.filePath = filePath ?? path.join(
            process.cwd(),
            "data",
            "student-memory.json"
        );
        this.enabled = enabled;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public async saveStudent(
        student: StudentProfile
    ): Promise<void> {
        if (!this.enabled) {
            return;
        }

        const directory = path.dirname(this.filePath);

        await fs.mkdir(directory, {
            recursive: true
        });

        await fs.writeFile(
            this.filePath,
            JSON.stringify(student, null, 2),
            "utf-8"
        );
    }

    public async loadStudent(
        name: string
    ): Promise<StudentProfile> {
        if (!this.enabled) {
            return new StudentProfile(name);
        }

        try {
            const data = await fs.readFile(
                this.filePath,
                "utf-8"
            );

            const saved = JSON.parse(data) as StoredStudentProfile;

            const student = new StudentProfile(name);

            student.level = saved.level;
            student.exercisesCompleted =
                saved.exercisesCompleted;
            student.correctAnswers =
                saved.correctAnswers;
            student.incorrectAnswers =
                saved.incorrectAnswers;
            student.exerciseHistory =
                Array.isArray(saved.exerciseHistory)
                    ? saved.exerciseHistory
                    : [];
            student.contentProgress = saved.contentProgress ?? {};

            if (!saved.contentProgress) {
                student.rebuildContentProgress();
            }

            return student;
        } catch {
            return new StudentProfile(name);
        }
    }
}

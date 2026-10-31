import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AxiomMessage } from "../ai/AxiomAI";
import type { Exercise } from "../education/EducationEngine";
import {
    type ContentProgress,
    type ExerciseAttempt,
    StudentProfile
} from "../education/StudentProfile";

/**
 * Capa de datos sobre SQLite (modulo integrado `node:sqlite`, sin dependencias).
 * Todas las consultas son parametrizadas. El SQL es estandar para facilitar
 * la migracion futura a PostgreSQL.
 */

export interface StoredStudent {
    id: string;
    profile: StudentProfile;
}

export interface StoredExercise {
    id: string;
    studentId: string;
    exercise: Exercise;
    answeredAt: string | null;
}

interface ProfileJson {
    level: StudentProfile["level"];
    exercisesCompleted: number;
    correctAnswers: number;
    incorrectAnswers: number;
    exerciseHistory: ExerciseAttempt[];
    contentProgress: Record<string, ContentProgress>;
}

const MIGRATIONS = [
    `CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS exercises (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        exercise_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        answered_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_exercises_student ON exercises(student_id)`,
    `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_student ON messages(student_id, id)`
];

function profileToJson(profile: StudentProfile): string {
    const data: ProfileJson = {
        level: profile.level,
        exercisesCompleted: profile.exercisesCompleted,
        correctAnswers: profile.correctAnswers,
        incorrectAnswers: profile.incorrectAnswers,
        exerciseHistory: profile.exerciseHistory,
        contentProgress: profile.contentProgress
    };
    return JSON.stringify(data);
}

function profileFromJson(name: string, json: string): StudentProfile {
    const data = JSON.parse(json) as Partial<ProfileJson>;
    const profile = new StudentProfile(name);
    profile.level = data.level ?? profile.level;
    profile.exercisesCompleted = data.exercisesCompleted ?? 0;
    profile.correctAnswers = data.correctAnswers ?? 0;
    profile.incorrectAnswers = data.incorrectAnswers ?? 0;
    profile.exerciseHistory = Array.isArray(data.exerciseHistory) ? data.exerciseHistory : [];
    profile.contentProgress = data.contentProgress ?? {};
    return profile;
}

export class AxiomDatabase {
    private readonly db: DatabaseSync;

    /** `filePath` = ":memory:" para tests. */
    constructor(filePath: string) {
        if (filePath !== ":memory:") {
            mkdirSync(path.dirname(filePath), { recursive: true });
        }
        this.db = new DatabaseSync(filePath);
        this.db.exec("PRAGMA foreign_keys = ON");
        this.db.exec("PRAGMA journal_mode = WAL");
        for (const sql of MIGRATIONS) {
            this.db.exec(sql);
        }
    }

    public close(): void {
        this.db.close();
    }

    // ---- Estudiantes -------------------------------------------------------

    public createStudent(name: string): StoredStudent {
        const id = randomUUID();
        const now = new Date().toISOString();
        const profile = new StudentProfile(name);
        this.db
            .prepare(
                "INSERT INTO students (id, name, profile_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
            )
            .run(id, name, profileToJson(profile), now, now);
        return { id, profile };
    }

    public getStudent(id: string): StoredStudent | undefined {
        const row = this.db
            .prepare("SELECT id, name, profile_json FROM students WHERE id = ?")
            .get(id) as { id: string; name: string; profile_json: string } | undefined;
        if (!row) return undefined;
        return { id: row.id, profile: profileFromJson(row.name, row.profile_json) };
    }

    public saveStudentProfile(id: string, profile: StudentProfile): void {
        this.db
            .prepare("UPDATE students SET profile_json = ?, updated_at = ? WHERE id = ?")
            .run(profileToJson(profile), new Date().toISOString(), id);
    }

    // ---- Ejercicios --------------------------------------------------------

    public createExercise(studentId: string, exercise: Exercise): string {
        const id = randomUUID();
        this.db
            .prepare(
                "INSERT INTO exercises (id, student_id, exercise_json, created_at) VALUES (?, ?, ?, ?)"
            )
            .run(id, studentId, JSON.stringify(exercise), new Date().toISOString());
        return id;
    }

    public getExercise(id: string): StoredExercise | undefined {
        const row = this.db
            .prepare(
                "SELECT id, student_id, exercise_json, answered_at FROM exercises WHERE id = ?"
            )
            .get(id) as
            | { id: string; student_id: string; exercise_json: string; answered_at: string | null }
            | undefined;
        if (!row) return undefined;
        return {
            id: row.id,
            studentId: row.student_id,
            exercise: JSON.parse(row.exercise_json) as Exercise,
            answeredAt: row.answered_at
        };
    }

    /**
     * Marca el ejercicio como respondido. Devuelve false si ya lo estaba,
     * para impedir responder dos veces (y sumar puntos repetidos).
     */
    public markExerciseAnswered(id: string): boolean {
        const result = this.db
            .prepare("UPDATE exercises SET answered_at = ? WHERE id = ? AND answered_at IS NULL")
            .run(new Date().toISOString(), id);
        return Number(result.changes) === 1;
    }

    // ---- Mensajes del tutor -----------------------------------------------

    public addMessage(studentId: string, message: AxiomMessage): void {
        this.db
            .prepare(
                "INSERT INTO messages (student_id, role, content, created_at) VALUES (?, ?, ?, ?)"
            )
            .run(studentId, message.role, message.content, new Date().toISOString());
    }

    /** Ultimos `limit` mensajes, en orden cronologico. */
    public getRecentMessages(
        studentId: string,
        limit: number
    ): Array<AxiomMessage & { createdAt: string }> {
        const rows = this.db
            .prepare(
                "SELECT role, content, created_at FROM messages WHERE student_id = ? ORDER BY id DESC LIMIT ?"
            )
            .all(studentId, limit) as Array<{
            role: AxiomMessage["role"];
            content: string;
            created_at: string;
        }>;
        return rows
            .reverse()
            .map((r) => ({ role: r.role, content: r.content, createdAt: r.created_at }));
    }

    public deleteMessages(studentId: string): number {
        const result = this.db
            .prepare("DELETE FROM messages WHERE student_id = ?")
            .run(studentId);
        return Number(result.changes);
    }
}

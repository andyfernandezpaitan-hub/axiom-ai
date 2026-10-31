import type { ExerciseDifficulty } from "./StudentProfile";

export const DEFAULT_MATH_CONTENT_ID = "matematicas-sumas";
export const SUBTRACTION_CONTENT_ID = "matematicas-restas";
export const MULTIPLICATION_CONTENT_ID = "matematicas-multiplicaciones";
export const DIVISION_CONTENT_ID = "matematicas-divisiones";
export const PROGRAMMING_MODULO_CONTENT_ID = "programacion-modulo";

// Materias soportadas por el catálogo. Solo "matematicas" tiene contenido
// real cargado hoy — el resto se agrega cuando exista contenido validado
// (Fase 15 del roadmap: nunca se inventa contenido sin diseño explícito).
export type Subject = "matematicas" | "programacion" | "ciencias" | "idiomas" | "tecnologia";

export interface MasteryCriteria {
    minimumExercises: number;
    minimumAccuracy: number;
}

export interface ValidatedContent {
    id: string;
    subject: Subject;
    topic: string;
    learningObjective: string;
    supportedDifficulties: readonly ExerciseDifficulty[];
    masteryCriteria: MasteryCriteria;
}

export class ContentCatalog {
    private readonly contents: readonly ValidatedContent[] = [
        {
            id: DEFAULT_MATH_CONTENT_ID,
            subject: "matematicas",
            topic: "sumas",
            learningObjective:
                "Resolver sumas de numeros naturales con precision.",
            supportedDifficulties: ["facil", "medio", "dificil"],
            masteryCriteria: {
                minimumExercises: 3,
                minimumAccuracy: 85
            }
        },
        {
            id: SUBTRACTION_CONTENT_ID,
            subject: "matematicas",
            topic: "restas",
            learningObjective:
                "Resolver restas de numeros naturales con precision.",
            supportedDifficulties: ["facil", "medio", "dificil"],
            masteryCriteria: {
                minimumExercises: 3,
                minimumAccuracy: 85
            }
        },
        {
            id: MULTIPLICATION_CONTENT_ID,
            subject: "matematicas",
            topic: "multiplicaciones",
            learningObjective:
                "Resolver multiplicaciones de numeros naturales con precision.",
            supportedDifficulties: ["facil", "medio", "dificil"],
            masteryCriteria: {
                minimumExercises: 3,
                minimumAccuracy: 85
            }
        },
        {
            id: DIVISION_CONTENT_ID,
            subject: "matematicas",
            topic: "divisiones",
            learningObjective:
                "Resolver divisiones exactas de numeros naturales con precision.",
            supportedDifficulties: ["facil", "medio", "dificil"],
            masteryCriteria: {
                minimumExercises: 3,
                minimumAccuracy: 85
            }
        },
        {
            id: PROGRAMMING_MODULO_CONTENT_ID,
            subject: "programacion",
            topic: "operador modulo (%)",
            learningObjective:
                "Calcular el resto de una division entera usando el operador modulo, tal como se usa en la mayoria de lenguajes de programacion.",
            supportedDifficulties: ["facil", "medio", "dificil"],
            masteryCriteria: {
                minimumExercises: 3,
                minimumAccuracy: 85
            }
        }
    ];

    public getById(id: string): ValidatedContent | undefined {
        return this.contents.find((content) => content.id === id);
    }

    // Nombre neutro (antes getMathContents): hoy solo devuelve contenido de
    // "matematicas" porque es lo único cargado, pero la firma ya no asume
    // una sola materia.
    public getContents(): readonly ValidatedContent[] {
        return this.contents;
    }
}

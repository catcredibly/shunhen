import type { AcademicYear, FocusSession, Subject } from "../types";

export type DevelopmentAnalyticsDataset = {
  academicYears: AcademicYear[];
  subjects: Subject[];
  sessions: FocusSession[];
};

const COLORS = ["#4da3ff", "#ff6b6b", "#f6c445", "#4dd39a", "#a879ff", "#ff7eb6", "#8da2b5"];
const COURSE_NAMES = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Economics",
  "English Literature",
  "Mandarin Chinese",
  "Computer Science",
  "History",
  "Psychology",
  "Biology",
  "Statistics",
  "Design Technology",
  "Linear Algebra and Differential Equations",
  "Software Architecture",
  "Research Methods",
  "Academic Writing",
  "Data Structures and Algorithms",
  "Signals and Systems",
  "Human-Computer Interaction",
  "Machine Learning",
  "Music Theory",
  "Japanese",
  "Photography",
  "Personal Finance",
  "Public Speaking",
  "Philosophy",
  "Calculus",
  "Discrete Mathematics",
];

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Development-only, deterministic fixture. It returns plain objects and never touches storage. */
export function createDevelopmentAnalyticsDataset(sessionTarget = 12_000): DevelopmentAnalyticsDataset {
  const academicYears: AcademicYear[] = [
    { id: "demo-ib", name: "IB (2023-2025)", startDate: "2023-01-01", endDate: "2025-12-31", archived: true },
    {
      id: "demo-uni-1",
      name: "University Year 1 (2026)",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      archived: true,
    },
    {
      id: "demo-uni-2",
      name: "University Year 2 (2027)",
      startDate: "2027-01-01",
      endDate: "2027-12-31",
      archived: false,
    },
    { id: "demo-self", name: "Independent Study", startDate: "2023-01-01", archived: false },
  ];
  const subjects: Subject[] = COURSE_NAMES.map((name, index) => ({
    id: `demo-subject-${index}`,
    academicYearId: index >= 22 ? "demo-self" : index >= 16 ? "demo-uni-2" : index >= 10 ? "demo-uni-1" : "demo-ib",
    name,
    color: COLORS[index % COLORS.length],
    archived: index % 11 === 0,
  }));
  const rng = random(0xf0c05);
  const start = new Date(2023, 0, 1).getTime();
  const end = new Date(2027, 11, 20).getTime();
  const sessions: FocusSession[] = [];
  const durationMinutes = [20, 25, 30, 50, 50, 50, 75, 90, 105, 120, 145];
  for (let index = 0; index < sessionTarget; index++) {
    const progress = index / Math.max(1, sessionTarget - 1);
    const day = new Date(start + (end - start) * progress);
    const monthActivity = [0.7, 0.9, 1.2, 1.1, 1.35, 0.8, 0.3, 0.35, 1.25, 1.45, 1.15, 0.65][day.getMonth()];
    if (rng() > monthActivity * 0.76) continue;
    day.setDate(day.getDate() + Math.floor(rng() * 5));
    day.setHours(7 + Math.floor(rng() * 15), Math.floor(rng() * 4) * 15, 0, 0);
    const independent = rng() < 0.2;
    const yearId = independent
      ? "demo-self"
      : day.getFullYear() <= 2025
        ? "demo-ib"
        : day.getFullYear() === 2026
          ? "demo-uni-1"
          : "demo-uni-2";
    const choices = subjects.filter((subject) => subject.academicYearId === yearId);
    const subject = choices[Math.floor(rng() * choices.length)];
    const minutes = durationMinutes[Math.min(durationMinutes.length - 1, Math.floor(rng() * durationMinutes.length))];
    const focusedDurationSeconds = minutes * 60;
    const pauseSeconds = rng() < 0.25 ? Math.floor(rng() * 20) * 60 : 0;
    sessions.push({
      id: `demo-session-${index}`,
      subjectId: subject.id,
      subjectName: subject.name,
      academicYearId: yearId,
      academicYearName: academicYears.find((year) => year.id === yearId)!.name,
      startTime: day.getTime(),
      endTime: day.getTime() + focusedDurationSeconds * 1000 + pauseSeconds * 1000,
      focusedDurationSeconds,
      archived: index % 47 === 0,
    });
  }
  return { academicYears, subjects, sessions: sessions.sort((a, b) => a.startTime - b.startTime) };
}

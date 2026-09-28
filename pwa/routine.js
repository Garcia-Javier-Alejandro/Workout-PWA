// Program definition for the Push / Pull / Full Body routine.
//
// The app is still a plain recorder: nothing here starts, advances, or discards
// a workout automatically. This file only describes WHAT each workout contains
// and the fixed 5/3/1 percentages. The live progression state (which workout is
// next, and each main lift's Training Max / week / cycle) lives in IndexedDB and
// only ever changes when the user presses COMPLETAR SESIÓN.

// Registry of every exercise id -> display name. It intentionally includes the
// LEGACY dumbbell ids so historical sessions keep their original names and never
// change meaning. New-program exercises use new ids; ids are never reused across
// the old and new routines.
window.EXERCISES = {
  // --- legacy dumbbell routine (kept only so old history renders correctly) ---
  squat: "Dumbbell Squat",
  rdl: "Dumbbell Romanian Deadlift",
  chest_press: "Dumbbell Chest Press",
  row: "One-arm Dumbbell Row",
  lateral_raise: "Dumbbell Lateral Raise",
  // --- new Push / Pull / Full Body program ---
  bench_press: "Bench Press", // main lift (Push)
  bench_acc: "Bench Press", // accessory (Full Body) — separate history stream
  bb_squat: "Squat", // main lift (Full Body)
  squat_acc: "Squat", // accessory (Push) — separate history stream
  deadlift: "Deadlift", // main lift (Pull)
  ohp: "Overhead Press",
  lat_pulldown: "Lat Pulldown",
  db_curl: "Dumbbell Curl",
  bb_row: "Row",
  rdl_bb: "Romanian Deadlift",
  lat_raise: "Lateral Raise",
};

// The fixed workout sequence. Advancing is driven only by completed workouts,
// never by the calendar: after completing one workout the next in this list
// becomes the pending session.
window.SEQUENCE = ["push", "pull", "full_body"];

// The three workouts. Each has exactly one main lift (5/3/1) and three
// accessories (double progression). `repRange` is [low, high] and drives both
// the displayed target and the default reps of a fresh series.
window.WORKOUTS = {
  push: {
    name: "Push",
    exercises: [
      { id: "bench_press", main: true },
      { id: "squat_acc", sets: 3, repRange: [6, 8] },
      { id: "bb_row", sets: 3, repRange: [8, 12] },
      { id: "lat_raise", sets: 3, repRange: [12, 15] },
    ],
  },
  pull: {
    name: "Pull",
    exercises: [
      { id: "deadlift", main: true },
      { id: "ohp", sets: 3, repRange: [6, 8] },
      { id: "lat_pulldown", sets: 3, repRange: [8, 12] },
      { id: "db_curl", sets: 3, repRange: [10, 15] },
    ],
  },
  full_body: {
    name: "Full Body",
    exercises: [
      { id: "bb_squat", main: true },
      { id: "bench_acc", sets: 3, repRange: [6, 8] },
      { id: "rdl_bb", sets: 3, repRange: [8, 10] },
      { id: "bb_row", sets: 3, repRange: [8, 12] },
    ],
  },
};

// Main lift per workout, with the Training-Max increment applied after a full
// four-week cycle and a modest editable default TM (kg). The user sets their
// real TM in the UI; these are only starting placeholders.
window.MAIN_LIFTS = {
  push: { id: "bench_press", tmIncrement: 2.5, defaultTM: 40 },
  pull: { id: "deadlift", tmIncrement: 5, defaultTM: 60 },
  full_body: { id: "bb_squat", tmIncrement: 2.5, defaultTM: 50 },
};

// Simplified 5/3/1: three working sets per week as percentages of the Training
// Max, with a target rep count. No AMRAP. Week 4 is a deload.
window.FIVE_THREE_ONE = {
  1: [ { pct: 0.65, reps: 5 }, { pct: 0.75, reps: 5 }, { pct: 0.85, reps: 5 } ],
  2: [ { pct: 0.70, reps: 3 }, { pct: 0.80, reps: 3 }, { pct: 0.90, reps: 3 } ],
  3: [ { pct: 0.75, reps: 5 }, { pct: 0.85, reps: 3 }, { pct: 0.95, reps: 1 } ],
  4: [ { pct: 0.40, reps: 5 }, { pct: 0.50, reps: 5 }, { pct: 0.60, reps: 5 } ],
};

// Canonical order for grouping a session's exercises in the read-only history
// and past-workout views (legacy ids first, then the new program). Only the
// exercises actually present in a session are shown.
window.EXERCISE_ORDER = [
  "squat", "rdl", "chest_press", "row", "lateral_raise",
  "bench_press", "squat_acc", "bb_row", "lat_raise",
  "deadlift", "ohp", "lat_pulldown", "db_curl",
  "bb_squat", "bench_acc", "rdl_bb",
];

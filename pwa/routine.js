// The fixed routine: exactly 5 exercises, 3 sets each = 15 sets per session.
// `initialReps` is only a starting value for the counter and can be freely
// changed on any set with the +/- buttons.
window.ROUTINE = [
  { id: "squat", name: "Dumbbell Squat", sets: 3, initialReps: 10 },
  { id: "rdl", name: "Dumbbell Romanian Deadlift", sets: 3, initialReps: 10 },
  { id: "chest_press", name: "Dumbbell Chest Press", sets: 3, initialReps: 10 },
  { id: "row", name: "One-arm Dumbbell Row", sets: 3, initialReps: 10 },
  { id: "lateral_raise", name: "Dumbbell Lateral Raise", sets: 3, initialReps: 16 },
];

window.TOTAL_SETS = window.ROUTINE.reduce((sum, ex) => sum + ex.sets, 0);

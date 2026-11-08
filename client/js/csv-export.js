// client/js/csv-export.js
// Client-side CSV generation from session state.
// §11: two CSV files — students and submissions.

function csvRow(fields) {
  return fields.map(f => {
    const v = f == null ? '' : String(f);
    // Escape double quotes and wrap in quotes if needed
    return (v.includes(',') || v.includes('"') || v.includes('\n'))
      ? `"${v.replace(/"/g, '""')}"`
      : v;
  }).join(',');
}

const QUIZ_CORRECT = [0, 2, 1, 0, 0]; // correct option indices for Q1–Q5

/**
 * §11 CSV 1: one row per student.
 */
export function buildStudentCSV(state) {
  const header = csvRow([
    'Nickname', 'Team',
    'Q1 Hook', 'Q2 Hook', 'Q3 Hook',
    'Discussion Poll 1', 'Discussion Poll 2',
    'Best App Score', 'Recipe Submissions',
    'Quiz Q1', 'Quiz Q2', 'Quiz Q3', 'Quiz Q4', 'Quiz Q5', 'Quiz Score',
    'Confidence', 'Reflection', 'Facilitator Note',
  ]);

  const rows = Object.values(state.participants ?? {}).map(p => {
    const qa = p.exitQuiz?.answers ?? [];
    return csvRow([
      p.nickname,
      p.teamName,
      p.hookAnswers?.q1 ?? '',
      p.hookAnswers?.q2 ?? '',
      p.hookAnswers?.q3 ?? '',
      p.discPollAnswers?.[0] ?? '',
      p.discPollAnswers?.[1] ?? '',
      p.bestScore ?? 0,
      p.submissionCount ?? 0,
      qa[0] !== undefined ? qa[0] : '',
      qa[1] !== undefined ? qa[1] : '',
      qa[2] !== undefined ? qa[2] : '',
      qa[3] !== undefined ? qa[3] : '',
      qa[4] !== undefined ? qa[4] : '',
      p.exitQuiz?.score ?? '',
      p.confidence ?? '',
      p.reflection ?? '',
      p.facilitatorNote ?? '',
    ]);
  });

  return [header, ...rows].join('\r\n');
}

/**
 * §11 CSV 2: one row per recipe submission.
 */
export function buildSubmissionCSV(state) {
  const header = csvRow([
    'Nickname', 'Team', 'Submitted At',
    'Spaghetti (g)', 'Chicken (g)', 'Heavy cream (ml)', 'Evap milk (ml)',
    'Butter (g)', 'Cheese (g)', 'Mushrooms (g)', 'Garlic (g)', 'Salt (g)',
    'Cost/portion (₱)', 'Food cost %', 'Calories', 'Protein (g)', 'Fat (g)', 'Sodium (mg)',
    'Cost OK', 'Calories OK', 'Sodium OK', 'Protein OK', 'Score',
  ]);

  const rows = [];
  for (const p of Object.values(state.participants ?? {})) {
    for (const sub of (p.submissions ?? [])) {
      const r = sub.recipe ?? {};
      const b = sub.breakdown ?? {};
      rows.push(csvRow([
        p.nickname,
        p.teamName,
        sub.timestamp ? new Date(sub.timestamp).toISOString() : '',
        r.spaghetti ?? 0,
        r.chicken_breast ?? 0,
        r.heavy_cream ?? 0,
        r.evaporated_milk ?? 0,
        r.butter ?? 0,
        r.cheese ?? 0,
        r.mushrooms ?? 0,
        r.garlic ?? 0,
        r.salt ?? 0,
        b.costPerPortion != null ? b.costPerPortion.toFixed(2) : '',
        b.foodCostPct    != null ? b.foodCostPct.toFixed(1)    : '',
        b.kcalPerPortion != null ? Math.round(b.kcalPerPortion) : '',
        b.proteinPerPortion != null ? b.proteinPerPortion.toFixed(1) : '',
        b.fatPerPortion     != null ? b.fatPerPortion.toFixed(1)     : '',
        b.sodiumPerPortion  != null ? Math.round(b.sodiumPerPortion) : '',
        b.costOk    ? 'YES' : 'NO',
        b.caloriesOk? 'YES' : 'NO',
        b.sodiumOk  ? 'YES' : 'NO',
        b.proteinOk ? 'YES' : 'NO',
        sub.score ?? 0,
      ]));
    }
  }

  return [header, ...rows].join('\r\n');
}

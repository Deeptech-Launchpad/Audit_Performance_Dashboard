/** The short project name shown in the Project filter and in search: only the first word of the saved project name.
 *  "Grainger 2026 NPI Flight Group 32" -> "Grainger".  Files keep their full project name (see Upload history); this is only how projects are grouped. */
export const projectGroup = (name) => String(name ?? '').trim().split(/\s+/)[0] || '';

/** [{ name: full project name, files }] -> [{ name: first word, files }] sorted by name (several full names with the same first word become one entry). */
export function groupProjects(rows) {
  const groups = new Map();
  for (const r of rows) { const g = projectGroup(r.name); if (g) groups.set(g, (groups.get(g) || 0) + Number(r.files || 0)); }
  return [...groups].map(([name, files]) => ({ name, files })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The audit table (columns A:N) has no project column, so the uploader confirms the project name.
 *  This suggests one from the file name: dates, "550 SKUs", the word "Data" and a trailing version like "A2" are dropped.
 *  e.g. "Grainger 2026_NPI_Flight Group 32_Data_550 SKUs_071526_A2.ods" -> "Grainger 2026 NPI Flight Group 32" */
export function suggestProject(filename) {
  const base = String(filename || '').replace(/\.(ods|xlsx|xls)$/i, '').replace(/[_\s]+/g, ' ').trim();
  let s = base
    .replace(/\b\d{6,8}\b/g, ' ')            // dates such as 071526 or 20260715
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d[\d,]*\s*SKUs?\b/gi, ' ')  // "550 SKUs"
    .replace(/\bdata\b/gi, ' ')
    .replace(/\s+[A-Za-z]\d{1,2}\s*$/, ' ')  // version suffix " A2"
    .replace(/\s+/g, ' ').trim();
  return s || base || 'Project';
}

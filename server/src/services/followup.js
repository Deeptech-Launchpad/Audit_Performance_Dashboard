// How PT and re-audit follow-up is classified. Rules are driven by Settings, never hard-coded names.
//
// A "case" is an audited record that has an audit finding (any code other than OK, so error codes and
// suggestions) or that already has a PT status.
//   PT status  : completed | pending | not_recorded | unmapped | not_applicable
//                 - the PT Status text is looked up in Settings -> ptStatusMap
//                 - empty PT Status on a case = not_recorded (or pending if the setting says so)
//                 - text that is not in the map = unmapped (shown as is; never guessed)
//   Re-audit   : passed | issues | pending | not_due
//                 - a Re-Audit Comment exists: "ok"-type words = passed, anything else = issues found
//                 - no comment, PT completed = pending (PT says it is fixed, re-audit not yet written)
//                 - no comment, PT not completed = not_due (nothing to re-audit yet)
// "Updated | Not Updated", "Updated/Not updated" and "updated / not updated" are the same text: | , ; & + are read like "/".
export const normStatus = (s) => String(s ?? '').toLowerCase().replace(/\s*[/|,;&+]\s*/g, '/').replace(/\s+/g, ' ').replace(/^\/+|\/+$/g, '').trim();

/** PT status text -> completed | pending | unmapped. A text listed in Settings wins. A combined text such as "Checked/Updated"
 *  (one word per attribute) is read word by word: all words "done" = completed; any word "pending" = pending (part of the work is
 *  not done yet - the same meaning the Admin gave "Updated/Not Updated"); a word that is not listed = unmapped (never guessed). */
export function ptClass(text, settings) {
  const raw = normStatus(text);
  const map = Object.fromEntries(Object.entries(settings.ptStatusMap || {}).map(([k, v]) => [normStatus(k), v]));
  if (map[raw]) return map[raw];
  const parts = [...new Set(raw.split('/').map((x) => x.trim()).filter(Boolean))];
  if (parts.length < 2) return 'unmapped';
  const each = parts.map((p) => map[p]);
  if (each.some((x) => !x)) return 'unmapped';
  return each.includes('pending') ? 'pending' : 'completed';
}

/** A re-audit comment means "OK" when it is only OK-type words (e.g. "ok", "Okay.", "OK - done", "ok checked"). */
const OK_FILLERS = ['all', 'is', 'checked', 'verified', 'fixed', 'corrected', 'updated', 'correct', 'now'];
export function reauditPassed(comment, settings) {
  const ok = (settings.reauditOkWords || []).map((w) => w.toLowerCase().trim()).filter(Boolean);
  const text = String(comment || '').toLowerCase().trim().replace(/[.!\s]+$/g, '');
  if (!text) return false;
  if (ok.includes(text)) return true;
  const words = text.split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.length <= 4 && words.some((w) => ok.includes(w)) && words.every((w) => ok.includes(w) || OK_FILLERS.includes(w));
}

export function classifyFollowUp({ codes, ptStatus, reauditComments, sampled }, settings) {
  const hasFinding = (codes || []).some((c) => c !== 'OK');
  const isCase = !!sampled && (hasFinding || !!String(ptStatus || '').trim());
  if (!isCase) return { isCase: false, pt: 'not_applicable', reaudit: 'not_due' };
  const raw = normStatus(ptStatus);
  const pt = !raw ? (settings.blankPtIsPending ? 'pending' : 'not_recorded') : ptClass(ptStatus, settings);
  const rc = String(reauditComments || '').trim();
  let reaudit;
  if (rc) reaudit = reauditPassed(rc, settings) ? 'passed' : 'issues';
  else reaudit = pt === 'completed' ? 'pending' : 'not_due';
  return { isCase: true, pt, reaudit };
}

/** Re-classify every record (used after the status rules in Settings change). */
export async function refreshTracking(db, settings) {
  const rows = await db.all(`SELECT id, is_sampled, pt_status, pt_comments, pt_response, reaudit_comments FROM audit_records`);
  const codes = await db.all(`SELECT audit_record_id AS id, code FROM error_classifications`);
  const byRec = new Map();
  for (const c of codes) { if (!byRec.has(c.id)) byRec.set(c.id, []); byRec.get(c.id).push(c.code); }
  await db.tx(async (tx) => {
    for (const r of rows) {
      const f = classifyFollowUp({ codes: byRec.get(r.id) || [], ptStatus: r.pt_status, reauditComments: r.reaudit_comments, sampled: !!r.is_sampled }, settings);
      await writeTracking(tx, r.id, r, f);
    }
  });
  return rows.length;
}

export async function writeTracking(tx, recordId, rec, f) {
  await tx.run(`INSERT INTO pt_tracking (audit_record_id, status_raw, status_class, comments, response) VALUES (?,?,?,?,?)
    ON CONFLICT(audit_record_id) DO UPDATE SET status_raw = excluded.status_raw, status_class = excluded.status_class, comments = excluded.comments, response = excluded.response`,
  [recordId, rec.pt_status ?? rec.ptStatus ?? '', f.pt, rec.pt_comments ?? rec.ptComments ?? '', rec.pt_response ?? rec.ptResponse ?? '']);
  await tx.run(`INSERT INTO reaudit_tracking (audit_record_id, comments, state) VALUES (?,?,?)
    ON CONFLICT(audit_record_id) DO UPDATE SET comments = excluded.comments, state = excluded.state`,
  [recordId, rec.reaudit_comments ?? rec.reauditComments ?? '', f.reaudit]);
}

// Attribute names written in the auditor's comment (Audit Comments), checked against the SKU's OWN attribute list (Att 1, Att 2 …).
// Every auditor writes comments in a different format, for example:
//   Gokul      "Includes>>Sheath | Sheath Material>>…"          (Name>>comment, separated by |)
//   Suresh     "<Color>Silver, <Service Height – Maximum>Check"  (<Name>comment, separated by commas; sometimes "<Name.comment")
//   Sathish    "< Battery Platform > LXT® , Charger … Number . Not Applicable"   (spaces inside < >, sometimes "<" missing)
// So the comment is not split by a fixed format. Instead each attribute name of the SKU is looked for as a HEADING:
//   - "<Name>" / "< Name >" / "<Name." / "<Name:"  anywhere, unless it is only the target of a move ("value move to <Diameter>")
//   - "Name>>" / "Name >" / "Name ." / "Name:"      right at the start or after a separator ( , | ; / new line )
//   - "Name , Other Name>>"                          (two names sharing one comment)
// A name that is not an attribute of this SKU (e.g. "PT_Manufacturer Name" or a typo) is never returned.

const fold = (s) => String(s ?? '').replace(/[‐-―−]/g, '-').replace(/[   ]/g, ' ').replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** regex source for a name: any spacing, and "-" / "–" / "—" treated alike */
const namePattern = (name) => fold(name).trim().split(/\s+/).map((w) => esc(w).replace(/-/g, '\\s*-\\s*')).join('\\s+');
const key = (s) => fold(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// words right before "<Name>" that make it a reference, not a heading: "value move to <Diameter>", "same as <Width>", "based on <Length>"
const REFERENCE_BEFORE = /(?:\bmove[ds]?|\bmoving|\bshift(?:ed)?|\btransfer(?:red)?|\binto|\bto|\bas|\bthan|\bwith|\bfrom|\bon|\bin|\bunder|\brefer)\s*$/i;
const SEPARATOR_BEFORE = /(?:^|[,|;\n/]|>>?)\s*$/; // start of the comment or right after a separator (or right after the previous heading)

/**
 * @param {string} comment the Audit Comments text
 * @param {string[]} names the SKU's attribute names (Att 1, Att 2 …)
 * @returns {string[]} the attribute names (as written in the SKU's list) that the comment names as wrong, in comment order, no duplicates
 */
export function commentAttributes(comment, names) {
  const text = fold(comment);
  if (!text.trim() || !names?.length) return [];
  const uniq = new Map(); for (const n of names) { const k = key(n); if (k && !uniq.has(k)) uniq.set(k, String(n).trim()); }
  const list = [...uniq.values()].sort((a, b) => b.length - a.length); // longest first: "Number of Speed Settings" before "Speed Settings"
  const taken = []; const hits = []; // [start, end] ranges already used, and {name, at}
  const free = (s, e) => !taken.some(([a, b]) => s < b && e > a);
  const pending = []; // "Name ," candidates: a heading only if another heading follows the comma

  for (const name of list) {
    const p = namePattern(name);
    // 1) bracket form: "<Name>", "< Name >", "<Name.", "<Name:", "<Name)"
    const br = new RegExp(`<\\s*(${p})\\s*(?=>|\\.|:|\\))`, 'gi');
    // 2) plain form: "Name>>", "Name >", "Name .", "Name:"   (must start the comment or follow a separator)
    const pl = new RegExp(`(${p})\\s*(?=>|\\.(?!\\d)|:)`, 'gi');
    // 3) "Name ," followed later by another heading ("Hutch Depth , Hutch Height>>")
    const cm = new RegExp(`(${p})\\s*,`, 'gi');
    let found = false; let m;
    while (!found && (m = br.exec(text))) {
      const s = m.index + m[0].indexOf(m[1]); const e = s + m[1].length; const before = text.slice(0, m.index);
      if (!free(s, e) || REFERENCE_BEFORE.test(before.split(/[,|;\n]/).pop())) continue;
      taken.push([s, e]); hits.push({ name, at: s }); found = true;
    }
    while (!found && (m = pl.exec(text))) {
      const s = m.index; const e = s + m[1].length;
      if (!free(s, e) || !SEPARATOR_BEFORE.test(text.slice(0, s))) continue;
      taken.push([s, e]); hits.push({ name, at: s }); found = true;
    }
    if (!found) while ((m = cm.exec(text))) { const s = m.index; if (SEPARATOR_BEFORE.test(text.slice(0, s))) pending.push({ name, s, e: s + m[1].length, after: m.index + m[0].length }); }
  }
  // a "Name ," candidate counts when the text right after the comma is another heading that was found
  for (const c of pending) {
    if (!free(c.s, c.e) || hits.some((h) => h.name === c.name)) continue;
    const next = hits.find((h) => h.at >= c.after && !text.slice(c.after, h.at).replace(/[<\s]/g, ''));
    if (next) { taken.push([c.s, c.e]); hits.push({ name: c.name, at: c.s }); }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name);
}

export const attributeKey = key;

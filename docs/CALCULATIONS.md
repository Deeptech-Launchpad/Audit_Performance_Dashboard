# Data rules and calculations

**Everything on every page is calculated from columns A:N of the uploaded audit table, and nothing else.**
No summary table, dashboard, helper column or figure written in the workbook is ever read or used.

## 1. What is read

| Source column | Field |
|---|---|
| A | SKU ID |
| B | SKU Build By |
| C | Sample |
| D | Audit By |
| E | Error Type |
| F | Attribute/Field |
| G | Audit Comments |
| H | PT Status |
| I | PT Comments |
| J | Re-Audit Comments |
| K | Gap/Similar |
| L | PT Response |
| M | CFB Attribute |
| N | CFB Comments |

* **The sheet is found from its column headings** (not its name or position): any sheet whose first rows contain the
  headings `SKU ID` and `SKU Build By` (plus the other audit headings) **within columns A:N**. Title rows above the headings are fine.
* Only A:N are read. Columns to the right (product/PIM columns, helper columns), other sheets and any summary tables are ignored.
  If a workbook has several candidate sheets the best match is chosen and the uploader can pick another.
* **Original values are kept exactly as written** (leading/trailing spaces trimmed; the text `nan` is treated as empty).
  Row numbers shown to the user are the true spreadsheet row numbers.
* **No date column exists in A:N.** The audit date is entered by the uploader (pre-filled from the file name when it contains
  one, e.g. `â€¦_071526_â€¦` = 15 Jul 2026). It is never guessed.
* Several files per day are combined; each is imported separately (see Â§5).

## 2. Definitions

| Measure | Rule |
|---|---|
| Audited sample | a row whose **Sample (C)** is filled (not empty and not "no / 0 / n/a / -"). Audit details with an empty Sample are **not** counted as audited; they are reported as a warning. |
| Valid error code | a code in `Settings â†’ Error types` that is marked "counts as an error". Blank, `OK`, `SG` (suggestion), non-code text and **unknown codes are never errors**. Unknown codes are listed on the Error Analysis page and in the upload preview so an Admin can add them; once added, every number updates. |
| Total SKUs | distinct SKU IDs. **"Not available"** when a contributing file lists only audited SKUs (no row has an empty Sample), because the number assigned cannot be derived. |
| Samples audited | distinct SKU IDs that are audited samples |
| Sample audit % | samples audited Ã· total SKUs Ã— 100 (Not available when total SKUs is) |
| **SKUs with errors** | distinct audited SKU IDs with â‰¥ 1 valid error code. A SKU with several codes counts **once**. |
| **Error %** (content) | SKUs with errors Ã· samples audited Ã— 100 |
| **Error classifications** | number of valid error codes recorded, counted **separately** (a SKU with `DE \| DM \| UE` = 3). Used in Error Analysis and everywhere "classifications" appear. |
| Zero denominator | shown as "â€”", never 0 % |

Product Team = grouped by **B**. Audit Team = grouped by **D**; auditors are never given an error percentage, and "errors found" is
shown as workload, not quality. Error Analysis groups by **E**, analyses **F**, explains recurring issues with **G**
(the same comment, links ignored, on 2+ SKUs) and shows errors by content member and by auditor.

### PT and re-audit (columns H, I, J, L) â€” kept separate from the import review

A **case** = an audited record with an audit finding (any code but OK) or an existing PT status.

* **PT status** comes from **H**, looked up in `Settings â†’ PT status meanings` (defaults: *Updated*, *Checked* = done; *Not Updated*,
  *Updated/Not Updated* = pending). Empty = "No status recorded" (not guessed). Text not in the list = "Unrecognised status".
* **Re-audit** comes from **J**: a comment means re-audited ("ok"-type words = OK, anything else = issues found); no comment and PT done = **re-audit pending**; otherwise "not due".
* **I** (PT comments) and **L** (PT response) are shown next to every case and counted per auditor ("PT responded"); they do not change a status.
* The import-review decisions (skip / update / import) in the upload screen belong to the file import only and have nothing to do with PT or re-audit status.
* Ageing = today (configured time zone) âˆ’ the audit date entered at upload.

## 3. Reference check against the sample workbook

The sample (`Grainger 2026_NPI_Flight Group 32_Data_550 SKUs_071526_A2.ods`) yields, **calculated purely from A:N of its "Data" sheet**:
555 SKU rows, 104 audited samples, **31 SKUs with errors (29.81 %)**, **34 error classifications**, 74 PT/re-audit cases, e.g.
Jaya Vaishnavi M 15 / 8 / 53.33 %, Poorani D 23 / 1 / 4.35 %, Subaranjana T 4 / 3 / 75 %.
These are expectations in the automated tests only; nothing in the application is hard-coded to them.

Why classifications (34) exceed SKUs with errors (31): two SKUs carry several codes (`433TY2` DE+DM, `434TV1` DE+DM+UE) â†’ 3 extra.
(The workbook's own summary sheet says 33 and 550 SKUs; it is ignored. Its error table simply has no row for code FE, and its per-person SKU
counts differ from the data rows â€” which is why numbers are never taken from summary tables.)

## 4. Data checks shown on every upload (A:N only)

Rows read, SKUs, audited samples, SKUs with errors, classifications (and the extra caused by multi-error SKUs), rows missing SKU Build By,
rows with audit details but no Sample, error codes not in the error list, and whether total SKUs can be derived.

## 5. Duplicate handling

Each row becomes one **audit record** carrying all its error codes (so legitimate multiple errors are never lost).

* **Fingerprint** = SKU ID + auditor + sorted error codes + sorted attributes (+ audit date only if enabled in Settings).
  PT / re-audit / comments are not in the fingerprint, so a later version of the same file is recognised as the same record.
* Verdicts in the review step: *Already imported* (skip by default), *Updated details* (update by default, old â†’ new shown),
  *Different result for a known SKU* (import as new by default), *Repeated in this file* and *Known SKU, no audit result* (skip by default).
  The reviewer can change every decision. The import is one database transaction.

## 6. Improvement suggestions

`server/src/analytics/suggestions.js`: nine rules over the calculated numbers, each with its `evidence`. New providers (e.g. AI) can be added to `PROVIDERS`.

## 7. Attribute-based numbers (the one exception to "only A:N")

Everywhere a SKU-based number is shown there is an attribute-based counterpart (Overview, Product Team incl. each person's panel and
feedback report, Audit Team, Error Analysis, Weekly Reports Excel/PDF). They count the individual attributes inside the SKUs instead of whole SKUs.

To do this the reader also looks at the attribute columns to the right of column N: `Att 1, Raw Val 1, Build Val 1, UOM 1 â€¦ Att n â€¦`
(found by their headings, about 100 slots in the sample). Nothing else beyond column N is read, and these columns are only **counted**.

| Measure | Rule (per distinct SKU, then added up) |
|---|---|
| Attributes enriched | slots where `Att n` has a name **and** `Raw Val n` or `Build Val n` has a value. Counts every SKU (audited or not). |
| Attributes audited | enriched attributes of the **audited** SKUs + attributes the auditor flagged that were left empty (e.g. Data Missing) |
| Attributes with errors | names in **Attribute/Field (F)** of audited SKUs with a valid error code, that are real attributes of the SKU (in its `Att n` list). One attribute on one SKU counts once. |
| Other fields | names in F that are not attributes of the SKU (e.g. "Source", "Page Number", "All"). Shown separately, not in the attribute error %. |
| Attribute error % | attributes with errors Ã· attributes audited |

* Only files that **have** the attribute columns can say anything about attributes enriched / audited. If some files in the selection lack them, the attribute numbers use just the files that have them (numerator and denominator alike), are marked with `*` / "from x of y SKUs", and a notice lists the files left out. If **no** file in the selection has the columns, enriched / audited / % show **"Not available"** ("Attributes with errors" still comes from column F).
* Re-uploading an older file that now has the attribute columns shows its rows as **Updated details** ("Attributes enriched") and fills them in without duplicating anything. A file without the columns never overwrites stored attribute counts.
* An error SKU whose Attribute/Field cell is empty has no attribute to count (it is also listed in the upload warnings).

## 8. Category-Based Performance Tracking (third deliberate exception: the PIM Taxonomy column)

* The **PIM Taxonomy** column is found by its **heading** (in the sample it is column **R**; column N is "CFB Comments"), wherever it sits. Only that one column is read.
* **Category = L1** = the text before the first `>`: `Abrasives > Blasting, Deburring and Sharpening > â€¦` â†’ **Abrasives**. Spelling/case differences are one category.
* Per person and category: SKUs built, SKUs audited, SKUs with errors, **error %** (SKUs with errors Ã· audited), classifications, attribute error %.

| Result | Rule (Settings: error target, warning margin, minimum audited SKUs per category, default 3 – no longer shown on the Settings page; it keeps its saved value and can still be changed through the API) |
|---|---|
| Proven | audited â‰¥ minimum **and** error % â‰¤ target |
| **Okay** | audited â‰¥ minimum and error % â‰¤ target + margin |
| **Needs coaching** | audited â‰¥ minimum and error % above that |
| **Not enough checks** | 1 to (minimum âˆ’ 1) audited SKUs: too little evidence |
| Not audited yet | built SKUs there, none audited |

* **Recommended for new SKUs** = the proven people, best error % first (ties: more audited SKUs, then more SKUs built), at most three. If nobody is proven: the best "acceptable" or "early signal" person, labelled **Best guess – few checks**; if everyone needs coaching or was not audited: **No one ready yet**. When the people shown are Great the label is **Clear best choice**.
* Files imported without the PIM Taxonomy column are left out and listed in a notice; re-uploading such a file shows its rows as "Updated details" (PIM Taxonomy) and adds the categories without duplicates. A file without the column never erases stored categories.
* The analysis uses only what the audit records show. There are no timestamps, so "productivity" is shown as SKUs built per category (experience), not as speed.


## Source links ("Check mistakes at the source", Product Team page)
Third exception to "A:N only". Read at upload, **only for rows that name something in Attribute/Field**: `Raw Val n` (captured value),
`PT_Source URL Link n`, `PT_Source Page# n` of the matching `Att n`, plus `PT_Data Source URL_1/2`, `PT_PDF Source URL_1/2`, `PT_PDF Page#_1/2`.
Columns are found by their headings. Names are matched ignoring case, spacing and punctuation. Only http/https links are kept. Nothing is
calculated from these columns. Files uploaded before this was added show no links until they are uploaded again (rows are updated, not duplicated).
The original page is opened unchanged; the website cannot highlight inside it (the user copies the value and uses Ctrl+F).


## When does an error count? (Settings -> Rules, "Count an error only after the re-audit", ON since 26 Nov 2026)
Audit finds the error -> Product Team fixes it -> re-audit checks it. With the rule on, an audited SKU's errors count only when
- the Re-Audit Comment is written ("ok / okay / done"-type words = OK, any other text = the re-auditor's notes = issues found), and
- the PT Status is not pending ("Not Updated", "Updated/Not Updated" ...): PT did not change it, so the audit itself may be wrong.
An empty PT Status is accepted. Errors that do not meet this are "not confirmed": left out of every number (error %, rankings,
champions, categories, reports) and shown separately on the Overview ("Errors not confirmed") and in the PT & Re-Audit table ("Error counted?").

## PT status texts
Each word of a combined status ("Checked/Updated", "Updated | Not Updated") is looked up in Settings: all words done = Done,
any word pending = Pending, an unknown word = Unrecognised (never guessed). | , ; & + are read like "/".

import { config } from './config.js';
import { openDb } from './db/index.js';
import { createApp } from './app.js';
import { seedReferenceData, getSettings } from './services/settings.js';
import { refreshTracking } from './services/followup.js';
import { generateDueWeeklyReports, refreshWeeklyPeriods } from './services/reports.js';
import { purgeStalePreviews, backfillProjects } from './services/importer.js';

const db = await openDb();
await seedReferenceData(db);
await backfillProjects(db);
await refreshTracking(db, await getSettings(db)); // PT / re-audit status of every record, read with the current rules (cheap; keeps old uploads in step with rule changes)
const converted = await refreshWeeklyPeriods(db); // weekly reports made when a week still ended on Sunday -> Monday to Saturday
if (converted) console.log(`[reports] ${converted} saved weekly report(s) now cover Monday to Saturday`);
const app = createApp(db);

// Weekly reports: checked every 15 minutes. A report is created once a Mon-Sat week is finished
// (from Monday at the configured hour, in the configured time zone) and stays up to date if the server was off.
async function tick() {
  try { const made = await generateDueWeeklyReports(db); if (made.length) console.log(`[reports] generated ${made.length} weekly report(s)`); await purgeStalePreviews(db); }
  catch (e) { console.error('[reports] scheduler error', e); }
}
if (config.schedulerEnabled) { setTimeout(tick, 5000); setInterval(tick, 15 * 60 * 1000).unref(); }

app.listen(config.port, () => console.log(`Audit Performance Platform running at http://localhost:${config.port}`));

import { config } from '../config.js';
import {
  getDb, insertTask, findExisting, findByIdentity, computeIdentityHash,
  reviveRow, todayLocal, updateList, ensureList
} from '../db/client.js';
import { emit } from '../sse.js';
import { pullGcx } from './gcx.js';
import { pullFathom } from './fathom.js';
import { buildCarryover } from './carryover.js';

// Two-layer dedup used by pipeline source pulls: exact (source, external_id)
// first, then identity_hash across all dates. Returns true if a pre-existing
// row makes this insertion a no-op. Side effect: if an existing row is
// dismissed (done=0), it's revived to today's list and the insert is skipped.
// Dismiss semantics: "not today, but let the source bring it back."
function shouldSkipInsert(t, today) {
  if (t.external_id) {
    const existing = findExisting(t.source, t.external_id);
    if (existing) {
      if (existing.done === 0 && existing.status === 'dismissed') {
        const revived = reviveRow(existing.id, today);
        emit('task.updated', revived);
      }
      return true;
    }
  }
  const hash = computeIdentityHash(t.task, t.project, t.source);
  const match = findByIdentity(hash);
  // Done rows block re-insertion forever (completion contract).
  // Today-list matches block duplicates within the same refresh.
  // Dismissed matches do NOT block — let the source emit a fresh row.
  if (match && (match.done === 1 || match.list_date === today)) {
    return true;
  }
  return false;
}

let inProgress = false;
let lastResult = null;

export function isRunning() { return inProgress; }
export function lastSummary() { return lastResult; }

export async function runRefresh({ skipClaudePull = false } = {}) {
  if (inProgress) throw new Error('Refresh already in progress');
  inProgress = true;
  emit('refresh.started', { at: new Date().toISOString() });

  const result = { added: { gcx: 0, fathom: 0, carryover: 0, claude: 0 },
                   errors: [], started_at: new Date().toISOString() };
  const today = todayLocal();
  ensureList(today);

  try {
    // 2. Carryover
    const { carry } = buildCarryover(today);
    for (const t of carry) {
      // Skip if already exists for today (re-running refresh same day)
      const existing = getDb().prepare(
        'SELECT id FROM tasks WHERE list_date = ? AND task = ? AND source = ?'
      ).get(today, t.task, 'carried_over');
      if (existing) continue;
      insertTask(t);
      result.added.carryover++;
    }

    // 4. GCX (skipped unless configured + a token is present)
    if (config.guidecx.enabled) try {
      const { openTasks, doneExternalIds } = await pullGcx({
        activeProjectNames: config.activeProjects,
      });
      for (const t of openTasks) {
        if (shouldSkipInsert(t, today)) continue;
        insertTask({ ...t, list_date: today });
        result.added.gcx++;
      }
      // GCX close-out pass: any task now DONE in GuideCX closes its local
      // copies (source='gcx' plus carried_over with matching external_id).
      result.closed_by_gcx = 0;
      for (const extId of doneExternalIds) {
        const updated = getDb().prepare(`
          UPDATE tasks
          SET done = 1,
              done_at = COALESCE(done_at, ?),
              updated_at = datetime('now'),
              notes = COALESCE(notes, '') || ' [closed by GCX]'
          WHERE source IN ('gcx', 'carried_over') AND external_id = ? AND done = 0
        `).run(new Date().toISOString(), extId);
        if (updated.changes > 0) result.closed_by_gcx += updated.changes;
      }
      if (result.closed_by_gcx > 0) emit('tasks.bulk_updated', { reason: 'gcx_close_out' });
    } catch (e) {
      result.errors.push(`GCX: ${e.message}`);
    }

    // 5. Fathom (skipped unless configured + an API key is present)
    if (config.fathom.enabled) try {
      const fathomTasks = await pullFathom();
      for (const t of fathomTasks) {
        if (shouldSkipInsert(t, today)) continue;
        insertTask({ ...t, list_date: today });
        result.added.fathom++;
      }
    } catch (e) {
      result.errors.push(`Fathom: ${e.message}`);
    }

    // 3, 6, 7 — headless Claude pull for Slack / Gmail / Calendar.
    // Skipped if disabled in config, or when a caller opts out (native-only run).
    if (!skipClaudePull && config.claudePullEnabled) {
      try {
        const claudeMod = await import('./claude-pull.js');
        result.added.claude = await claudeMod.runClaudePull(today);
      } catch (e) {
        result.errors.push(`Claude pull: ${e.message}`);
      }
    }

    updateList(today, { last_refreshed_at: new Date().toISOString() });
    result.finished_at = new Date().toISOString();
    lastResult = result;
    emit('refresh.completed', result);
    return result;
  } finally {
    inProgress = false;
  }
}

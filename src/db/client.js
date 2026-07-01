import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db;

export function initDb() {
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Pre-migrations: ALTER TABLE ADD COLUMN must happen BEFORE we run schema.sql,
  // because schema.sql contains CREATE INDEX statements that reference those
  // columns. On a fresh DB these ALTERs fail (no table yet) and are ignored;
  // on an existing DB they add the missing columns for later index creation.
  const alters = [
    'ALTER TABLE tasks ADD COLUMN source_url TEXT;',
    'ALTER TABLE tasks ADD COLUMN identity_hash TEXT;',
    'ALTER TABLE tasks ADD COLUMN owner_name TEXT;',
    'ALTER TABLE tasks ADD COLUMN owner_category TEXT;',
    'ALTER TABLE tasks ADD COLUMN original_source TEXT;',
  ];
  for (const sql of alters) {
    try { db.exec(sql); } catch (_) { /* column exists or table not yet created */ }
  }
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

// Normalize task text for identity hashing: lowercase, strip punctuation,
// collapse whitespace, trim. Shared by insertTask and the Fathom pull.
export function normalizeText(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Compute identity hash from normalized text + project. Source is deliberately
// excluded so a single underlying task has one hash across all its sibling
// rows (gcx original + carried_over copies + re-posts from Claude pulls).
// The `source` parameter is accepted for backwards compatibility but ignored.
// Collisions between unrelated tasks with identical text+project are possible
// at this scale but unlikely; the hash is a dedup hint, not a uniqueness
// guarantee. Manual-source callers opt out of identity dedup at the route.
export function computeIdentityHash(task, project, _source) {
  const key = `${normalizeText(task)}|${project || ''}`;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// Revive a dismissed row by un-dismissing it and moving it to today's list.
// Used when an external source re-emits a task whose local row is dismissed —
// Dismiss means "not doing this today," not "never again," so source pulls
// get to bring tasks back.
export function reviveRow(id, today) {
  getDb().prepare(`
    UPDATE tasks
    SET status = 'active',
        list_date = ?,
        updated_at = datetime('now'),
        notes = COALESCE(notes, '') || ' [revived: source re-emitted]'
    WHERE id = ?
  `).run(today, id);
  return getTask(id);
}

// Find the most recent row matching an identity_hash, ignoring source.
// Used for cross-day, source-agnostic dedup when external_id is missing or drifts.
export function findByIdentity(identityHash, { excludeId = null } = {}) {
  if (!identityHash) return null;
  const sql = `
    SELECT * FROM tasks
    WHERE identity_hash = ?
    ${excludeId != null ? 'AND id != ?' : ''}
    ORDER BY list_date DESC, id DESC
    LIMIT 1
  `;
  const params = excludeId != null ? [identityHash, excludeId] : [identityHash];
  return getDb().prepare(sql).get(...params) || null;
}

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

// Helpers — used by routes, mcp, pipeline
export function todayLocal() {
  // Today's date in the configured timezone, as YYYY-MM-DD (en-CA => ISO order).
  return new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
}

export function ensureList(date) {
  getDb().prepare('INSERT OR IGNORE INTO lists (list_date) VALUES (?)').run(date);
}

export function listTasks({ date, filter = 'open' }) {
  const sql = `
    SELECT * FROM tasks
    WHERE list_date = ?
      AND (resurface_date IS NULL OR resurface_date <= date('now'))
      ${filter === 'open' ? "AND done = 0 AND (status IS NULL OR status != 'dismissed')" : ''}
      ${filter === 'done' ? 'AND done = 1' : ''}
      ${filter === 'blocked' ? "AND status = 'blocked'" : ''}
      ${filter === 'dismissed' ? "AND status = 'dismissed'" : ''}
      ${filter === 'all' ? '' : ''}
    ORDER BY
      CASE priority
        WHEN 'must_do' THEN 1
        WHEN 'should_do' THEN 2
        WHEN 'could_do' THEN 3
        WHEN 'blocked' THEN 4
        WHEN 'personal' THEN 5
        ELSE 6
      END,
      sort_order ASC NULLS LAST,
      id ASC
  `;
  return getDb().prepare(sql).all(date);
}

export function getTask(id) {
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

export function insertTask(t) {
  ensureList(t.list_date);
  const identityHash = computeIdentityHash(t.task, t.project, t.source);
  const stmt = getDb().prepare(`
    INSERT INTO tasks (list_date, priority, task, project, source, est_minutes,
                       due_date, notes, sort_order, original_date, user_modified,
                       resurface_date, status, external_id, source_url, carry_count,
                       identity_hash, owner_name, owner_category, original_source)
    VALUES (@list_date, @priority, @task, @project, @source, @est_minutes,
            @due_date, @notes, @sort_order, @original_date, @user_modified,
            @resurface_date, @status, @external_id, @source_url, @carry_count,
            @identity_hash, @owner_name, @owner_category, @original_source)
  `);
  const result = stmt.run({
    list_date: t.list_date,
    priority: t.priority,
    task: t.task,
    project: t.project ?? null,
    source: t.source ?? null,
    est_minutes: t.est_minutes ?? null,
    due_date: t.due_date ?? null,
    notes: t.notes ?? null,
    sort_order: t.sort_order ?? null,
    original_date: t.original_date ?? null,
    user_modified: t.user_modified ?? 0,
    resurface_date: t.resurface_date ?? null,
    status: t.status ?? 'active',
    external_id: t.external_id ?? null,
    source_url: t.source_url ?? null,
    carry_count: t.carry_count ?? 0,
    identity_hash: identityHash,
    owner_name: t.owner_name ?? null,
    owner_category: t.owner_category ?? null,
    original_source: t.original_source ?? null,
  });
  return getTask(result.lastInsertRowid);
}

export function updateTask(id, patch) {
  const allowed = ['done', 'priority', 'notes', 'est_minutes', 'task',
                   'sort_order', 'resurface_date', 'status', 'project', 'due_date', 'source_url'];
  const fields = Object.keys(patch).filter(k => allowed.includes(k));
  if (fields.length === 0) return getTask(id);
  // If task/project changed, recompute identity_hash to keep dedup correct.
  let recomputeIdentity = false;
  if ('task' in patch || 'project' in patch) {
    recomputeIdentity = true;
  }
  const setSql = fields.map(f => `${f} = @${f}`).join(', ');
  const params = { id, ...patch };
  if ('done' in patch && patch.done === 1) {
    params.done_at = new Date().toISOString();
  }
  const doneAtClause = 'done' in patch && patch.done === 1 ? ', done_at = @done_at' : '';
  // When marking done, clear any stored deferral state so the row doesn't
  // stay hidden behind a future resurface_date or flagged 'deferred' after
  // it's already been completed. Skip this if the patch is explicitly
  // setting these fields itself.
  const clearDeferClause = ('done' in patch && patch.done === 1
      && !('resurface_date' in patch) && !('status' in patch))
    ? ", resurface_date = NULL, status = 'active'"
    : '';
  getDb().prepare(`
    UPDATE tasks
    SET ${setSql}, user_modified = 1, updated_at = datetime('now') ${doneAtClause} ${clearDeferClause}
    WHERE id = @id
  `).run(params);
  if (recomputeIdentity) {
    const cur = getTask(id);
    if (cur) {
      const newHash = computeIdentityHash(cur.task, cur.project, cur.source);
      getDb().prepare('UPDATE tasks SET identity_hash = ? WHERE id = ?').run(newHash, id);
    }
  }
  // Propagate done=1 and status='dismissed' across identity_hash siblings so
  // marking any one copy closes every copy (gcx/carried_over/etc.).
  propagateClosure(id, patch);
  return getTask(id);
}

// When one row is marked done or dismissed, close every other row that shares
// the same identity_hash (the same underlying task across days/sources).
function propagateClosure(id, patch) {
  const current = getTask(id);
  if (!current || !current.identity_hash) return;

  if ('done' in patch && patch.done === 1) {
    getDb().prepare(`
      UPDATE tasks
      SET done = 1,
          done_at = COALESCE(done_at, ?),
          updated_at = datetime('now'),
          notes = COALESCE(notes, '') || ' [closed via sibling]'
      WHERE identity_hash = ? AND id != ? AND done = 0
    `).run(current.done_at || new Date().toISOString(), current.identity_hash, id);
  }

  if ('status' in patch && patch.status === 'dismissed') {
    getDb().prepare(`
      UPDATE tasks
      SET status = 'dismissed',
          updated_at = datetime('now'),
          notes = COALESCE(notes, '') || ' [dismissed via sibling]'
      WHERE identity_hash = ? AND id != ? AND (status IS NULL OR status != 'dismissed')
    `).run(current.identity_hash, id);
  }
}

export function deleteTask(id) {
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function findExisting(source, external_id) {
  if (!source || !external_id) return null;
  return getDb().prepare(
    'SELECT * FROM tasks WHERE source = ? AND external_id = ? LIMIT 1'
  ).get(source, external_id);
}

export function insertMeeting(m) {
  ensureList(m.list_date);
  return getDb().prepare(`
    INSERT INTO meetings (list_date, title, start_time, end_time, duration_min, is_optional, needs_prep)
    VALUES (@list_date, @title, @start_time, @end_time, @duration_min, @is_optional, @needs_prep)
  `).run({
    list_date: m.list_date,
    title: m.title,
    start_time: m.start_time,
    end_time: m.end_time,
    duration_min: m.duration_min,
    is_optional: m.is_optional ?? 0,
    needs_prep: m.needs_prep ?? 0,
  });
}

export function clearMeetings(date) {
  getDb().prepare('DELETE FROM meetings WHERE list_date = ?').run(date);
}

export function listMeetings(date) {
  return getDb().prepare(
    'SELECT * FROM meetings WHERE list_date = ? ORDER BY start_time'
  ).all(date);
}

export function updateList(date, patch) {
  ensureList(date);
  const fields = Object.keys(patch);
  const setSql = fields.map(f => `${f} = @${f}`).join(', ');
  getDb().prepare(`UPDATE lists SET ${setSql} WHERE list_date = @date`)
    .run({ date, ...patch });
}

export function getList(date) {
  return getDb().prepare('SELECT * FROM lists WHERE list_date = ?').get(date);
}

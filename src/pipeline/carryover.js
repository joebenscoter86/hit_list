import { getDb } from '../db/client.js';

// Layer 1 regex parsing — runs first, always
export function classifyNote(notes, today) {
  if (!notes) return { status: 'active', resurface_date: null, needsLayer2: false };
  const text = notes.toLowerCase();

  if (/blocked|waiting on|dependent on/.test(text)) {
    return { status: 'blocked', resurface_date: null, needsLayer2: false };
  }
  if (/defer|push(ing)? (out|to|until)|not needed this week/.test(text)) {
    const date = parseDateRef(text, today);
    return { status: 'deferred', resurface_date: date, needsLayer2: !date };
  }
  if (/in progress|started|partially done/.test(text)) {
    return { status: 'in_progress', resurface_date: null, needsLayer2: false };
  }
  // Layer 2 candidates: notes that may have implicit deferral
  const hasDateHint = /next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}/.test(text);
  return { status: 'active', resurface_date: null, needsLayer2: hasDateHint };
}

function parseDateRef(text, today) {
  // MM/DD format
  const md = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (md) {
    const month = parseInt(md[1], 10);
    const day = parseInt(md[2], 10);
    const year = new Date(today).getFullYear();
    const candidate = new Date(year, month - 1, day);
    if (candidate < new Date(today)) candidate.setFullYear(year + 1);
    return candidate.toISOString().split('T')[0];
  }
  // Day of week
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < days.length; i++) {
    if (text.includes(days[i])) {
      const t = new Date(today);
      const diff = (i - t.getDay() + 7) % 7 || 7;
      t.setDate(t.getDate() + diff);
      return t.toISOString().split('T')[0];
    }
  }
  return null;
}

// Find most recent prior list date with tasks
export function findMostRecentPriorList(today) {
  const row = getDb().prepare(`
    SELECT DISTINCT list_date FROM tasks
    WHERE list_date < ?
    ORDER BY list_date DESC
    LIMIT 1
  `).get(today);
  return row ? row.list_date : null;
}

// Returns array of carryover tasks ready to insert into today's list
// AND a list of tasks needing Layer 2 (headless Claude) classification.
export function buildCarryover(today) {
  const prior = findMostRecentPriorList(today);
  if (!prior) return { carry: [], needsLayer2: [] };

  const open = getDb().prepare(`
    SELECT * FROM tasks
    WHERE list_date = ? AND done = 0
      AND (status IS NULL OR status != 'dismissed')
  `).all(prior);

  const carry = [];
  const needsLayer2 = [];

  for (const t of open) {
    // Respect an explicit deferral already stored on the row. If the user
    // set a future resurface_date (via the Defer action or Edit modal),
    // that is the source of truth — don't re-classify notes over it.
    if (t.resurface_date && t.resurface_date > today) continue;

    const cls = classifyNote(t.notes, today);
    // Skip deferred items (note-classified) unless the deferral target date is today
    if (cls.status === 'deferred' && cls.resurface_date && cls.resurface_date > today) continue;

    const carryCount = (t.carry_count || 0) + 1;
    const newTask = {
      list_date: today,
      priority: t.priority,
      task: t.task,
      project: t.project,
      source: 'carried_over',
      original_source: t.original_source || t.source,
      est_minutes: t.est_minutes,
      due_date: t.due_date,
      notes: t.notes,
      original_date: t.original_date || prior,
      user_modified: t.user_modified,
      // Preserve an explicit stored resurface_date over note-inferred one.
      resurface_date: t.resurface_date || cls.resurface_date,
      status: t.resurface_date ? (t.status || 'deferred') : cls.status,
      external_id: t.external_id,
    };
    newTask.carry_count = carryCount;
    carry.push(newTask);
    if (cls.needsLayer2) needsLayer2.push({ id: carry.length - 1, notes: t.notes });
  }
  return { carry, needsLayer2 };
}

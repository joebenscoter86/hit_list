import { config } from '../config.js';
import { normalizeText } from '../db/client.js';

async function fathomFetch(path) {
  const r = await fetch(`${config.fathom.apiBase}${path}`, {
    headers: { 'X-Api-Key': config.fathom.apiKey },
  });
  if (!r.ok) throw new Error(`Fathom ${path}: ${r.status}`);
  return r.json();
}

const EST_FOLLOW_UP = 20;
const EST_NUDGE = 5;

// Classify a Fathom action-item assignee into an owner category and pick a
// short display name. Returns { category, name } where category is one of
// 'me' | 'teammate' | 'external' | 'unassigned'.
//   me        => the item is assigned to you (config.userEmail)
//   teammate  => same email domain as you (config.orgDomain), i.e. a colleague
//   external  => anyone else (a client, partner, vendor, etc.)
function classifyAssignee(assignee, userEmail) {
  if (!assignee || !assignee.email) {
    return { category: 'unassigned', name: assignee?.name || null };
  }
  const email = assignee.email.toLowerCase();
  if (userEmail && email === userEmail.toLowerCase()) {
    return { category: 'me', name: assignee.name || null };
  }
  const domain = email.split('@')[1] || '';
  if (config.orgDomain && domain === config.orgDomain) {
    return { category: 'teammate', name: assignee.name || null };
  }
  return { category: 'external', name: assignee.name || null };
}

export async function pullFathom() {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().split('.')[0] + 'Z';
  const path = `/meetings?recorded_by[]=${encodeURIComponent(config.userEmail)}` +
               `&include_summary=true&include_action_items=true` +
               `&created_after=${encodeURIComponent(since)}`;
  const resp = await fathomFetch(path);
  const meetings = resp.items || [];

  const tasksOut = [];
  for (const m of meetings) {
    const meetingTitle = m.title || m.meeting_title || 'Untitled meeting';
    const actionItems = m.action_items || [];
    for (const ai of actionItems) {
      const text = typeof ai === 'string' ? ai : (ai.text || ai.description || '');
      if (!text) continue;

      const owner = typeof ai === 'object' ? classifyAssignee(ai.assignee, config.userEmail) : { category: 'unassigned', name: null };
      const isNudge = owner.category === 'teammate' || owner.category === 'external';
      const taskText = isNudge
        ? `Nudge: ${meetingTitle}: ${text}`
        : `${meetingTitle}: ${text}`;
      const notesLine = owner.name
        ? `From Fathom call: ${meetingTitle} · Owner: ${owner.name}`
        : `From Fathom call: ${meetingTitle}`;

      tasksOut.push({
        task: taskText,
        priority: 'should_do',
        project: extractProject(meetingTitle, config.activeProjects),
        source: 'fathom',
        est_minutes: isNudge ? EST_NUDGE : EST_FOLLOW_UP,
        notes: notesLine,
        source_url: m.url || null,
        owner_name: owner.name,
        owner_category: owner.category,
        external_id: `${m.id || m.recording_id}-${hashCode(normalizeText(text))}`,
      });
    }
  }
  return tasksOut;
}

function extractProject(title, projects) {
  const lower = title.toLowerCase();
  for (const p of projects) {
    if (lower.includes(p.toLowerCase())) return p;
  }
  return null;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

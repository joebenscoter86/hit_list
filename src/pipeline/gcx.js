import { config } from '../config.js';

async function gcxFetch(path) {
  const r = await fetch(`${config.guidecx.apiBase}${path}`, {
    headers: { Authorization: `Bearer ${config.guidecx.token}` },
  });
  if (!r.ok) throw new Error(`GCX ${path}: ${r.status}`);
  return r.json();
}

// Tasks whose name matches any configured keyword are never surfaced.
// Empty excludeKeywords list => nothing is excluded.
const EXCLUDE = config.excludeKeywords.length
  ? new RegExp(config.excludeKeywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
  : null;

const PRIORITY_FOR = (task) => {
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (task.status === 'STUCK') return 'must_do';
  if (due && due <= today) return 'must_do';
  // due this week (within 7 days)
  if (due && due <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) return 'should_do';
  return 'could_do';
};

const EST_FOR = () => 15; // GCX tasks default to 15 min per spec

export async function pullGcx({ activeProjectNames }) {
  // 1. Get all projects, filter to the user's active-project list
  const projects = await gcxFetch('/projects?limit=100');
  const items = Array.isArray(projects) ? projects : (projects.projects || projects.data || projects.items || []);
  const matching = items.filter(p =>
    activeProjectNames.some(name => p.name && p.name.toLowerCase().includes(name.toLowerCase()))
    && ['IN_PROGRESS', 'ON_TIME', 'LATE'].includes(p.status)
  );

  const openTasks = [];
  const doneExternalIds = [];
  for (const project of matching) {
    const templateId = project.templates?.[0]?.id || '';

    let tasks;
    try {
      const resp = await gcxFetch(`/tasks?projectId=${project.id}&include=assignee&limit=200`);
      tasks = Array.isArray(resp) ? resp : (resp.tasks || resp.data || resp.items || []);
    } catch (e) {
      console.warn(`GCX tasks for ${project.name}: ${e.message}`);
      continue;
    }

    for (const t of tasks) {
      if (EXCLUDE && EXCLUDE.test(t.name || '')) continue;

      // Collect GCX-side closures so the pipeline can close local copies,
      // regardless of due-date window.
      if (['DONE', 'NOT_APPLICABLE'].includes(t.status)) {
        doneExternalIds.push(String(t.id));
        continue;
      }

      const due = t.dueDate ? new Date(t.dueDate) : null;
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      const fiveDaysAgo = new Date(today);
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      fiveDaysAgo.setHours(0, 0, 0, 0);

      const isDueInWindow = due && due >= fiveDaysAgo && due <= today;
      if (!isDueInWindow) continue;

      const params = new URLSearchParams({
        'edit-task': 'true',
        'task-id': t.id,
        'task-tab': 'details',
        'task-type': t.type || 'regular',
      });
      if (t.milestoneId) params.set('milestone-id', t.milestoneId);
      if (templateId) {
        params.set('default-template', 'true');
        params.set('template-id', templateId);
      }

      const assigneeEmail = t.assignee?.email || null;
      const assigneeName = t.assignee?.firstName || t.assignee?.name || assigneeEmail;
      const notesParts = [];
      if (t.status === 'STUCK') notesParts.push('STUCK in GCX');
      if (!assigneeEmail) notesParts.push('Unassigned in GCX');
      else if (assigneeEmail !== config.userEmail) notesParts.push(`Assigned to ${assigneeName} in GCX`);

      openTasks.push({
        task: `${project.name}: ${t.name}`,
        priority: PRIORITY_FOR(t),
        project: project.name,
        source: 'gcx',
        est_minutes: EST_FOR(t),
        due_date: t.dueDate || null,
        notes: notesParts.length ? notesParts.join(' | ') : null,
        external_id: String(t.id),
        source_url: config.guidecx.webBaseUrl
          ? `${config.guidecx.webBaseUrl}/app/projects/${project.id}/plan?${params}`
          : null,
      });
    }
  }
  return { openTasks, doneExternalIds };
}

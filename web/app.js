/* === Hit List - App Logic === */

async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!r.ok) {
    // Prefer the server's error message over a bare status code when present.
    let msg = `${path}: ${r.status}`;
    try {
      const body = await r.json();
      if (body && body.error) msg = body.error;
    } catch { /* non-JSON body */ }
    throw new Error(msg);
  }
  return r.json();
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US',
    { hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Small colored chip indicating who owns a Fathom action item. `me` items get
// no chip (the default, it's yours). External people are amber, teammates
// purple, unassigned grey. Returns '' when no chip applies.
function ownerChip(t) {
  if (!t.owner_category || t.owner_category === 'me') return '';
  const palette = {
    external:   { bg: 'bg-amber-500/15',     text: 'text-amber-300',    icon: 'person' },
    teammate:   { bg: 'bg-purple-500/15',    text: 'text-purple-300',   icon: 'groups' },
    unassigned: { bg: 'bg-surface-container-highest', text: 'text-on-surface-variant', icon: 'help' },
  };
  const p = palette[t.owner_category] || palette.unassigned;
  const label = t.owner_name || t.owner_category.replace('_', ' ');
  return `<span class="flex items-center gap-1 text-[10px] ${p.bg} ${p.text} px-2 py-0.5 rounded font-bold tracking-tighter">
    <span class="material-symbols-outlined text-xs">${p.icon}</span> ${escapeHtml(label)}
  </span>`;
}

function sourceIcon(source) {
  const icons = { gcx: 'task_alt', fathom: 'videocam', slack: 'tag', email: 'mail' };
  return icons[source] || 'open_in_new';
}

function sourceLabel(source) {
  const labels = { gcx: 'GuideCX', fathom: 'Fathom', slack: 'Slack', email: 'Gmail', gmail: 'Gmail', calendar: 'Calendar', manual: 'Manual' };
  if (labels[source]) return labels[source];
  return source ? source.charAt(0).toUpperCase() + source.slice(1) : 'Other';
}

function summonSourceBtn(t, style = 'standard', cfg = null) {
  if (!t.source_url) return '';
  const label = `Summon Source`;
  if (style === 'personal') {
    return `<button class="summon-source-btn flex items-center gap-1 px-2 py-1 rounded border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-highest transition-all text-[9px] font-bold uppercase tracking-widest" title="Open in ${sourceLabel(t.source)}" data-url="${escapeHtml(t.source_url)}">
      <span class="material-symbols-outlined text-xs">${sourceIcon(t.source)}</span> ${label}
    </button>`;
  }
  if (style === 'blocked') {
    return `<button class="summon-source-btn flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-highest transition-all text-[10px] font-bold uppercase tracking-widest" title="Open in ${sourceLabel(t.source)}" data-url="${escapeHtml(t.source_url)}">
      <span class="material-symbols-outlined text-sm">${sourceIcon(t.source)}</span> ${label}
    </button>`;
  }
  // standard (must_do, should_do, could_do) — uses tier colors
  const border = cfg ? cfg.borderColor : 'border-outline-variant/30';
  const color = cfg ? cfg.accentColor : 'text-on-surface-variant';
  return `<button class="summon-source-btn flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded border ${border} ${color} hover:bg-surface-container-highest transition-all text-[10px] font-bold uppercase tracking-widest" title="Open in ${sourceLabel(t.source)}" data-url="${escapeHtml(t.source_url)}">
    <span class="material-symbols-outlined text-sm">${sourceIcon(t.source)}</span> ${label}
  </button>`;
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

/* ---------- Priority config ---------- */
const TIER_CONFIG = {
  must_do: {
    borderColor: 'border-error',
    accentColor: 'text-error',
    accentBg: 'border-error/50',
    icon: 'bolt',
    label: 'Critical Path',
  },
  should_do: {
    borderColor: 'border-secondary-container',
    accentColor: 'text-secondary-container',
    accentBg: 'border-secondary-container/50',
    icon: 'trending_up',
    label: 'High Priority',
  },
  could_do: {
    borderColor: 'border-tertiary-fixed',
    accentColor: 'text-tertiary-fixed',
    accentBg: 'border-tertiary-fixed/50',
    icon: 'lightbulb',
    label: 'Opportunity',
  },
  blocked: {
    borderColor: 'border-outline',
    accentColor: 'text-outline',
    accentBg: 'border-outline/50',
    icon: 'hourglass_empty',
    label: 'Waiting',
  },
  personal: {
    borderColor: 'border-primary-fixed',
    accentColor: 'text-primary-fixed',
    accentBg: 'border-primary-fixed/50',
    icon: 'person',
    label: 'Personal',
  },
};

/* ---------- Meetings ---------- */
const MEETING_ICONS = ['forum', 'code', 'payments', 'groups', 'videocam', 'calendar_today'];

function renderMeetings(meetings) {
  const el = document.getElementById('meetings');
  const metaEl = document.getElementById('meetings-meta');

  if (meetings.length === 0) {
    el.innerHTML = '<div class="tier-empty col-span-full">No meetings today</div>';
    metaEl.textContent = '';
    return;
  }

  const totalMin = meetings.reduce((sum, m) => sum + (m.duration_min || 0), 0);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const timeStr = hours > 0 ? `${hours}h ${mins > 0 ? mins + 'm' : ''}` : `${mins}m`;
  metaEl.textContent = `Total: ${timeStr} \u00B7 ${meetings.length} Session${meetings.length !== 1 ? 's' : ''} Tracked`;

  el.innerHTML = meetings.map((m, i) => {
    const icon = MEETING_ICONS[i % MEETING_ICONS.length];
    return `
    <div class="meeting-row flex items-center gap-4 px-4 py-3 rounded hover:bg-surface-container-low/50 transition-colors group">
      <span class="material-symbols-outlined text-primary-fixed/40 text-lg">${icon}</span>
      <span class="text-primary-fixed text-xs font-bold tracking-widest uppercase min-w-[80px]">${fmtTime(m.start_time)}</span>
      <span class="text-on-surface text-sm font-medium flex-grow">${escapeHtml(m.title)}</span>
      <span class="flex items-center gap-1 text-on-surface-variant text-[10px] font-bold uppercase tracking-widest">
        <span class="material-symbols-outlined text-[14px]">schedule</span> ${m.duration_min}m
      </span>
    </div>`;
  }).join('');
}

/* ---------- Project / Source Filters ---------- */
let activeFilters = new Set();
let activeSourceFilters = new Set();

function renderSourceFilter(tasks) {
  const container = document.getElementById('source-filter');
  if (!container) return;
  const sources = [...new Set(tasks.map(t => t.source || 'manual'))].sort();

  container.innerHTML = `<span class="text-on-surface-variant text-[10px] font-bold uppercase tracking-widest mr-1">Source</span>`;

  const allPill = document.createElement('button');
  allPill.className = `filter-pill ${activeSourceFilters.size === 0 ? 'active' : ''}`;
  allPill.textContent = 'All';
  allPill.addEventListener('click', () => {
    activeSourceFilters.clear();
    refilter();
  });
  container.appendChild(allPill);

  for (const src of sources) {
    const pill = document.createElement('button');
    pill.className = `filter-pill ${activeSourceFilters.has(src) ? 'active' : ''}`;
    pill.textContent = sourceLabel(src);
    pill.addEventListener('click', () => {
      if (activeSourceFilters.has(src)) activeSourceFilters.delete(src);
      else activeSourceFilters.add(src);
      refilter();
    });
    container.appendChild(pill);
  }
}

function renderProjectFilter(tasks) {
  const container = document.getElementById('project-filter');
  const projects = [...new Set(tasks.filter(t => t.project).map(t => t.project))].sort();

  // Keep the label, rebuild pills
  container.innerHTML = `<span class="text-on-surface-variant text-[10px] font-bold uppercase tracking-widest mr-1">Filter</span>`;

  const allPill = document.createElement('button');
  allPill.className = `filter-pill ${activeFilters.size === 0 ? 'active' : ''}`;
  allPill.textContent = 'All';
  allPill.addEventListener('click', () => {
    activeFilters.clear();
    refilter();
  });
  container.appendChild(allPill);

  for (const proj of projects) {
    const pill = document.createElement('button');
    pill.className = `filter-pill ${activeFilters.has(proj) ? 'active' : ''}`;
    pill.textContent = proj;
    pill.addEventListener('click', () => {
      if (activeFilters.has(proj)) {
        activeFilters.delete(proj);
      } else {
        activeFilters.add(proj);
      }
      refilter();
    });
    container.appendChild(pill);
  }
}

let _lastTasks = [];

function refilter() {
  renderProjectFilter(_lastTasks);
  renderSourceFilter(_lastTasks);
  renderTasks(filterTasks(_lastTasks));
}

function filterTasks(tasks) {
  let out = tasks;
  if (activeFilters.size > 0) out = out.filter(t => activeFilters.has(t.project));
  if (activeSourceFilters.size > 0) out = out.filter(t => activeSourceFilters.has(t.source || 'manual'));
  return out;
}

/* ---------- Tasks ---------- */
function pairedActionControls(t, cfg) {
  return `
    <div class="paired-actions flex items-center gap-2" data-id="${t.id}">
      <button class="paired-check w-9 h-9 rounded border-2 flex items-center justify-center transition-all
                     ${t.done ? 'bg-tertiary-fixed-dim border-tertiary-fixed text-on-tertiary' : 'border-tertiary-fixed text-tertiary-fixed hover:bg-tertiary-fixed-dim/20'}"
              title="Done" data-action="toggle">
        <span class="material-symbols-outlined text-base">check</span>
      </button>
      <button class="paired-dismiss w-9 h-9 rounded border-2 border-error text-error hover:bg-error/20 flex items-center justify-center transition-all"
              title="Didn't do" data-action="dismiss-paired">
        <span class="material-symbols-outlined text-base">close</span>
      </button>
    </div>
  `;
}

function renderTaskCard(t, tier) {
  const cfg = TIER_CONFIG[tier];
  const borderClass = tier === 'must_do' ? 'border-l-4' : 'border-l-2';

  // Blocked tier uses a different card style
  if (tier === 'blocked') {
    return `
    <div class="task glass-card p-5 border border-outline-variant/10 opacity-60 hover:opacity-80 transition-all ${t.done ? 'done' : ''}" data-id="${t.id}" draggable="true">
      <div class="card-inner">
        <div class="flex justify-between mb-3">
          <span class="text-[10px] ${cfg.accentColor} font-bold uppercase tracking-widest">${escapeHtml(t.project || cfg.label)}</span>
          <div class="flex items-center gap-2">
            <div class="task-actions flex gap-1">
              <button class="edit-btn text-outline hover:text-primary-fixed transition-colors" title="Edit">
                <span class="material-symbols-outlined text-sm">edit</span>
              </button>
              <button class="defer-btn text-outline hover:text-primary-fixed transition-colors" title="Defer (hide until a date)">
                <span class="material-symbols-outlined text-sm">schedule</span>
              </button>
              <button class="delete-btn text-outline hover:text-error transition-colors" title="Delete">
                <span class="material-symbols-outlined text-sm">delete</span>
              </button>
            </div>
            <span class="material-symbols-outlined ${cfg.accentColor} text-sm">${cfg.icon}</span>
          </div>
        </div>
        <div class="flex items-start gap-3">
          ${pairedActionControls(t, cfg)}
          <div class="flex-grow">
            <p class="task-text text-on-surface text-sm mb-2">${escapeHtml(t.task)}</p>
            ${t.notes
              ? `<div class="task-notes bg-surface-container-lowest/50 p-3 rounded text-xs" contenteditable="true" data-original="${escapeHtml(t.notes)}">${escapeHtml(t.notes)}</div>`
              : `<div class="task-notes empty text-xs mt-1" contenteditable="true" data-original="">+ add notes</div>`}
          </div>
        </div>
        ${t.est_minutes ? `<div class="text-[9px] font-bold ${cfg.accentColor} uppercase tracking-tighter mt-3">Est: ${t.est_minutes}m</div>` : ''}
        <div class="flex items-center gap-2 flex-wrap">
          <button class="ask-claude-btn flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-highest transition-all text-[10px] font-bold uppercase tracking-widest">
            <span class="material-symbols-outlined text-sm">chat_bubble</span> Summon Claude
          </button>
          <button class="copy-prompt-btn flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-highest transition-all text-[10px] font-bold uppercase tracking-widest">
            <span class="material-symbols-outlined text-sm">content_copy</span> Copy Prompt
          </button>
          ${summonSourceBtn(t, 'blocked')}
        </div>
      </div>
    </div>`;
  }

  // Personal tier uses a simpler checklist style
  if (tier === 'personal') {
    return `
    <div class="task flex items-center gap-3 ${t.done ? 'done' : ''}" data-id="${t.id}" draggable="true">
      <div class="card-inner flex items-center gap-3 w-full">
        ${pairedActionControls(t, cfg)}
        <span class="task-text text-sm font-medium flex-grow">${escapeHtml(t.task)}</span>
        <button class="ask-claude-btn flex items-center gap-1 px-2 py-1 rounded border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-highest transition-all text-[9px] font-bold uppercase tracking-widest">
          <span class="material-symbols-outlined text-xs">chat_bubble</span> Summon Claude
        </button>
        <button class="copy-prompt-btn flex items-center gap-1 px-2 py-1 rounded border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-highest transition-all text-[9px] font-bold uppercase tracking-widest">
          <span class="material-symbols-outlined text-xs">content_copy</span> Copy Prompt
        </button>
        ${summonSourceBtn(t, 'personal')}
        <div class="task-actions flex gap-1">
          <button class="block-btn text-outline hover:text-outline transition-colors" title="Block">
            <span class="material-symbols-outlined text-sm">block</span>
          </button>
          <button class="edit-btn text-outline hover:text-primary-fixed transition-colors" title="Edit">
            <span class="material-symbols-outlined text-sm">edit</span>
          </button>
          <button class="defer-btn text-outline hover:text-primary-fixed transition-colors" title="Defer (hide until a date)">
            <span class="material-symbols-outlined text-sm">schedule</span>
          </button>
          <button class="delete-btn text-outline hover:text-error transition-colors" title="Delete">
            <span class="material-symbols-outlined text-sm">delete</span>
          </button>
        </div>
      </div>
    </div>`;
  }

  // Standard card: must_do, should_do, could_do
  const isMust = tier === 'must_do';
  return `
  <div class="task glass-card p-${isMust ? '6' : '5'} ${borderClass} ${cfg.borderColor} shadow-${isMust ? 'lg' : 'md'} transition-all hover:bg-surface-container-high relative ${t.done ? 'done' : ''}" data-id="${t.id}" draggable="true">
    <div class="card-inner">
      <div class="flex items-start gap-4">
        ${pairedActionControls(t, cfg)}
        <div class="flex-grow">
          <div class="flex justify-between items-center mb-1">
            <span class="text-[10px] font-bold ${cfg.accentColor} uppercase tracking-widest">${escapeHtml(t.project || cfg.label)}</span>
            <div class="flex items-center gap-2">
              <div class="task-actions flex gap-1">
                <button class="block-btn ${cfg.accentColor}/50 hover:text-outline transition-colors" title="Block">
                  <span class="material-symbols-outlined text-sm">block</span>
                </button>
                <button class="edit-btn ${cfg.accentColor}/50 hover:${cfg.accentColor} transition-colors" title="Edit">
                  <span class="material-symbols-outlined text-sm">edit</span>
                </button>
                <button class="defer-btn ${cfg.accentColor}/50 hover:${cfg.accentColor} transition-colors" title="Defer (hide until a date)">
                  <span class="material-symbols-outlined text-sm">schedule</span>
                </button>
                <button class="delete-btn ${cfg.accentColor}/50 hover:text-error transition-colors" title="Delete">
                  <span class="material-symbols-outlined text-sm">delete</span>
                </button>
              </div>
              <span class="material-symbols-outlined ${cfg.accentColor}/30">${cfg.icon}</span>
            </div>
          </div>
          <p class="task-text text-on-surface text-base font-medium mb-3">${escapeHtml(t.task)}</p>
          <div class="flex items-center gap-2 mb-4">
            ${t.project ? `<span class="text-[10px] bg-surface-container-highest text-secondary px-2 py-0.5 rounded font-bold tracking-tighter">#${escapeHtml(t.project)}</span>` : ''}
            ${t.source ? `<span class="flex items-center gap-1 text-[10px] text-on-surface-variant font-bold"><span class="material-symbols-outlined text-xs">alternate_email</span> ${escapeHtml(t.source)}</span>` : ''}
            ${t.est_minutes ? `<span class="flex items-center gap-1 text-[10px] text-on-surface-variant font-bold"><span class="material-symbols-outlined text-xs">schedule</span> ${t.est_minutes}m</span>` : ''}
            ${ownerChip(t)}
          </div>
          ${t.notes
            ? `<div class="task-notes bg-surface-container-lowest/50 p-3 rounded text-xs text-on-surface-variant italic font-light" contenteditable="true" data-original="${escapeHtml(t.notes)}">${escapeHtml(t.notes)}</div>`
            : `<div class="task-notes empty text-xs" contenteditable="true" data-original="">+ add notes</div>`}
          <div class="flex items-center gap-2 flex-wrap">
            <button class="ask-claude-btn flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded border ${cfg.borderColor} ${cfg.accentColor} hover:bg-surface-container-highest transition-all text-[10px] font-bold uppercase tracking-widest">
              <span class="material-symbols-outlined text-sm">chat_bubble</span> Summon Claude
            </button>
            <button class="copy-prompt-btn flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded border ${cfg.borderColor} ${cfg.accentColor} hover:bg-surface-container-highest transition-all text-[10px] font-bold uppercase tracking-widest">
              <span class="material-symbols-outlined text-sm">content_copy</span> Copy Prompt
            </button>
            ${summonSourceBtn(t, 'standard', cfg)}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderDoneCard(t) {
  const cfg = TIER_CONFIG[t.priority] || TIER_CONFIG.should_do;
  return `
  <div class="task flex items-center gap-4 px-4 py-3 rounded hover:bg-surface-container-low/50 transition-all done opacity-50 hover:opacity-70" data-id="${t.id}" draggable="true">
    <div class="card-inner flex items-center gap-4 w-full">
      <div class="task-checkbox-visual ${cfg.accentColor}" data-action="toggle">
        <span class="material-symbols-outlined check-icon">check</span>
      </div>
      <span class="task-text text-sm line-through flex-grow">${escapeHtml(t.task)}</span>
      <span class="text-[9px] bg-surface-container-highest ${cfg.accentColor} px-2 py-0.5 rounded font-bold tracking-tighter uppercase">${t.priority.replace('_', ' ')}</span>
      ${t.project ? `<span class="text-[9px] text-on-surface-variant font-bold uppercase">${escapeHtml(t.project)}</span>` : ''}
      ${t.source_url ? `<button class="summon-source-btn text-outline hover:text-primary-fixed transition-colors" title="Open in ${sourceLabel(t.source)}" data-url="${escapeHtml(t.source_url)}">
        <span class="material-symbols-outlined text-sm">${sourceIcon(t.source)}</span>
      </button>` : ''}
      <div class="task-actions flex gap-1">
        <button class="edit-btn text-outline hover:text-primary-fixed transition-colors" title="Edit">
          <span class="material-symbols-outlined text-sm">edit</span>
        </button>
        <button class="delete-btn text-outline hover:text-error transition-colors" title="Delete">
          <span class="material-symbols-outlined text-sm">delete</span>
        </button>
      </div>
    </div>
  </div>`;
}

function renderTasks(tasks) {
  const tiers = ['must_do', 'should_do', 'could_do', 'blocked', 'personal'];
  const doneTasks = [];

  // Dismissed rows never render in the main board or the done section.
  const live = tasks.filter(t => t.status !== 'dismissed');
  for (const tier of tiers) {
    const container = document.querySelector(`.tier[data-tier="${tier}"] .tasks`);
    const subset = live.filter(t => t.priority === tier && !t.done);
    const doneInTier = live.filter(t => t.priority === tier && t.done);
    doneTasks.push(...doneInTier);

    if (subset.length === 0) {
      container.innerHTML = '<div class="tier-empty col-span-full">(none)</div>';
      continue;
    }
    container.innerHTML = subset.map(t => renderTaskCard(t, tier)).join('');
  }

  // Render Done section
  const doneContainer = document.getElementById('done-tasks');
  const doneCountEl = document.getElementById('done-count');
  if (doneTasks.length === 0) {
    doneContainer.innerHTML = '<div class="tier-empty">Nothing completed yet</div>';
    doneCountEl.textContent = '';
  } else {
    doneContainer.innerHTML = doneTasks.map(t => renderDoneCard(t)).join('');
    doneCountEl.textContent = `${doneTasks.length} completed`;
  }
}

/* ---------- Header / Hero ---------- */
function renderHeader(summary) {
  // Update subtitle with date
  const dateStr = new Date(summary.date).toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  // Stats bar
  const planned = (summary.must_do.est_minutes + summary.should_do.est_minutes + summary.could_do.est_minutes) / 60;
  document.getElementById('header-stats').textContent =
    `${dateStr}  \u00B7  Available: ${summary.available_hours.toFixed(1)} hrs  \u00B7  Planned: ${planned.toFixed(1)} hrs`;

  document.getElementById('header-meta').textContent = summary.last_refreshed_at
    ? `Last refreshed: ${new Date(summary.last_refreshed_at).toLocaleTimeString()}`
    : 'Never refreshed';

  // HUD metrics
  const totalTasks = summary.must_do.total + summary.should_do.total + summary.could_do.total;
  const doneTasks = summary.must_do.done + summary.should_do.done + summary.could_do.done;
  const activeMissions = totalTasks - doneTasks;
  const velocity = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  document.getElementById('metric-active').textContent = activeMissions;
  document.getElementById('metric-velocity').textContent = `${velocity}%`;
  document.getElementById('metric-meetings').textContent = `${summary.meeting_hours.toFixed(1)}h`;
}

/* ---------- Load All ---------- */
async function loadAll() {
  const [tasks, meetings, summary] = await Promise.all([
    api('/api/tasks?filter=all'),
    api('/api/meetings'),
    api('/api/summary'),
  ]);
  _lastTasks = tasks;
  renderHeader(summary);
  renderMeetings(meetings);
  renderProjectFilter(tasks);
  renderSourceFilter(tasks);
  renderTasks(filterTasks(tasks));
}

/* ---------- Refresh ---------- */
document.getElementById('refresh-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined text-sm animate-spin">refresh</span> REFRESHING...';
  try {
    const result = await api('/api/refresh', { method: 'POST', body: '{}' });
    const total = Object.values(result.added).reduce((a,b) => a+b, 0);
    toast(`Refresh complete: +${total} items`);
    if (result.errors.length) toast(`Errors: ${result.errors.join('; ')}`);
    await loadAll();
  } catch (e) {
    toast(`Refresh failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined text-sm">refresh</span> REFRESH';
  }
});

loadAll();

/* ---------- Inline notes editing ---------- */
document.addEventListener('focusout', async (e) => {
  if (e.target.matches('.task-notes')) {
    const taskEl = e.target.closest('.task');
    const id = taskEl.dataset.id;
    const newText = e.target.textContent.trim();
    const original = e.target.dataset.original || '';
    if (newText === original || (newText === '+ add notes' && !original)) return;
    const valueToSave = newText === '+ add notes' ? '' : newText;
    try {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ notes: valueToSave }) });
      e.target.dataset.original = valueToSave;
      e.target.classList.toggle('empty', !valueToSave);
      if (!valueToSave) e.target.textContent = '+ add notes';
    } catch (err) {
      toast(`Save failed: ${err.message}`);
    }
  }
});

/* ---------- Checkbox toggle (custom visual) ---------- */
document.addEventListener('click', async (e) => {
  const checkboxVisual = e.target.closest('[data-action="toggle"]');
  if (!checkboxVisual) return;

  const taskEl = checkboxVisual.closest('.task');
  const id = taskEl.dataset.id;
  const isDone = taskEl.classList.contains('done');
  const newDone = isDone ? 0 : 1;

  try {
    await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done: newDone }) });
    await loadAll();
  } catch (err) {
    toast(`Failed to update: ${err.message}`);
  }
});

/* ---------- Block button ---------- */
document.addEventListener('click', async (e) => {
  const blockBtn = e.target.closest('.block-btn');
  if (!blockBtn) return;

  const taskEl = blockBtn.closest('.task');
  const id = taskEl.dataset.id;

  try {
    await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ priority: 'blocked' }) });
    await loadAll();
    toast('Moved to blocked');
  } catch (err) {
    toast(`Failed to block: ${err.message}`);
  }
});

/* ---------- Defer button (quick popover) ---------- */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function openDeferPopover(anchorEl, taskId) {
  // Close any existing popover
  document.querySelectorAll('.defer-popover').forEach(el => el.remove());

  const today = new Date().toLocaleDateString('en-CA');
  const pop = document.createElement('div');
  pop.className = 'defer-popover';
  pop.innerHTML = `
    <button data-days="1">Tomorrow</button>
    <button data-days="3">+3 days</button>
    <button data-days="7">Next week</button>
    <label class="defer-custom">
      <span>Pick date</span>
      <input type="date" min="${addDays(today, 1)}">
    </label>
  `;
  // Position below the button
  const rect = anchorEl.getBoundingClientRect();
  Object.assign(pop.style, {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${Math.max(8, rect.left - 80)}px`,
    zIndex: 1000,
  });
  document.body.appendChild(pop);

  const close = () => pop.remove();
  const defer = async (dateStr) => {
    try {
      await api(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'deferred', resurface_date: dateStr }),
      });
      close();
      await loadAll();
      toast(`Deferred until ${dateStr}`);
    } catch (e) {
      toast(`Failed to defer: ${e.message}`);
    }
  };

  pop.querySelectorAll('button[data-days]').forEach(btn => {
    btn.onclick = () => defer(addDays(today, Number(btn.dataset.days)));
  });
  pop.querySelector('input[type=date]').onchange = (e) => {
    if (e.target.value) defer(e.target.value);
  };

  // Close on outside click or Escape
  setTimeout(() => {
    const outside = (ev) => {
      if (!pop.contains(ev.target)) { close(); document.removeEventListener('click', outside); }
    };
    document.addEventListener('click', outside);
  }, 0);
  document.addEventListener('keydown', function esc(ev) {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
}

document.addEventListener('click', (e) => {
  const deferBtn = e.target.closest('.defer-btn');
  if (!deferBtn) return;
  e.stopPropagation();
  const taskEl = deferBtn.closest('.task');
  openDeferPopover(deferBtn, taskEl.dataset.id);
});

/* ---------- Dismiss button ---------- */
document.addEventListener('click', async (e) => {
  const dismissBtn = e.target.closest('.dismiss-btn, .paired-dismiss');
  if (!dismissBtn) return;

  const taskEl = dismissBtn.closest('.task');
  const id = taskEl.dataset.id;

  try {
    await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) });
    await loadAll();
    toast("Dismissed \u2014 won't carry over, but will resurface if the source re-emits");
  } catch (err) {
    toast(`Failed to dismiss: ${err.message}`);
  }
});

/* ---------- Add Task Modal ---------- */
function openAddTaskModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>New Mission</h3>
      <label>Task</label>
      <input id="m-task" autofocus placeholder="What needs to get done?">
      <label>Priority</label>
      <select id="m-priority">
        <option value="must_do">Must Do</option>
        <option value="should_do" selected>Should Do</option>
        <option value="could_do">Could Do</option>
        <option value="personal">Personal</option>
        <option value="blocked">Blocked</option>
      </select>
      <label>Project (optional)</label>
      <input id="m-project" placeholder="Work, Personal, etc.">
      <label>Estimate (minutes)</label>
      <input id="m-est" type="number" value="15" min="0">
      <label>Notes</label>
      <textarea id="m-notes" placeholder="Additional context..."></textarea>
      <div class="modal-actions">
        <button class="btn-secondary" id="m-cancel">Cancel</button>
        <button class="btn-primary" id="m-save">Deploy</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#m-cancel').onclick = close;
  backdrop.querySelector('#m-save').onclick = async () => {
    const task = backdrop.querySelector('#m-task').value.trim();
    if (!task) return;
    const body = {
      task,
      priority: backdrop.querySelector('#m-priority').value,
      project: backdrop.querySelector('#m-project').value.trim() || null,
      est_minutes: Number(backdrop.querySelector('#m-est').value) || null,
      notes: backdrop.querySelector('#m-notes').value.trim() || null,
      source: 'manual',
    };
    try {
      await api('/api/tasks', { method: 'POST', body: JSON.stringify(body) });
      close();
      await loadAll();
      toast('Mission deployed');
    } catch (e) {
      toast(`Failed: ${e.message}`);
    }
  };
  // Enter key to submit
  backdrop.querySelector('#m-task').addEventListener('keydown', e => {
    if (e.key === 'Enter') backdrop.querySelector('#m-save').click();
  });
}

document.getElementById('add-task-btn').addEventListener('click', openAddTaskModal);

/* ---------- Delete with 5-second undo ---------- */
const pendingDeletes = new Map();

document.addEventListener('click', async (e) => {
  const deleteBtn = e.target.closest('.delete-btn');
  if (!deleteBtn) return;

  const taskEl = deleteBtn.closest('.task');
  const id = taskEl.dataset.id;
  if (pendingDeletes.has(id)) return;

  const taskData = await api('/api/tasks?filter=all').then(arr => arr.find(t => t.id == id));
  if (!taskData) return;
  taskEl.style.display = 'none';
  const summary = await api('/api/summary');
  renderHeader(summary);

  const undo = document.createElement('div');
  undo.className = 'toast';
  undo.innerHTML = `Deleted "${escapeHtml(taskData.task).slice(0, 30)}". <a href="#">Undo</a>`;
  document.getElementById('toast-container').appendChild(undo);

  const finalize = async () => {
    pendingDeletes.delete(id);
    try { await api(`/api/tasks/${id}`, { method: 'DELETE' }); } catch {}
    undo.remove();
  };
  const timeoutId = setTimeout(finalize, 5000);
  pendingDeletes.set(id, { timeoutId, taskData });

  undo.querySelector('a').onclick = (ev) => {
    ev.preventDefault();
    clearTimeout(timeoutId);
    pendingDeletes.delete(id);
    taskEl.style.display = '';
    undo.remove();
  };
});

/* ---------- Edit Task Modal ---------- */
async function openEditTaskModal(id) {
  const tasks = await api('/api/tasks?filter=all');
  const t = tasks.find(x => x.id == id);
  if (!t) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <h3>Edit Mission</h3>
      <label>Task</label>
      <input id="e-task" value="${escapeHtml(t.task)}">
      <label>Priority</label>
      <select id="e-priority">
        ${['must_do','should_do','could_do','personal','blocked'].map(p =>
          `<option value="${p}" ${p===t.priority?'selected':''}>${p.replace('_',' ')}</option>`).join('')}
      </select>
      <label>Project</label>
      <input id="e-project" value="${escapeHtml(t.project || '')}">
      <label>Estimate (minutes)</label>
      <input id="e-est" type="number" value="${t.est_minutes ?? ''}">
      <label>Due Date</label>
      <input id="e-due" type="date" value="${t.due_date ? t.due_date.split('T')[0] : ''}">
      <label>Resurface Date (hide until — must be in the future)</label>
      <input id="e-resurface" type="date" min="${addDays(new Date().toLocaleDateString('en-CA'), 1)}" value="${t.resurface_date || ''}">
      <label>Notes</label>
      <textarea id="e-notes">${escapeHtml(t.notes || '')}</textarea>
      <div class="modal-actions">
        <button class="btn-secondary" id="e-cancel">Cancel</button>
        <button class="btn-primary" id="e-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#e-cancel').onclick = close;
  backdrop.querySelector('#e-save').onclick = async () => {
    const body = {
      task: backdrop.querySelector('#e-task').value.trim(),
      priority: backdrop.querySelector('#e-priority').value,
      project: backdrop.querySelector('#e-project').value.trim() || null,
      est_minutes: Number(backdrop.querySelector('#e-est').value) || null,
      due_date: backdrop.querySelector('#e-due').value || null,
      resurface_date: backdrop.querySelector('#e-resurface').value || null,
      notes: backdrop.querySelector('#e-notes').value.trim() || null,
    };
    try {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      close();
      await loadAll();
      toast('Mission updated');
    } catch (e) {
      toast(`Save failed: ${e.message}`);
    }
  };
}

document.addEventListener('click', e => {
  const editBtn = e.target.closest('.edit-btn');
  if (editBtn) {
    const id = editBtn.closest('.task').dataset.id;
    openEditTaskModal(id);
  }
});

/* ---------- Ask Claude ---------- */
document.addEventListener('click', async (e) => {
  const askBtn = e.target.closest('.ask-claude-btn');
  if (!askBtn) return;

  const taskEl = askBtn.closest('.task');
  const id = taskEl.dataset.id;

  try {
    const res = await api(`/api/ask-claude/${id}`, { method: 'POST' });
    window.location.href = res.launch_uri;
    toast('Opening Claude Code...');
  } catch (err) {
    toast('Failed to build prompt. Check server logs.');
  }
});

/* ---------- Copy Prompt ---------- */
document.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('.copy-prompt-btn');
  if (!copyBtn) return;

  const taskEl = copyBtn.closest('.task');
  const id = taskEl.dataset.id;

  try {
    const res = await api(`/api/ask-claude/${id}`, { method: 'POST' });
    await navigator.clipboard.writeText(res.prompt);
    toast('Prompt copied. Paste into Claude Desktop.');
  } catch (err) {
    toast('Copy failed. Check server logs.');
  }
});

/* ---------- Summon Source ---------- */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.summon-source-btn');
  if (!btn) return;
  const url = btn.dataset.url;
  if (url) window.open(url, '_blank');
});

/* ---------- SSE Event Stream ---------- */
function startEventStream() {
  const es = new EventSource('/api/events');
  let reloadTimer;
  const debouncedReload = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadAll, 250);
  };
  es.addEventListener('task.created', () => { debouncedReload(); toast('Mission incoming'); });
  es.addEventListener('task.updated', debouncedReload);
  es.addEventListener('task.deleted', debouncedReload);
  es.addEventListener('meetings.replaced', debouncedReload);
  es.addEventListener('refresh.started', () => toast('Refresh initiated...'));
  es.addEventListener('refresh.completed', e => {
    try {
      const r = JSON.parse(e.data);
      const total = Object.values(r.added).reduce((a,b) => a+b, 0);
      toast(`Refresh complete: +${total}`);
    } catch {}
    debouncedReload();
  });
  es.onerror = () => {
    es.close();
    setTimeout(startEventStream, 3000);
  };
}
startEventStream();

/* ---------- Drag and Drop ---------- */
let draggedId = null;

document.addEventListener('dragstart', e => {
  const task = e.target.closest('.task');
  if (task) {
    draggedId = task.dataset.id;
    task.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }
});

document.addEventListener('dragend', e => {
  const task = e.target.closest('.task');
  if (task) task.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
});

document.addEventListener('dragover', e => {
  const target = e.target.closest('.task');
  if (target && target.dataset.id !== draggedId) {
    e.preventDefault();
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    target.classList.add('drag-over');
  }
});

document.addEventListener('drop', async e => {
  const target = e.target.closest('.task') || e.target.closest('.tier');
  if (!target || !draggedId) return;
  e.preventDefault();

  let newPriority = null;
  let newSortOrder = null;

  if (target.matches('.task')) {
    const tier = target.closest('.tier').dataset.tier;
    newPriority = tier;
    const tasksInTier = Array.from(target.parentElement.querySelectorAll('.task'))
      .map(el => el.dataset.id);
    const targetIndex = tasksInTier.indexOf(target.dataset.id);
    newSortOrder = targetIndex * 10;
  } else if (target.matches('.tier')) {
    newPriority = target.dataset.tier;
  }

  try {
    const body = { sort_order: newSortOrder };
    if (newPriority) body.priority = newPriority;
    await api(`/api/tasks/${draggedId}`, { method: 'PATCH', body: JSON.stringify(body) });
    await loadAll();
  } catch (err) {
    toast(`Reorder failed: ${err.message}`);
  }
  draggedId = null;
});

/* ---------- Side Nav Active State ---------- */
const sideNavLinks = document.querySelectorAll('.side-nav-link');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.id;
      sideNavLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
      });
    }
  });
}, { rootMargin: '-20% 0px -60% 0px' });

document.querySelectorAll('section[id]').forEach(section => {
  if (section.id !== 'hero') observer.observe(section);
});

/* ---------- Hero Shader Background ---------- */
/* WebGL plasma-grid animation behind the hero + header-bar.
   Scoped to the #hero-wrapper bounding box (not full viewport).
   Palette: magenta plasma lines over a near-black base to complement the
   cyan hero title. Opacity is tuned on the <canvas> element in index.html. */
(function initShaderBackground() {
  const canvas = document.getElementById('shader-bg');
  if (!canvas) return;

  const gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
  if (!gl) { console.warn('WebGL not supported; skipping hero shader.'); return; }

  const vsSource = `
    attribute vec4 aVertexPosition;
    void main() { gl_Position = aVertexPosition; }
  `;

  // Fragment shader: same plasma-grid core as the original, palette-swapped
  // for Hit List. Line color = secondary-container magenta (#fe00fe).
  // Backgrounds = very dark surface tones so the shader does not drown the UI.
  const fsSource = `
    precision highp float;
    uniform vec2 iResolution;
    uniform float iTime;

    const float overallSpeed = 0.2;
    const float gridSmoothWidth = 0.015;
    const float axisWidth = 0.05;
    const float majorLineWidth = 0.025;
    const float minorLineWidth = 0.0125;
    const float majorLineFrequency = 5.0;
    const float minorLineFrequency = 1.0;
    const float scale = 5.0;
    const vec4 lineColor = vec4(1.0, 0.0, 1.0, 1.0); // #fe00fe magenta
    const float minLineWidth = 0.01;
    const float maxLineWidth = 0.2;
    const float lineSpeed = 1.0 * overallSpeed;
    const float lineAmplitude = 1.0;
    const float lineFrequency = 0.2;
    const float warpSpeed = 0.2 * overallSpeed;
    const float warpFrequency = 0.5;
    const float warpAmplitude = 1.0;
    const float offsetFrequency = 0.5;
    const float offsetSpeed = 1.33 * overallSpeed;
    const float minOffsetSpread = 0.6;
    const float maxOffsetSpread = 2.0;
    const int linesPerGroup = 16;

    #define drawCircle(pos, radius, coord) smoothstep(radius + gridSmoothWidth, radius, length(coord - (pos)))
    #define drawSmoothLine(pos, halfWidth, t) smoothstep(halfWidth, 0.0, abs(pos - (t)))
    #define drawCrispLine(pos, halfWidth, t) smoothstep(halfWidth + gridSmoothWidth, halfWidth, abs(pos - (t)))
    #define drawPeriodicLine(freq, width, t) drawCrispLine(freq / 2.0, width, abs(mod(t, freq) - (freq) / 2.0))

    float random(float t) {
      return (cos(t) + cos(t * 1.3 + 1.3) + cos(t * 1.4 + 1.4)) / 3.0;
    }

    float getPlasmaY(float x, float horizontalFade, float offset) {
      return random(x * lineFrequency + iTime * lineSpeed) * horizontalFade * lineAmplitude + offset;
    }

    void main() {
      vec2 fragCoord = gl_FragCoord.xy;
      vec4 fragColor;
      vec2 uv = fragCoord.xy / iResolution.xy;
      vec2 space = (fragCoord - iResolution.xy / 2.0) / iResolution.x * 2.0 * scale;

      float horizontalFade = 1.0 - (cos(uv.x * 6.28) * 0.5 + 0.5);
      float verticalFade = 1.0 - (cos(uv.y * 6.28) * 0.5 + 0.5);

      space.y += random(space.x * warpFrequency + iTime * warpSpeed) * warpAmplitude * (0.5 + horizontalFade);
      space.x += random(space.y * warpFrequency + iTime * warpSpeed + 2.0) * warpAmplitude * horizontalFade;

      vec4 lines = vec4(0.0);
      // Near-black surface tones; bgColor2 has a faint magenta lift
      vec4 bgColor1 = vec4(0.063, 0.078, 0.102, 1.0); // ~ #10141a
      vec4 bgColor2 = vec4(0.15, 0.05, 0.18, 1.0);    // dim violet

      for(int l = 0; l < linesPerGroup; l++) {
        float normalizedLineIndex = float(l) / float(linesPerGroup);
        float offsetTime = iTime * offsetSpeed;
        float offsetPosition = float(l) + space.x * offsetFrequency;
        float rand = random(offsetPosition + offsetTime) * 0.5 + 0.5;
        float halfWidth = mix(minLineWidth, maxLineWidth, rand * horizontalFade) / 2.0;
        float offset = random(offsetPosition + offsetTime * (1.0 + normalizedLineIndex)) * mix(minOffsetSpread, maxOffsetSpread, horizontalFade);
        float linePosition = getPlasmaY(space.x, horizontalFade, offset);
        float line = drawSmoothLine(linePosition, halfWidth, space.y) / 2.0 + drawCrispLine(linePosition, halfWidth * 0.15, space.y);

        float circleX = mod(float(l) + iTime * lineSpeed, 25.0) - 12.0;
        vec2 circlePosition = vec2(circleX, getPlasmaY(circleX, horizontalFade, offset));
        float circle = drawCircle(circlePosition, 0.01, space) * 4.0;

        line = line + circle;
        lines += line * lineColor * rand;
      }

      fragColor = mix(bgColor1, bgColor2, uv.x);
      fragColor *= verticalFade;
      fragColor.a = 1.0;
      fragColor += lines;

      gl_FragColor = fragColor;
    }
  `;

  function loadShader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  const vs = loadShader(gl.VERTEX_SHADER, vsSource);
  const fs = loadShader(gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Shader program link error:', gl.getProgramInfoLog(program));
    return;
  }

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1.0, -1.0,  1.0, -1.0, -1.0,  1.0,  1.0,  1.0,
  ]), gl.STATIC_DRAW);

  const attribPos = gl.getAttribLocation(program, 'aVertexPosition');
  const uRes = gl.getUniformLocation(program, 'iResolution');
  const uTime = gl.getUniformLocation(program, 'iTime');

  function resize() {
    // Size canvas to its own bounding box (scoped to hero-wrapper), not window.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  // Observe the wrapper so the canvas rescales cleanly when the window resizes
  // or the sidebar collapses at the lg breakpoint.
  const ro = new ResizeObserver(resize);
  if (canvas.parentElement) ro.observe(canvas.parentElement);
  resize();

  // Pause animation when the hero is scrolled out of view to save GPU cycles.
  let visible = true;
  const io = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
  }, { threshold: 0 });
  if (canvas.parentElement) io.observe(canvas.parentElement);

  const startTime = performance.now();
  function render() {
    if (visible) {
      resize();
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, (performance.now() - startTime) / 1000);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.vertexAttribPointer(attribPos, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(attribPos);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();

// ---- Warp Log ----
let warpLogWindow = '7d';
let warpLogExpanded = { project: null, source: null };

async function fetchWarpLog() {
  const r = await fetch(`/api/warp-log?window=${warpLogWindow}`);
  return r.json();
}

function renderWarpLogPills() {
  const opts = [
    { key: '7d', label: 'Last 7 days' },
    { key: '30d', label: 'Last 30 days' },
    { key: 'ytd', label: 'Year to date' },
  ];
  return `
    <div class="flex gap-2 mb-6">
      ${opts.map(o => `
        <button class="warp-log-pill px-4 py-2 rounded text-[11px] font-bold uppercase tracking-widest border ${o.key === warpLogWindow ? 'bg-primary-fixed text-on-primary border-primary-fixed' : 'text-on-surface-variant border-outline-variant/30 hover:border-primary-fixed/50'}" data-window="${o.key}">${o.label}</button>
      `).join('')}
    </div>
  `;
}

function renderWarpLogHeadline(headline, windowLabel) {
  return `
    <div class="glass-card p-6 mb-8 border border-outline-variant/10">
      <div class="text-[10px] uppercase tracking-widest text-on-surface-variant mb-2">${escapeHtml(windowLabel)}</div>
      <div class="flex items-baseline gap-6 flex-wrap">
        <div>
          <span class="text-5xl font-headline font-bold text-primary-fixed">${headline.hours}</span>
          <span class="text-sm text-on-surface-variant ml-2 uppercase tracking-widest">hrs tracked</span>
        </div>
        <div class="text-on-surface-variant">·</div>
        <div>
          <span class="text-5xl font-headline font-bold text-secondary-fixed-dim">${headline.meeting_hours ?? 0}</span>
          <span class="text-sm text-on-surface-variant ml-2 uppercase tracking-widest">hrs meetings</span>
        </div>
        <div class="text-on-surface-variant">·</div>
        <div>
          <span class="text-3xl font-headline font-bold text-on-surface">${headline.task_count}</span>
          <span class="text-sm text-on-surface-variant ml-2 uppercase tracking-widest">tasks completed</span>
        </div>
      </div>
    </div>
  `;
}

function renderBucketTasks(tasks) {
  return `
    <div class="bg-surface-container-lowest/50 rounded p-4 mt-1 mb-2">
      <div class="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-xs">
        ${tasks.map(t => `
          <div class="text-on-surface truncate">${escapeHtml(t.task)}</div>
          <div class="text-on-surface-variant tabular-nums">${escapeHtml((t.done_at || '').slice(0, 10))}</div>
          <div class="text-on-surface-variant tabular-nums text-right">${t.est_minutes}m</div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderBreakdown(title, buckets, moduleKey) {
  if (!buckets.length) {
    return `
      <div class="glass-card p-6 mb-6 border border-outline-variant/10">
        <h2 class="text-lg font-headline font-bold text-on-surface mb-4 uppercase tracking-widest">${title}</h2>
        <p class="text-on-surface-variant text-sm italic">No completed tasks in this window.</p>
      </div>
    `;
  }
  const max = buckets[0].minutes;
  const total = buckets.reduce((sum, b) => sum + b.minutes, 0);
  const expandedLabel = warpLogExpanded[moduleKey];

  return `
    <div class="glass-card p-6 mb-6 border border-outline-variant/10">
      <h2 class="text-lg font-headline font-bold text-on-surface mb-4 uppercase tracking-widest">${title}</h2>
      <div class="flex flex-col gap-2">
        ${buckets.map(b => {
          const pct = total === 0 ? 0 : Math.round((b.minutes / total) * 100);
          const barPct = max === 0 ? 0 : Math.round((b.minutes / max) * 100);
          const hours = Math.round(b.minutes / 6) / 10;
          const isLegacy = b.label === 'Unknown (legacy)';
          const expanded = expandedLabel === b.label;
          return `
            <div class="warp-log-row" data-module="${moduleKey}" data-label="${escapeHtml(b.label)}">
              <button class="warp-log-row-btn w-full flex items-center gap-3 py-2 px-2 rounded hover:bg-surface-container-high transition-colors text-left">
                <span class="text-xs font-bold text-on-surface w-40 truncate uppercase tracking-tighter">${escapeHtml(b.label)}</span>
                <span class="flex-grow h-5 bg-surface-container-low rounded overflow-hidden">
                  <span class="block h-full ${isLegacy ? 'bg-outline-variant' : 'bg-primary-fixed'}" style="width: ${barPct}%;"></span>
                </span>
                <span class="text-xs font-bold text-on-surface w-16 text-right">${hours} hrs</span>
                <span class="text-xs text-on-surface-variant w-10 text-right">${pct}%</span>
              </button>
              ${expanded ? renderBucketTasks(b.tasks) : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function renderWarpLog() {
  const container = document.getElementById('warp-log-content');
  if (!container) return;
  container.innerHTML = '<p class="text-on-surface-variant text-sm">Loading…</p>';
  const data = await fetchWarpLog();
  container.innerHTML = `
    ${renderWarpLogPills()}
    ${renderWarpLogHeadline(data.headline, data.window.label)}
    ${renderBreakdown('By Project', data.by_project, 'project')}
    ${renderBreakdown('By Source', data.by_source, 'source')}
  `;
}

document.addEventListener('click', (e) => {
  const pill = e.target.closest('.warp-log-pill');
  if (pill) {
    warpLogWindow = pill.dataset.window;
    warpLogExpanded = { project: null, source: null };
    renderWarpLog();
    return;
  }
  const rowBtn = e.target.closest('.warp-log-row-btn');
  if (rowBtn) {
    const row = rowBtn.closest('.warp-log-row');
    const mod = row.dataset.module;
    const label = row.dataset.label;
    warpLogExpanded[mod] = warpLogExpanded[mod] === label ? null : label;
    renderWarpLog();
    return;
  }
});

// ---- Page switcher (To-Do <-> Warp Log) ----
function showPage(page) {
  document.querySelectorAll('main[data-page]').forEach(m => {
    m.classList.toggle('hidden', m.dataset.page !== page);
  });
  document.querySelectorAll('.page-nav-link').forEach(a => {
    const active = a.dataset.page === page;
    a.classList.toggle('active', active);
    a.classList.toggle('text-[#00fbfb]', active);
    a.classList.toggle('border-b-2', active);
    a.classList.toggle('border-[#00fbfb]', active);
    a.classList.toggle('text-[#b9cac9]', !active);
  });
  if (page === 'warp-log' && typeof renderWarpLog === 'function') renderWarpLog();
}

function routeFromHash() {
  const h = window.location.hash || '#/';
  if (h.startsWith('#/warp-log')) return 'warp-log';
  return 'todo';
}

window.addEventListener('hashchange', () => showPage(routeFromHash()));
showPage(routeFromHash());

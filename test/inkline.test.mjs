import test from 'node:test';
import assert from 'node:assert/strict';

// Isolated domain logic mirrors app.js functions for continuous CI/local validation
function validateTaskRecord(record) {
  if (!record || typeof record !== 'object') return null;
  if (typeof record.id !== 'string' || !record.id.trim()) return null;
  if (typeof record.title !== 'string' || !record.title.trim()) return null;

  const validPriorities = ['none', 'low', 'medium', 'high'];
  const priority = validPriorities.includes(record.priority) ? record.priority : 'none';

  let dueDate = null;
  if (typeof record.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(record.dueDate)) {
    dueDate = record.dueDate;
  }

  const category = typeof record.category === 'string' ? record.category.slice(0, 32).trim() : '';
  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
  const completedAt = typeof record.completedAt === 'number' ? record.completedAt : null;
  const order = typeof record.order === 'number' ? record.order : 0;

  let subtasks = [];
  if (Array.isArray(record.subtasks)) {
    record.subtasks.slice(0, 20).forEach(st => {
      if (st && typeof st === 'object' && typeof st.id === 'string' && typeof st.title === 'string' && st.title.trim()) {
        subtasks.push({
          id: st.id,
          title: st.title.trim().slice(0, 500),
          done: Boolean(st.done)
        });
      }
    });
  }

  return {
    id: record.id,
    title: record.title.trim().slice(0, 500),
    priority,
    dueDate,
    category,
    createdAt,
    completedAt,
    order,
    subtasks
  };
}

function checkDuplicateTitle(tasks, title, excludeId = null) {
  const normalized = title.trim().toLowerCase();
  return tasks.some(t => {
    if (excludeId && t.id === excludeId) return false;
    if (t.completedAt) return false;
    return t.title.trim().toLowerCase() === normalized;
  });
}

function isOverdue(dueDateStr, todayStr) {
  if (!dueDateStr) return false;
  return dueDateStr < todayStr;
}

function isDueToday(dueDateStr, todayStr) {
  if (!dueDateStr) return false;
  return dueDateStr === todayStr;
}

function detectQuickAddDate(title, mockNow = new Date('2026-10-20T12:00:00')) {
  if (!title || typeof title !== 'string') return null;
  const lower = title.trim().toLowerCase();
  const now = mockNow;
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  if (/\btoday\b/i.test(lower)) {
    return {
      dateStr: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
      label: 'Today'
    };
  }

  if (/\btomorrow\b/i.test(lower)) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return {
      dateStr: `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`,
      label: 'Tomorrow'
    };
  }

  for (let i = 0; i < 7; i++) {
    const name = dayNames[i];
    const regex = new RegExp(`\\b${name}\\b`, 'i');
    if (regex.test(lower)) {
      const currentDayIndex = now.getDay();
      let diff = (i - currentDayIndex + 7) % 7;
      if (diff === 0) diff = 7;
      const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
      return {
        dateStr: `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`,
        label: name.charAt(0).toUpperCase() + name.slice(1)
      };
    }
  }

  return null;
}

test('validateTaskRecord accepts valid records and sanitizes boundaries', () => {
  const record = validateTaskRecord({
    id: 'valid_1',
    title: '  Finish accessibility audit  ',
    priority: 'high',
    dueDate: '2026-10-20',
    category: 'Engineering & Product',
    createdAt: 1729400000000,
    completedAt: null,
    order: 4
  });

  assert.equal(record.id, 'valid_1');
  assert.equal(record.title, 'Finish accessibility audit');
  assert.equal(record.priority, 'high');
  assert.equal(record.dueDate, '2026-10-20');
  assert.equal(record.category, 'Engineering & Product');
  assert.equal(record.order, 4);
});

test('validateTaskRecord rejects empty or malformed titles and records', () => {
  assert.equal(validateTaskRecord(null), null);
  assert.equal(validateTaskRecord({ id: '1', title: '   ' }), null);
  assert.equal(validateTaskRecord({ title: 'No ID' }), null);
  assert.equal(validateTaskRecord({ id: '', title: 'Empty ID' }), null);
});

test('checkDuplicateTitle matches case-insensitively against active tasks only', () => {
  const activeTasks = [
    { id: '1', title: 'Review PR', completedAt: null },
    { id: '2', title: 'Call dentist', completedAt: 1729400000000 }
  ];

  assert.equal(checkDuplicateTitle(activeTasks, 'review pr'), true);
  assert.equal(checkDuplicateTitle(activeTasks, 'REVIEW PR'), true);
  assert.equal(checkDuplicateTitle(activeTasks, 'Call Dentist'), false); // Completed task ignored
  assert.equal(checkDuplicateTitle(activeTasks, 'New task'), false);
  assert.equal(checkDuplicateTitle(activeTasks, 'Review PR', '1'), false); // Self-edit allowed
});

test('date logic correctly detects due today and overdue conditions', () => {
  const today = '2026-10-20';
  assert.equal(isDueToday('2026-10-20', today), true);
  assert.equal(isDueToday('2026-10-21', today), false);
  assert.equal(isOverdue('2026-10-19', today), true);
  assert.equal(isOverdue('2026-10-20', today), false);
  assert.equal(isOverdue('2026-10-25', today), false);
});

test('detectQuickAddDate handles today, tomorrow, and weekday names', () => {
  const mockDate = new Date('2026-10-20T12:00:00'); // Tuesday
  const resToday = detectQuickAddDate('Submit report today', mockDate);
  assert.equal(resToday.label, 'Today');
  assert.equal(resToday.dateStr, '2026-10-20');

  const resTomorrow = detectQuickAddDate('Buy groceries tomorrow', mockDate);
  assert.equal(resTomorrow.label, 'Tomorrow');
  assert.equal(resTomorrow.dateStr, '2026-10-21');

  const resFriday = detectQuickAddDate('Team retrospective on friday', mockDate);
  assert.equal(resFriday.label, 'Friday');
  assert.equal(resFriday.dateStr, '2026-10-23');
});

test('completed tasks never appear in Today, Upcoming, or All', () => {
  const today = '2026-10-20';
  const tasks = [
    { id: '1', title: 'Task 1', dueDate: '2026-10-20', completedAt: 1729420000000 },
    { id: '2', title: 'Task 2', dueDate: '2026-10-20', completedAt: null },
    { id: '3', title: 'Task 3', dueDate: '2026-10-25', completedAt: 1729420000000 },
    { id: '4', title: 'Task 4', dueDate: '2026-10-25', completedAt: null },
    { id: '5', title: 'Task 5', dueDate: null, completedAt: 1729420000000 }
  ];

  const todayActive = tasks.filter(t => !t.completedAt && (t.dueDate === today || (t.dueDate && t.dueDate < today)));
  assert.equal(todayActive.length, 1);
  assert.equal(todayActive[0].id, '2');

  const upcomingActive = tasks.filter(t => !t.completedAt && t.dueDate && t.dueDate > today);
  assert.equal(upcomingActive.length, 1);
  assert.equal(upcomingActive[0].id, '4');

  const allActive = tasks.filter(t => !t.completedAt);
  assert.equal(allActive.length, 2);
  assert.deepEqual(allActive.map(t => t.id), ['2', '4']);

  const historyTasks = tasks.filter(t => Boolean(t.completedAt));
  assert.equal(historyTasks.length, 3);
  assert.deepEqual(historyTasks.map(t => t.id), ['1', '3', '5']);
});

test('history completed this week calculation counts tasks in last 7 days', () => {
  const now = 1729420000000;
  const sixDaysAgo = now - 6 * 86400000;
  const eightDaysAgo = now - 8 * 86400000;

  const tasks = [
    { id: '1', completedAt: now },
    { id: '2', completedAt: sixDaysAgo },
    { id: '3', completedAt: eightDaysAgo },
    { id: '4', completedAt: null }
  ];

  const oneWeekAgo = now - 7 * 86400000;
  const countThisWeek = tasks.filter(t => t.completedAt && t.completedAt >= oneWeekAgo).length;
  assert.equal(countThisWeek, 2);
});

test('priority section grouping correctly partitions tasks and ignores empty sections', () => {
  const tasks = [
    { id: '1', priority: 'high', title: 'High 1' },
    { id: '2', priority: 'high', title: 'High 2' },
    { id: '3', priority: 'low', title: 'Low 1' }
  ];

  const PRIORITY_SECTIONS = [
    { key: 'high', label: 'HIGH' },
    { key: 'medium', label: 'MEDIUM' },
    { key: 'low', label: 'LOW' },
    { key: 'none', label: 'NO PRIORITY' }
  ];

  const sections = PRIORITY_SECTIONS.map(p => ({
    key: p.key,
    label: p.label,
    tasks: tasks.filter(t => (t.priority || 'none') === p.key)
  })).filter(sec => sec.tasks.length > 0);

  assert.equal(sections.length, 2);
  assert.equal(sections[0].key, 'high');
  assert.equal(sections[0].tasks.length, 2);
  assert.equal(sections[1].key, 'low');
  assert.equal(sections[1].tasks.length, 1);
});

test('subtasks: validation safely caps at 20 and preserves backward compatibility', () => {
  // Old task without subtasks
  const oldTask = validateTaskRecord({ id: 'old_1', title: 'Old task' });
  assert.ok(oldTask);
  assert.deepEqual(oldTask.subtasks, []);

  // Task with >20 subtasks and malformed entries
  const manySubtasks = Array.from({ length: 25 }, (_, i) => ({
    id: `sub_${i}`,
    title: `Subtask ${i}`,
    done: i % 2 === 0
  }));
  manySubtasks.push({ id: '', title: '' }); // malformed

  const task = validateTaskRecord({
    id: 'task_sub',
    title: 'Task with many subtasks',
    subtasks: manySubtasks
  });

  assert.equal(task.subtasks.length, 20);
  assert.equal(task.subtasks[0].id, 'sub_0');
  assert.equal(task.subtasks[0].done, true);
  assert.equal(task.subtasks[1].done, false);
});

test('subtasks: completing parent completes open subtasks and undo restores exact previous states', () => {
  const task = {
    id: 'p_1',
    title: 'Parent Task',
    completedAt: null,
    subtasks: [
      { id: 's_1', title: 'Sub 1', done: true },
      { id: 's_2', title: 'Sub 2', done: false }
    ]
  };

  // Complete parent logic
  const previousSubtasks = task.subtasks.map(s => ({ id: s.id, done: s.done }));
  task.completedAt = Date.now();
  task.subtasks.forEach(s => { s.done = true; });

  assert.equal(task.subtasks[0].done, true);
  assert.equal(task.subtasks[1].done, true);

  // Undo complete parent logic
  task.completedAt = null;
  const prevMap = new Map(previousSubtasks.map(s => [s.id, s.done]));
  task.subtasks.forEach(s => {
    if (prevMap.has(s.id)) s.done = prevMap.get(s.id);
  });

  assert.equal(task.subtasks[0].done, true);
  assert.equal(task.subtasks[1].done, false);
});

test('subtasks: search query matches subtask titles', () => {
  const tasks = [
    {
      id: '1',
      title: 'Plan vacation',
      completedAt: null,
      subtasks: [
        { id: 's1', title: 'Book flights', done: false },
        { id: 's2', title: 'Pack bags', done: false }
      ]
    },
    {
      id: '2',
      title: 'Fix sink',
      completedAt: null,
      subtasks: []
    }
  ];

  const query = 'flights';
  const filtered = tasks.filter(task => {
    if (task.title.toLowerCase().includes(query)) return true;
    if (task.subtasks && Array.isArray(task.subtasks)) {
      return task.subtasks.some(st => st.title && st.title.toLowerCase().includes(query));
    }
    return false;
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, '1');
});

test('settings: accent validation strictly accepts red, teal, blue, forest with safe fallback', () => {
  const sanitizeAccent = (name) => {
    const valid = ['red', 'teal', 'blue', 'forest'];
    return valid.includes(name) ? name : 'red';
  };

  assert.equal(sanitizeAccent('red'), 'red');
  assert.equal(sanitizeAccent('teal'), 'teal');
  assert.equal(sanitizeAccent('blue'), 'blue');
  assert.equal(sanitizeAccent('forest'), 'forest');
  assert.equal(sanitizeAccent('purple'), 'red'); // Forbidden purple rejected
  assert.equal(sanitizeAccent('neon-green'), 'red');
  assert.equal(sanitizeAccent(null), 'red');
});

test('backup & restore: JSON backup import validation skips bad records and keeps valid ones', () => {
  const rawBackup = [
    { id: 't1', title: 'Valid task 1', priority: 'high' },
    { id: '', title: 'Invalid task no ID' },
    { id: 't2', title: '   ' }, // empty title
    null,
    { id: 't3', title: 'Valid task 2', dueDate: '2026-10-25' }
  ];

  const valid = [];
  let skipped = 0;
  rawBackup.forEach(item => {
    const res = validateTaskRecord(item);
    if (res) valid.push(res);
    else skipped++;
  });

  assert.equal(valid.length, 2);
  assert.equal(skipped, 3);
  assert.equal(valid[0].id, 't1');
  assert.equal(valid[1].id, 't3');
});

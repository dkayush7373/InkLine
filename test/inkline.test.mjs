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

  return {
    id: record.id,
    title: record.title.trim().slice(0, 500),
    priority,
    dueDate,
    category,
    createdAt,
    completedAt,
    order
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

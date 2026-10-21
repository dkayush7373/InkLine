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

  let dueTime = null;
  if (typeof record.dueTime === 'string' && /^\d{2}:\d{2}$/.test(record.dueTime)) {
    dueTime = record.dueTime;
  }

  const validRemind = ['none', 'due', '10m', '1h', '1d'];
  let remind = validRemind.includes(record.remind) ? record.remind : 'none';
  if (!dueDate) {
    remind = 'none';
  }

  const remindedAt = typeof record.remindedAt === 'number' ? record.remindedAt : null;
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
    dueTime,
    remind,
    remindedAt,
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

test('reminders: trigger math handles due, 10m, 1h, 1d, and 9:00 AM local default', () => {
  function getReminderTriggerTimestamp(task) {
    if (!task.dueDate || !task.remind || task.remind === 'none') return null;
    const timeStr = task.dueTime || '09:00';
    const parts = task.dueDate.split('-');
    const timeParts = timeStr.split(':');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const hours = parseInt(timeParts[0], 10);
    const minutes = parseInt(timeParts[1], 10);

    const dueTimestamp = new Date(year, month, day, hours, minutes, 0, 0).getTime();
    let offsetMs = 0;
    if (task.remind === 'due') offsetMs = 0;
    else if (task.remind === '10m') offsetMs = 10 * 60 * 1000;
    else if (task.remind === '1h') offsetMs = 60 * 60 * 1000;
    else if (task.remind === '1d') offsetMs = 24 * 60 * 60 * 1000;

    return dueTimestamp - offsetMs;
  }

  // 1. Due at exact time
  const t1 = { dueDate: '2026-10-25', dueTime: '17:00', remind: 'due' };
  const expected1 = new Date(2026, 9, 25, 17, 0, 0, 0).getTime();
  assert.equal(getReminderTriggerTimestamp(t1), expected1);

  // 2. 10 minutes before
  const t2 = { dueDate: '2026-10-25', dueTime: '17:00', remind: '10m' };
  assert.equal(getReminderTriggerTimestamp(t2), expected1 - 10 * 60 * 1000);

  // 3. 1 hour before
  const t3 = { dueDate: '2026-10-25', dueTime: '17:00', remind: '1h' };
  assert.equal(getReminderTriggerTimestamp(t3), expected1 - 60 * 60 * 1000);

  // 4. 1 day before
  const t4 = { dueDate: '2026-10-25', dueTime: '17:00', remind: '1d' };
  assert.equal(getReminderTriggerTimestamp(t4), expected1 - 24 * 60 * 60 * 1000);

  // 5. Default 9:00 AM local when no time is set
  const t5 = { dueDate: '2026-10-25', dueTime: null, remind: 'due' };
  const expectedDefault = new Date(2026, 9, 25, 9, 0, 0, 0).getTime();
  assert.equal(getReminderTriggerTimestamp(t5), expectedDefault);

  // 6. No due date disables reminder
  const t6 = validateTaskRecord({ id: 'no_due', title: 'Task', dueDate: null, remind: 'due' });
  assert.equal(t6.remind, 'none');
  assert.equal(getReminderTriggerTimestamp(t6), null);
});

test('reminders: no repeat after remindedAt, and resetting remindedAt on edit', () => {
  const task = {
    id: 't_remind',
    title: 'Dentist appointment',
    dueDate: '2026-10-25',
    dueTime: '10:00',
    remind: 'due',
    remindedAt: 1729800000000,
    completedAt: null
  };

  // Simulating checkReminders eligibility:
  const isEligible = (t) => !t.completedAt && t.remind && t.remind !== 'none' && !t.remindedAt;
  assert.equal(isEligible(task), false); // Already reminded

  // Completing task cancels reminder eligibility
  task.remindedAt = null;
  task.completedAt = Date.now();
  assert.equal(isEligible(task), false);

  // Reopening and editing resets remindedAt
  task.completedAt = null;
  task.remindedAt = Date.now();
  // User edits due time
  task.dueTime = '11:00';
  task.remindedAt = null;
  assert.equal(isEligible(task), true);
});

test('swipe gestures: evaluateSwipeGesture pure function threshold logic', () => {
  function evaluateSwipeGesture(deltaX, isHistory = false) {
    const THRESHOLD = 80;
    if (deltaX >= THRESHOLD) {
      return isHistory ? 'restore' : 'complete';
    } else if (deltaX <= -THRESHOLD) {
      return 'delete';
    }
    return 'spring-back';
  }

  // Active tasks
  assert.equal(evaluateSwipeGesture(80, false), 'complete');
  assert.equal(evaluateSwipeGesture(120, false), 'complete');
  assert.equal(evaluateSwipeGesture(-80, false), 'delete');
  assert.equal(evaluateSwipeGesture(-100, false), 'delete');
  assert.equal(evaluateSwipeGesture(79, false), 'spring-back');
  assert.equal(evaluateSwipeGesture(-79, false), 'spring-back');
  assert.equal(evaluateSwipeGesture(0, false), 'spring-back');

  // History tasks
  assert.equal(evaluateSwipeGesture(80, true), 'restore');
  assert.equal(evaluateSwipeGesture(150, true), 'restore');
  assert.equal(evaluateSwipeGesture(-80, true), 'delete');
  assert.equal(evaluateSwipeGesture(-95, true), 'delete');
  assert.equal(evaluateSwipeGesture(60, true), 'spring-back');
});

test('focus timer: duration validation, formatting, and end-time math', () => {
  function formatTimerDigits(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function calculateTimerProgress(remainingMs, totalMs) {
    if (!totalMs || totalMs <= 0) return 0;
    return Math.max(0, Math.min(1, (totalMs - remainingMs) / totalMs));
  }

  function calculateRemainingMs(endTimestamp, now = Date.now()) {
    if (!endTimestamp) return 0;
    return Math.max(0, endTimestamp - now);
  }

  function validateCustomMinutes(val) {
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 1 || num > 180) return null;
    return num;
  }

  // 1. Digits formatting
  assert.equal(formatTimerDigits(25 * 60 * 1000), '25:00');
  assert.equal(formatTimerDigits(5 * 60 * 1000), '05:00');
  assert.equal(formatTimerDigits(45 * 1000), '00:45');
  assert.equal(formatTimerDigits(0), '00:00');
  assert.equal(formatTimerDigits(-500), '00:00');

  // 2. Custom minutes validation (1 to 180)
  assert.equal(validateCustomMinutes(25), 25);
  assert.equal(validateCustomMinutes('1'), 1);
  assert.equal(validateCustomMinutes('180'), 180);
  assert.equal(validateCustomMinutes('0'), null);
  assert.equal(validateCustomMinutes('-10'), null);
  assert.equal(validateCustomMinutes('181'), null);
  assert.equal(validateCustomMinutes('abc'), null);

  // 3. Progress computation
  assert.equal(calculateTimerProgress(25 * 60 * 1000, 25 * 60 * 1000), 0);
  assert.equal(calculateTimerProgress(0, 25 * 60 * 1000), 1);
  assert.equal(calculateTimerProgress(12.5 * 60 * 1000, 25 * 60 * 1000), 0.5);

  // 4. End timestamp math
  const startNow = 1000000;
  const endTimestamp = startNow + 25 * 60 * 1000;
  assert.equal(calculateRemainingMs(endTimestamp, startNow), 25 * 60 * 1000);
  assert.equal(calculateRemainingMs(endTimestamp, startNow + 10 * 60 * 1000), 15 * 60 * 1000);
  assert.equal(calculateRemainingMs(endTimestamp, endTimestamp + 5000), 0); // Stops at 0 after time ends
});

test('music and ambient sounds: audio file constraints and storage formatting', () => {
  const MAX_CUSTOM_FILES = 10;
  const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
  const MAX_TOTAL_SIZE_BYTES = 60 * 1024 * 1024; // 60 MB

  function validateAudioFileConstraint(file, existingTracks = []) {
    if (!file) return { valid: false, error: 'No file selected.' };
    if (existingTracks.length >= MAX_CUSTOM_FILES) {
      return { valid: false, error: 'Storage limit reached. You can store up to 10 tracks.' };
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { valid: false, error: `"${file.name}" is larger than the 15 MB limit.` };
    }
    const currentTotal = existingTracks.reduce((sum, t) => sum + (t.size || 0), 0);
    if (currentTotal + file.size > MAX_TOTAL_SIZE_BYTES) {
      return { valid: false, error: 'Total storage limit of 60 MB exceeded.' };
    }
    return { valid: true };
  }

  function formatStorageUsage(tracks = []) {
    const count = tracks.length;
    const totalBytes = tracks.reduce((sum, t) => sum + (t.size || 0), 0);
    const mb = (totalBytes / (1024 * 1024)).toFixed(1);
    return `Used ${mb} MB of 60 MB (${count} of ${MAX_CUSTOM_FILES} tracks)`;
  }

  // 1. Valid file acceptance
  const validFile = { name: 'study.mp3', size: 5 * 1024 * 1024 };
  assert.equal(validateAudioFileConstraint(validFile, []).valid, true);

  // 2. Reject file exceeding 15MB limit
  const bigFile = { name: 'huge_album.wav', size: 16 * 1024 * 1024 };
  const bigRes = validateAudioFileConstraint(bigFile, []);
  assert.equal(bigRes.valid, false);
  assert.match(bigRes.error, /larger than the 15 MB limit/);

  // 3. Reject when max 10 files limit reached
  const tenTracks = Array.from({ length: 10 }, (_, i) => ({ id: `t_${i}`, size: 1024 * 1024 }));
  const countRes = validateAudioFileConstraint(validFile, tenTracks);
  assert.equal(countRes.valid, false);
  assert.match(countRes.error, /up to 10 tracks/);

  // 4. Reject when total storage limit 60MB exceeded
  const fourTracksAt58MB = [
    { id: '1', size: 15 * 1024 * 1024 },
    { id: '2', size: 15 * 1024 * 1024 },
    { id: '3', size: 15 * 1024 * 1024 },
    { id: '4', size: 13 * 1024 * 1024 } // total 58MB
  ];
  const fileExceeding60MB = { name: 'track5.mp3', size: 4 * 1024 * 1024 }; // 58 + 4 = 62MB > 60MB
  const totalRes = validateAudioFileConstraint(fileExceeding60MB, fourTracksAt58MB);
  assert.equal(totalRes.valid, false);
  assert.match(totalRes.error, /60 MB exceeded/);

  // 5. Storage display string formatting
  assert.equal(formatStorageUsage([]), 'Used 0.0 MB of 60 MB (0 of 10 tracks)');
  assert.equal(formatStorageUsage([{ size: 10 * 1024 * 1024 }]), 'Used 10.0 MB of 60 MB (1 of 10 tracks)');
});




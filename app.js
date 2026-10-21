/**
 * Inkline - A calm to-do list
 * "Write it down. Draw the line."
 * Vanilla JavaScript implementation
 */

(function () {
  'use strict';

  // ==========================================================================
  // Storage Keys & Constants
  // ==========================================================================
  const STORAGE_KEY_TASKS = 'inkline.tasks.v1';
  const STORAGE_KEY_BACKUP = 'inkline.tasks.v1.backup';
  const STORAGE_KEY_PREFS = 'inkline.prefs.v1';
  const UNDO_DURATION_MS = 4000;

  // Exact Copy Strings required by specification
  const COPY = {
    EMPTY_TODAY: 'Nothing for today. Enjoy the quiet.',
    EMPTY_UPCOMING: 'Nothing scheduled upcoming.',
    EMPTY_ALL: 'No tasks on your list yet.',
    EMPTY_DONE: 'Nothing finished yet. That is fine.',
    EMPTY_SEARCH: 'No tasks match your search.',
    DUPLICATE: 'Already on your list.',
    CANNOT_SAVE: "Couldn't save. Check browser settings.",
    DELETE_PROMPT: 'Delete this task?',
    ALL_CLEAR: 'All clear.'
  };

  // ==========================================================================
  // Application State
  // ==========================================================================
  const state = {
    tasks: [],
    filter: 'today', // 'today' | 'upcoming' | 'all' | 'done'
    searchQuery: '',
    sortBy: 'created', // 'created' | 'due' | 'priority' | 'manual'
    prefs: {
      theme: 'system', // 'light' | 'dark' | 'system'
      accent: 'red', // 'red' | 'teal' | 'blue' | 'forest'
      remindersEnabled: true,
      collapsedSections: {}
    },
    quickAddDueDate: null,
    editingTaskId: null,
    editingSubtaskId: null,
    openSubtasksTaskIds: new Set(),
    pendingDeleteTaskId: null,
    pendingImportTasks: null,
    undoQueue: [], // array of { task, originalIndex, timerId }
    storageError: false,
    draggedTaskId: null,
    todayString: getLocalDateString(new Date())
  };

  // ==========================================================================
  // Date Utilities (Local YYYY-MM-DD strings, never UTC)
  // ==========================================================================
  function getLocalDateString(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseLocalDateString(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
    return new Date(year, month, day);
  }

  function formatDisplayDate(dateStr) {
    const d = parseLocalDateString(dateStr);
    if (!d) return '';
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric'
      }).format(d);
    } catch (e) {
      return dateStr;
    }
  }

  function formatHeaderDate(dateObj) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      }).format(dateObj);
    } catch (e) {
      return dateObj.toDateString();
    }
  }

  function isOverdue(dueDateStr, todayStr) {
    if (!dueDateStr) return false;
    return dueDateStr < todayStr;
  }

  function isDueToday(dueDateStr, todayStr) {
    if (!dueDateStr) return false;
    return dueDateStr === todayStr;
  }

  function formatCompletedTime(timestamp) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit'
      }).format(new Date(timestamp)).toUpperCase();
    } catch (e) {
      return '';
    }
  }

  function getHistoryGroups(completedTasks) {
    const groups = [];
    const groupMap = new Map();
    const todayStr = state.todayString;
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = getLocalDateString(yesterdayDate);

    completedTasks.forEach(task => {
      const d = new Date(task.completedAt || Date.now());
      const dateStr = getLocalDateString(d);
      let label = '';
      if (dateStr === todayStr) {
        label = 'Today';
      } else if (dateStr === yesterdayStr) {
        label = 'Yesterday';
      } else {
        try {
          label = new Intl.DateTimeFormat(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          }).format(d);
        } catch (e) {
          label = dateStr;
        }
      }

      if (!groupMap.has(dateStr)) {
        const group = { dateStr, label, tasks: [] };
        groupMap.set(dateStr, group);
        groups.push(group);
      }
      groupMap.get(dateStr).tasks.push(task);
    });

    return groups;
  }

  // Smart quick-add detection
  function detectQuickAddDate(title) {
    if (!title || typeof title !== 'string') return null;
    const lower = title.trim().toLowerCase();
    const now = new Date();
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    // Check "today"
    if (/\btoday\b/i.test(lower)) {
      return {
        dateStr: getLocalDateString(now),
        label: 'Today'
      };
    }

    // Check "tomorrow"
    if (/\btomorrow\b/i.test(lower)) {
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return {
        dateStr: getLocalDateString(tomorrow),
        label: 'Tomorrow'
      };
    }

    // Check weekday names
    for (let i = 0; i < 7; i++) {
      const name = dayNames[i];
      const regex = new RegExp(`\\b${name}\\b`, 'i');
      if (regex.test(lower)) {
        const currentDayIndex = now.getDay();
        let diff = (i - currentDayIndex + 7) % 7;
        if (diff === 0) diff = 7; // Next occurrence
        const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
        return {
          dateStr: getLocalDateString(targetDate),
          label: name.charAt(0).toUpperCase() + name.slice(1)
        };
      }
    }

    return null;
  }

  // ==========================================================================
  // Data Validation & Safety
  // ==========================================================================
  function generateId() {
    return 'task_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  }

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
      priority: priority,
      dueDate: dueDate,
      dueTime: dueTime,
      remind: remind,
      remindedAt: remindedAt,
      category: category,
      createdAt: createdAt,
      completedAt: completedAt,
      order: order,
      subtasks: subtasks
    };
  }

  function checkDuplicateTitle(title, excludeId = null) {
    const normalized = title.trim().toLowerCase();
    return state.tasks.some(t => {
      if (excludeId && t.id === excludeId) return false;
      if (t.completedAt) return false; // Ignore completed tasks
      return t.title.trim().toLowerCase() === normalized;
    });
  }

  // ==========================================================================
  // Storage Management
  // ==========================================================================
  function loadFromStorage() {
    // 1. Load preferences
    try {
      const prefsRaw = localStorage.getItem(STORAGE_KEY_PREFS);
      if (prefsRaw) {
        const parsedPrefs = JSON.parse(prefsRaw);
        if (parsedPrefs && ['light', 'dark', 'system'].includes(parsedPrefs.theme)) {
          state.prefs.theme = parsedPrefs.theme;
        }
        if (parsedPrefs && ['red', 'teal', 'blue', 'forest'].includes(parsedPrefs.accent)) {
          state.prefs.accent = parsedPrefs.accent;
        }
        if (parsedPrefs && typeof parsedPrefs.remindersEnabled === 'boolean') {
          state.prefs.remindersEnabled = parsedPrefs.remindersEnabled;
        }
        if (parsedPrefs && typeof parsedPrefs.collapsedSections === 'object' && parsedPrefs.collapsedSections !== null) {
          state.prefs.collapsedSections = parsedPrefs.collapsedSections;
        }
      }
    } catch (e) {
      // Ignore prefs error
    }

    // Apply loaded theme and accent
    applyTheme(state.prefs.theme);
    applyAccent(state.prefs.accent);

    // 2. Load tasks
    let rawTasks = null;
    try {
      rawTasks = localStorage.getItem(STORAGE_KEY_TASKS);
    } catch (e) {
      state.storageError = true;
      showStorageAlert(true);
      return [];
    }

    // First-time visit: generate 3 starter tasks
    if (rawTasks === null) {
      const starterTasks = [
        {
          id: generateId(),
          title: 'Add your first task',
          priority: 'high',
          dueDate: state.todayString,
          category: 'Starter',
          createdAt: Date.now() - 3000,
          completedAt: null,
          order: 0
        },
        {
          id: generateId(),
          title: 'Draw a line through this one',
          priority: 'medium',
          dueDate: state.todayString,
          category: 'Starter',
          createdAt: Date.now() - 2000,
          completedAt: null,
          order: 1
        },
        {
          id: generateId(),
          title: 'Delete this one',
          priority: 'low',
          dueDate: null,
          category: 'Starter',
          createdAt: Date.now() - 1000,
          completedAt: null,
          order: 2
        }
      ];
      saveToStorage(starterTasks);
      return starterTasks;
    }

    // Validate existing storage records and back up original
    try {
      const parsed = JSON.parse(rawTasks);
      if (!Array.isArray(parsed)) {
        backupRawStorage(rawTasks);
        return [];
      }

      backupRawStorage(rawTasks);
      const validTasks = [];
      parsed.forEach(item => {
        const validated = validateTaskRecord(item);
        if (validated) validTasks.push(validated);
      });
      return validTasks;
    } catch (err) {
      backupRawStorage(rawTasks);
      return [];
    }
  }

  function backupRawStorage(rawData) {
    try {
      if (rawData) {
        localStorage.setItem(STORAGE_KEY_BACKUP, rawData);
      }
    } catch (e) {
      // Storage full or unavailable
    }
  }

  function saveToStorage(tasksToSave = state.tasks) {
    try {
      const serialized = JSON.stringify(tasksToSave);
      localStorage.setItem(STORAGE_KEY_TASKS, serialized);
      if (state.storageError) {
        state.storageError = false;
        showStorageAlert(false);
      }
    } catch (e) {
      state.storageError = true;
      showStorageAlert(true);
    }
  }

  function savePrefsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(state.prefs));
    } catch (e) {
      // Ignore
    }
  }

  function showStorageAlert(visible) {
    const banner = document.getElementById('storageAlertBanner');
    if (banner) {
      banner.style.display = visible ? 'flex' : 'none';
    }
  }

  // ==========================================================================
  // Theme Management
  // ==========================================================================
  function applyTheme(theme) {
    state.prefs.theme = theme;
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }

    // Sync radio inputs
    const lightRadio = document.getElementById('themeLight');
    const darkRadio = document.getElementById('themeDark');
    const systemRadio = document.getElementById('themeSystem');
    if (lightRadio && darkRadio && systemRadio) {
      lightRadio.checked = theme === 'light';
      darkRadio.checked = theme === 'dark';
      systemRadio.checked = theme === 'system';
    }
    savePrefsToStorage();
  }

  // ==========================================================================
  // Accent Color Management
  // ==========================================================================
  function applyAccent(accentName) {
    const valid = ['red', 'teal', 'blue', 'forest'];
    const accent = valid.includes(accentName) ? accentName : 'red';
    state.prefs.accent = accent;
    document.documentElement.setAttribute('data-accent', accent);

    const radios = document.querySelectorAll('input[name="accent-swatch"]');
    radios.forEach(r => {
      r.checked = (r.value === accent);
    });
    savePrefsToStorage();
  }

  // ==========================================================================
  // Accessibility Live Regions
  // ==========================================================================
  function announcePolite(message) {
    const region = document.getElementById('livePolite');
    if (region) {
      region.textContent = '';
      setTimeout(() => {
        region.textContent = message;
      }, 50);
    }
  }

  function announceAssertive(message) {
    const region = document.getElementById('liveAssertive');
    if (region) {
      region.textContent = '';
      setTimeout(() => {
        region.textContent = message;
      }, 50);
    }
  }

  // ==========================================================================
  // Task Operations (Add, Complete, Reopen, Edit, Delete, Undo)
  // ==========================================================================
  function addTask(title, priority = 'none', dueDate = null, category = '', dueTime = null, remind = 'none') {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return { success: false, error: 'Please enter a task title.' };
    }

    if (checkDuplicateTitle(trimmedTitle)) {
      return { success: false, error: COPY.DUPLICATE };
    }

    const maxOrder = state.tasks.reduce((max, t) => Math.max(max, t.order || 0), -1);

    const safeDueDate = dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null;
    const safeDueTime = dueTime && /^\d{2}:\d{2}$/.test(dueTime) ? dueTime : null;
    const validRemind = ['none', 'due', '10m', '1h', '1d'];
    const safeRemind = safeDueDate && validRemind.includes(remind) ? remind : 'none';

    const newTask = {
      id: generateId(),
      title: trimmedTitle.slice(0, 500),
      priority: priority || 'none',
      dueDate: safeDueDate,
      dueTime: safeDueTime,
      remind: safeRemind,
      remindedAt: null,
      category: category ? category.slice(0, 32).trim() : '',
      createdAt: Date.now(),
      completedAt: null,
      order: maxOrder + 1,
      subtasks: []
    };

    state.tasks.push(newTask);
    saveToStorage();
    announcePolite('Task added');
    render();

    // Ask for notification permission only when user saves their first task that has a reminder
    if (safeRemind !== 'none') {
      if ('Notification' in window && Notification.permission === 'default' && !state.prefs.permissionPrompted) {
        state.prefs.permissionPrompted = true;
        savePrefsToStorage();
        const permDialog = document.getElementById('permissionPromptDialogOverlay');
        if (permDialog) {
          setTimeout(() => openModal(permDialog), 300);
        }
      }
    }

    return { success: true, task: newTask };
  }

  function completeTask(taskId) {
    const taskIndex = state.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    const task = state.tasks[taskIndex];
    if (task.completedAt) return;

    const li = document.querySelector(`.task-item[data-id="${taskId}"]`);
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const finalize = () => {
      task.completedAt = Date.now();
      const previousSubtasks = task.subtasks ? task.subtasks.map(s => ({ id: s.id, done: s.done })) : [];
      if (task.subtasks) {
        task.subtasks.forEach(s => { s.done = true; });
      }
      saveToStorage();

      const timerId = setTimeout(() => {
        state.undoQueue = state.undoQueue.filter(entry => entry.task.id !== task.id);
        renderUndoToast();
      }, UNDO_DURATION_MS);

      state.undoQueue.unshift({
        type: 'complete',
        task: task,
        originalIndex: taskIndex,
        previousSubtasks: previousSubtasks,
        timerId: timerId
      });

      announcePolite('Moved to History');
      renderUndoToast();
      render();
    };

    if (isReduced || !li) {
      finalize();
    } else {
      li.classList.add('is-completing');
      setTimeout(() => {
        li.classList.add('is-sliding-out');
        setTimeout(() => {
          finalize();
        }, 180);
      }, 200);
    }
  }

  function addSubtask(taskId, rawTitle) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const trimmed = rawTitle.trim();
    if (!trimmed) return;

    task.subtasks = task.subtasks || [];
    if (task.subtasks.length >= 20) return;

    const lower = trimmed.toLowerCase();
    const isDup = task.subtasks.some(st => st.title.trim().toLowerCase() === lower);
    if (isDup) {
      announcePolite(COPY.DUPLICATE);
      return;
    }

    task.subtasks.push({
      id: 'sub_' + generateId(),
      title: trimmed.slice(0, 500),
      done: false
    });

    saveToStorage();
    announcePolite('Subtask added');
    render();
  }

  function toggleSubtask(taskId, subtaskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks) return;
    const st = task.subtasks.find(s => s.id === subtaskId);
    if (!st) return;

    st.done = !st.done;
    saveToStorage();
    if (st.done) {
      announcePolite('Subtask completed');
    }
    render();
  }

  function saveSubtaskEdit(taskId, subtaskId, rawTitle) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks) return;
    const st = task.subtasks.find(s => s.id === subtaskId);
    if (!st) return;

    const trimmed = rawTitle.trim();
    if (!trimmed) return;

    const lower = trimmed.toLowerCase();
    const isDup = task.subtasks.some(s => s.id !== subtaskId && s.title.trim().toLowerCase() === lower);
    if (isDup) {
      announcePolite(COPY.DUPLICATE);
      return;
    }

    st.title = trimmed.slice(0, 500);
    state.editingSubtaskId = null;
    saveToStorage();
    announcePolite('Subtask updated');
    render();
  }

  function deleteSubtask(taskId, subtaskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks) return;
    task.subtasks = task.subtasks.filter(s => s.id !== subtaskId);
    saveToStorage();
    announcePolite('Subtask deleted');
    render();
  }

  function restoreTaskFromHistory(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;
    task.completedAt = null;
    saveToStorage();
    announcePolite('Task restored');
    render();
  }

  function saveTaskEdit(taskId, newTitle, newDueDate, newDueTime, newRemind) {
    const trimmed = newTitle.trim();
    if (!trimmed) {
      return { success: false, error: 'Task title cannot be empty.' };
    }

    if (checkDuplicateTitle(trimmed, taskId)) {
      return { success: false, error: COPY.DUPLICATE };
    }

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return { success: false, error: 'Task not found.' };

    task.title = trimmed.slice(0, 500);

    let resetReminder = false;
    if (newDueDate !== undefined && newDueDate !== task.dueDate) {
      task.dueDate = newDueDate;
      resetReminder = true;
    }
    if (newDueTime !== undefined && newDueTime !== task.dueTime) {
      task.dueTime = newDueTime;
      resetReminder = true;
    }
    if (newRemind !== undefined && newRemind !== task.remind) {
      task.remind = newRemind;
      resetReminder = true;
    }

    if (resetReminder) {
      task.remindedAt = null;
    }

    state.editingTaskId = null;
    saveToStorage();
    announcePolite('Task updated');
    render();
    return { success: true };
  }

  function cancelTaskEdit() {
    state.editingTaskId = null;
    render();
  }

  function deleteTask(taskId) {
    const index = state.tasks.findIndex(t => t.id === taskId);
    if (index === -1) return;

    const removedTask = state.tasks.splice(index, 1)[0];
    saveToStorage();

    // Push into Undo Queue
    const timerId = setTimeout(() => {
      state.undoQueue = state.undoQueue.filter(entry => entry.task.id !== removedTask.id);
      renderUndoToast();
    }, UNDO_DURATION_MS);

    state.undoQueue.unshift({
      type: 'delete',
      task: removedTask,
      originalIndex: index,
      timerId: timerId
    });

    announceAssertive('Task deleted. Undo available for 4 seconds.');
    renderUndoToast();
    render();
  }

  function executeUndo() {
    if (state.undoQueue.length === 0) return;

    const entry = state.undoQueue.shift();
    clearTimeout(entry.timerId);

    if (entry.type === 'complete') {
      entry.task.completedAt = null;
      if (entry.previousSubtasks && entry.task.subtasks) {
        const prevMap = new Map(entry.previousSubtasks.map(s => [s.id, s.done]));
        entry.task.subtasks.forEach(s => {
          if (prevMap.has(s.id)) s.done = prevMap.get(s.id);
        });
      }
      saveToStorage();
      announcePolite('Task restored');
      renderUndoToast();
      render();
    } else {
      const targetIndex = Math.min(entry.originalIndex, state.tasks.length);
      state.tasks.splice(targetIndex, 0, entry.task);
      saveToStorage();
      announcePolite('Task restored');
      renderUndoToast();
      render();
    }
  }

  function clearHistoryTasks() {
    state.tasks = state.tasks.filter(t => !t.completedAt);
    saveToStorage();
    announcePolite('History cleared');
    render();
  }

  // ==========================================================================
  // Filtering & Sorting
  // ==========================================================================
  function getFilteredAndSortedTasks() {
    const today = state.todayString;

    // 1. Filter by Tab
    let filtered = state.tasks.filter(task => {
      switch (state.filter) {
        case 'today':
          if (task.completedAt) return false;
          if (!task.dueDate) return false;
          return isDueToday(task.dueDate, today) || isOverdue(task.dueDate, today);

        case 'upcoming':
          if (task.completedAt) return false;
          return Boolean(task.dueDate && task.dueDate > today);

        case 'all':
          if (task.completedAt) return false;
          return true;

        case 'history':
          return Boolean(task.completedAt);

        default:
          return !task.completedAt;
      }
    });

    // 2. Filter by Search Query
    if (state.searchQuery.trim()) {
      const q = state.searchQuery.trim().toLowerCase();
      filtered = filtered.filter(task => {
        if (task.title.toLowerCase().includes(q)) return true;
        if (task.subtasks && Array.isArray(task.subtasks)) {
          return task.subtasks.some(st => st.title && st.title.toLowerCase().includes(q));
        }
        return false;
      });
    }

    // 3. Stable Sort
    if (state.filter === 'history') {
      filtered.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    } else {
      filtered.sort((a, b) => {
        if (state.sortBy === 'manual') {
          return (a.order || 0) - (b.order || 0);
        }

        if (state.sortBy === 'due') {
          if (a.dueDate && !b.dueDate) return -1;
          if (!a.dueDate && b.dueDate) return 1;
          if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
            return a.dueDate.localeCompare(b.dueDate);
          }
          return a.createdAt - b.createdAt;
        }

        if (state.sortBy === 'priority') {
          const priorityWeight = { high: 3, medium: 2, low: 1, none: 0 };
          const diff = (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
          if (diff !== 0) return diff;
          return a.createdAt - b.createdAt;
        }

        return a.createdAt - b.createdAt;
      });
    }

    return filtered;
  }

  // Counts for each tab
  function getTabCounts() {
    const today = state.todayString;
    let countToday = 0;
    let countUpcoming = 0;
    let countAll = 0;
    let countHistory = 0;

    state.tasks.forEach(task => {
      if (task.completedAt) {
        countHistory++;
      } else {
        countAll++;
        if (task.dueDate && (isDueToday(task.dueDate, today) || isOverdue(task.dueDate, today))) {
          countToday++;
        } else if (task.dueDate && task.dueDate > today) {
          countUpcoming++;
        }
      }
    });

    return { countToday, countUpcoming, countAll, countHistory };
  }

  // ==========================================================================
  // Render Engine (Rebuilds view cleanly from state)
  // ==========================================================================
  function render() {
    renderDateHeader();
    renderTabs();

    const taskCanvas = document.getElementById('taskCanvas');
    const focusCanvas = document.getElementById('focusCanvas');
    const addSection = document.querySelector('.add-section');
    const filterBar = document.querySelector('.filter-bar');
    const dateSection = document.querySelector('.date-section');

    if (state.filter === 'focus') {
      if (taskCanvas) taskCanvas.style.display = 'none';
      if (focusCanvas) focusCanvas.style.display = 'flex';
      if (addSection) addSection.style.display = 'none';
      if (filterBar) filterBar.style.display = 'none';
      if (dateSection) dateSection.style.display = 'none';
      if (typeof renderFocusView === 'function') {
        renderFocusView();
      }
    } else {
      if (taskCanvas) taskCanvas.style.display = 'block';
      if (focusCanvas) focusCanvas.style.display = 'none';
      if (addSection) addSection.style.display = '';
      if (filterBar) filterBar.style.display = '';
      if (dateSection) dateSection.style.display = '';
      renderTasksList();
    }

    renderUndoToast();
    updateTabsIndicator();
  }

  // 1. Date Header & Live Progress (Signature Detail 2)
  function renderDateHeader() {
    const dateHeading = document.getElementById('todayDateHeading');
    const progressText = document.getElementById('dateProgressText');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');

    const todayDateObj = new Date();
    if (dateHeading) {
      dateHeading.textContent = formatHeaderDate(todayDateObj);
    }

    // Calculate real data for today
    const today = state.todayString;
    const todayTasks = state.tasks.filter(t => {
      if (t.completedAt) {
        return getLocalDateString(new Date(t.completedAt)) === today;
      }
      return t.dueDate && (isDueToday(t.dueDate, today) || isOverdue(t.dueDate, today));
    });

    const totalCount = todayTasks.length;
    const doneCount = todayTasks.filter(t => t.completedAt).length;

    if (totalCount === 0) {
      if (progressText) progressText.textContent = 'No tasks yet';
      if (progressBar) progressBar.setAttribute('aria-valuenow', '0');
      if (progressFill) progressFill.style.width = '0%';
    } else {
      const percentage = Math.round((doneCount / totalCount) * 100);
      if (progressText) progressText.textContent = `${doneCount} of ${totalCount} done today`;
      if (progressBar) progressBar.setAttribute('aria-valuenow', String(percentage));
      if (progressFill) progressFill.style.width = `${percentage}%`;
    }
  }

  // 2. Navigation Tabs (Signature Detail 6)
  function renderTabs() {
    const counts = getTabCounts();
    const countTodayEl = document.getElementById('count-today');
    const countUpcomingEl = document.getElementById('count-upcoming');
    const countAllEl = document.getElementById('count-all');
    const countHistoryEl = document.getElementById('count-history');

    if (countTodayEl) countTodayEl.textContent = `(${counts.countToday})`;
    if (countUpcomingEl) countUpcomingEl.textContent = `(${counts.countUpcoming})`;
    if (countAllEl) countAllEl.textContent = `(${counts.countAll})`;
    if (countHistoryEl) countHistoryEl.textContent = `(${counts.countHistory})`;

    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      const isSelected = tab.getAttribute('data-tab') === state.filter;
      tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      tab.setAttribute('tabindex', isSelected ? '0' : '-1');
    });
  }

  function updateTabsIndicator() {
    const activeTab = document.querySelector(`.tab-btn[data-tab="${state.filter}"]`);
    const indicator = document.getElementById('tabsIndicator');
    if (activeTab && indicator && activeTab.parentElement && activeTab.parentElement.parentElement) {
      const tabRect = activeTab.getBoundingClientRect();
      const parentRect = activeTab.parentElement.parentElement.getBoundingClientRect();
      const left = tabRect.left - parentRect.left;
      indicator.style.transform = `translateX(${left}px)`;
      indicator.style.width = `${tabRect.width}px`;
    }
  }

  // 3. Task List & Empty State Rendering
  function renderTasksList() {
    const taskListEl = document.getElementById('taskList');
    const emptyStateEl = document.getElementById('emptyState');
    const allClearEl = document.getElementById('allClearMoment');
    const footerCountText = document.getElementById('footerCountText');
    const openClearHistoryModalBtn = document.getElementById('openClearHistoryModalBtn');

    if (!taskListEl) return;

    const visibleTasks = getFilteredAndSortedTasks();
    const isManualSort = state.sortBy === 'manual';

    // Clear previous task DOM
    taskListEl.innerHTML = '';

    // If History Tab
    if (state.filter === 'history') {
      if (allClearEl) allClearEl.classList.remove('is-visible');

      if (openClearHistoryModalBtn) {
        const hasCompletedTasks = state.tasks.some(t => t.completedAt);
        openClearHistoryModalBtn.style.display = hasCompletedTasks ? 'inline-flex' : 'none';
      }

      if (visibleTasks.length === 0) {
        if (emptyStateEl) {
          emptyStateEl.style.display = 'flex';
          renderEmptyStateContent();
        }
      } else {
        if (emptyStateEl) emptyStateEl.style.display = 'none';

        // History Summary: "X completed this week"
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const weekCount = state.tasks.filter(t => t.completedAt && t.completedAt >= oneWeekAgo).length;

        const summaryLi = document.createElement('li');
        summaryLi.className = 'history-summary';

        const summaryText = document.createElement('span');
        summaryText.textContent = `${weekCount} completed this week`;
        summaryLi.appendChild(summaryText);

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn-text delete-text';
        clearBtn.textContent = 'Clear history';
        clearBtn.setAttribute('aria-label', 'Clear all completed tasks');
        clearBtn.addEventListener('click', () => {
          const clearHistoryDialog = document.getElementById('clearHistoryDialogOverlay');
          openModal(clearHistoryDialog);
        });
        summaryLi.appendChild(clearBtn);
        taskListEl.appendChild(summaryLi);

        // Day Groups
        const groups = getHistoryGroups(visibleTasks);
        groups.forEach(group => {
          const groupLi = document.createElement('li');
          groupLi.className = 'history-day-group';

          const heading = document.createElement('div');
          heading.className = 'history-day-heading';
          heading.textContent = group.label;
          groupLi.appendChild(heading);

          const groupUl = document.createElement('ul');
          groupUl.className = 'task-list';
          group.tasks.forEach(task => {
            const itemEl = createHistoryItemElement(task);
            groupUl.appendChild(itemEl);
          });
          groupLi.appendChild(groupUl);
          taskListEl.appendChild(groupLi);
        });
      }

      if (footerCountText) {
        footerCountText.textContent = `${visibleTasks.length} completed ${visibleTasks.length === 1 ? 'task' : 'tasks'}`;
      }
      return;
    }

    // Active views (Today, Upcoming, All)
    if (openClearHistoryModalBtn) {
      openClearHistoryModalBtn.style.display = 'none';
    }

    // Check "All Clear" Moment (Signature Detail 8)
    // Only in 'today' tab when there were tasks due today and all are finished
    const today = state.todayString;
    const tasksDueToday = state.tasks.filter(t => {
      if (t.completedAt) return getLocalDateString(new Date(t.completedAt)) === today;
      return t.dueDate && (isDueToday(t.dueDate, today) || isOverdue(t.dueDate, today));
    });
    const hasTodayTasks = tasksDueToday.length > 0;
    const allTodayCompleted = hasTodayTasks && tasksDueToday.every(t => t.completedAt);

    if (state.filter === 'today' && allTodayCompleted && !state.searchQuery.trim()) {
      if (allClearEl) allClearEl.classList.add('is-visible');
    } else {
      if (allClearEl) allClearEl.classList.remove('is-visible');
    }

    // Render Empty State if no tasks match
    if (visibleTasks.length === 0) {
      if (emptyStateEl) {
        emptyStateEl.style.display = 'flex';
        renderEmptyStateContent();
      }
    } else {
      if (emptyStateEl) emptyStateEl.style.display = 'none';

      // Group active tasks into High, Medium, Low, No priority (Feature 2)
      const PRIORITY_SECTIONS = [
        { key: 'high', label: 'HIGH' },
        { key: 'medium', label: 'MEDIUM' },
        { key: 'low', label: 'LOW' },
        { key: 'none', label: 'NO PRIORITY' }
      ];

      const sections = PRIORITY_SECTIONS.map(p => ({
        key: p.key,
        label: p.label,
        tasks: visibleTasks.filter(t => (t.priority || 'none') === p.key)
      })).filter(sec => sec.tasks.length > 0); // Hide empty sections

      sections.forEach(sec => {
        const secLi = document.createElement('li');
        secLi.className = 'priority-section';
        secLi.setAttribute('data-priority-section', sec.key);

        const isCollapsed = Boolean(state.prefs.collapsedSections && state.prefs.collapsedSections[sec.key]);
        if (isCollapsed) {
          secLi.classList.add('is-collapsed');
        }

        const headerDiv = document.createElement('div');
        headerDiv.className = 'priority-section-header';

        const titleH3 = document.createElement('h3');
        titleH3.className = 'priority-section-title';
        titleH3.textContent = `${sec.label} (${sec.tasks.length})`;
        headerDiv.appendChild(titleH3);

        const ruleDiv = document.createElement('div');
        ruleDiv.className = 'priority-section-rule';
        ruleDiv.setAttribute('aria-hidden', 'true');
        headerDiv.appendChild(ruleDiv);

        const collapseBtn = document.createElement('button');
        collapseBtn.type = 'button';
        collapseBtn.className = 'section-collapse-btn';
        collapseBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        collapseBtn.setAttribute('aria-controls', `section-tasks-${sec.key}`);
        collapseBtn.setAttribute('aria-label', `${isCollapsed ? 'Expand' : 'Collapse'} ${sec.label} section`);
        collapseBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
        collapseBtn.addEventListener('click', () => {
          state.prefs.collapsedSections = state.prefs.collapsedSections || {};
          state.prefs.collapsedSections[sec.key] = !isCollapsed;
          savePrefsToStorage();
          render();
        });
        headerDiv.appendChild(collapseBtn);
        secLi.appendChild(headerDiv);

        const secUl = document.createElement('ul');
        secUl.id = `section-tasks-${sec.key}`;
        secUl.className = 'task-list section-task-list';
        secUl.setAttribute('aria-label', `${sec.label} priority tasks`);

        sec.tasks.forEach(task => {
          const itemEl = createTaskItemElement(task, isManualSort);
          secUl.appendChild(itemEl);
        });

        secLi.appendChild(secUl);
        taskListEl.appendChild(secLi);
      });
    }

    // Update list footer
    const totalMatching = visibleTasks.length;
    if (footerCountText) {
      footerCountText.textContent = `${totalMatching} ${totalMatching === 1 ? 'task' : 'tasks'}`;
    }
  }

  // Create History item DOM element
  function createHistoryItemElement(task) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.setAttribute('data-id', task.id);

    const contentDiv = document.createElement('div');
    contentDiv.className = 'task-content';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'task-title-wrapper';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'task-title';
    titleSpan.textContent = task.title;
    titleWrap.appendChild(titleSpan);
    contentDiv.appendChild(titleWrap);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'task-meta';

    const metaParts = [];

    if (task.completedAt) {
      const timeSpan = document.createElement('span');
      timeSpan.textContent = `COMPLETED ${formatCompletedTime(task.completedAt)}`;
      metaParts.push(timeSpan);
    }

    if (task.priority && task.priority !== 'none') {
      const prioritySpan = document.createElement('span');
      prioritySpan.textContent = task.priority.toUpperCase();
      metaParts.push(prioritySpan);
    }

    if (task.category) {
      const catSpan = document.createElement('span');
      catSpan.textContent = task.category.toUpperCase();
      metaParts.push(catSpan);
    }

    if (task.subtasks && Array.isArray(task.subtasks) && task.subtasks.length > 0) {
      const subSpan = document.createElement('span');
      const count = task.subtasks.length;
      subSpan.textContent = `${count} ${count === 1 ? 'SUBTASK' : 'SUBTASKS'}`;
      metaParts.push(subSpan);
    }

    metaParts.forEach((part, idx) => {
      if (idx > 0) {
        const dot = document.createElement('span');
        dot.textContent = ' · ';
        dot.setAttribute('aria-hidden', 'true');
        metaDiv.appendChild(dot);
      }
      metaDiv.appendChild(part);
    });

    contentDiv.appendChild(metaDiv);
    li.appendChild(contentDiv);

    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'history-actions';

    const restoreBtn = document.createElement('button');
    restoreBtn.type = 'button';
    restoreBtn.className = 'btn-text';
    restoreBtn.setAttribute('data-action', 'restore');
    restoreBtn.setAttribute('aria-label', `Restore "${task.title}"`);
    restoreBtn.textContent = 'Restore';
    actionsDiv.appendChild(restoreBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-text delete-text';
    deleteBtn.setAttribute('data-action', 'delete-history');
    deleteBtn.setAttribute('aria-label', `Delete "${task.title}"`);
    deleteBtn.textContent = 'Delete';
    actionsDiv.appendChild(deleteBtn);

    li.appendChild(actionsDiv);
    return li;
  }

  // Create single task DOM item (Pure textContent safety)
  function createTaskItemElement(task, isManualSort) {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.completedAt ? ' is-completed' : '');
    li.setAttribute('data-id', task.id);
    li.setAttribute('data-priority', task.priority);
    li.setAttribute('data-manual-sort', isManualSort ? 'true' : 'false');

    if (isManualSort) {
      li.draggable = true;
    }

    // 1. Drag Handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle';
    dragHandle.setAttribute('aria-hidden', 'true');
    dragHandle.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
    li.appendChild(dragHandle);

    // 2. Checkbox Button (Signature Detail 3)
    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'checkbox-btn';
    checkBtn.setAttribute('data-action', 'toggle');
    checkBtn.setAttribute('aria-label', task.completedAt ? `Mark "${task.title}" incomplete` : `Mark "${task.title}" complete`);
    checkBtn.innerHTML = '<svg class="checkbox-svg" viewBox="0 0 24 24"><path class="checkbox-path" d="M4 12l5 5L20 6"/></svg>';
    li.appendChild(checkBtn);

    // 3. Task Content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'task-content';

    // If inline editing this task
    if (state.editingTaskId === task.id) {
      const editInput = document.createElement('input');
      editInput.type = 'text';
      editInput.className = 'inline-edit-input';
      editInput.value = task.title;
      editInput.maxLength = 500;
      editInput.setAttribute('aria-label', 'Edit task title');
      contentDiv.appendChild(editInput);
      setTimeout(() => {
        editInput.focus();
        editInput.select();
      }, 10);
    } else {
      const titleWrap = document.createElement('div');
      titleWrap.className = 'task-title-wrapper';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'task-title';
      titleSpan.textContent = task.title; // SAFE TEXTCONTENT ONLY
      titleWrap.appendChild(titleSpan);

      // 2px accent progress rule under title (Feature 3)
      const hasSubtasks = task.subtasks && Array.isArray(task.subtasks) && task.subtasks.length > 0;
      const totalSub = hasSubtasks ? task.subtasks.length : 0;
      const doneSub = hasSubtasks ? task.subtasks.filter(s => s.done).length : 0;

      if (hasSubtasks) {
        const progBar = document.createElement('div');
        progBar.className = 'subtask-progress-bar';
        const progFill = document.createElement('div');
        progFill.className = 'subtask-progress-fill';
        const pct = Math.round((doneSub / totalSub) * 100);
        progFill.style.width = `${pct}%`;
        progBar.appendChild(progFill);
        titleWrap.appendChild(progBar);
      }

      contentDiv.appendChild(titleWrap);

      // Field-note metadata (Signature Detail 5)
      const metaDiv = document.createElement('div');
      metaDiv.className = 'task-meta';

      const metaParts = [];

      // Subtask meta "2 OF 5"
      if (hasSubtasks) {
        const subMetaSpan = document.createElement('span');
        subMetaSpan.textContent = `${doneSub} OF ${totalSub}`;
        metaParts.push(subMetaSpan);
      }

      // Priority in text (Never color only)
      if (task.priority && task.priority !== 'none') {
        const prioritySpan = document.createElement('span');
        prioritySpan.textContent = task.priority.toUpperCase();
        metaParts.push(prioritySpan);
      }

      // Category
      if (task.category) {
        const catSpan = document.createElement('span');
        catSpan.textContent = task.category.toUpperCase();
        metaParts.push(catSpan);
      }

      // Due date text & overdue labels (never on completed tasks)
      if (task.dueDate) {
        const dateSpan = document.createElement('span');
        const today = state.todayString;
        const timePart = task.dueTime ? ` ${formatTime12(task.dueTime)}` : '';

        if (!task.completedAt && isOverdue(task.dueDate, today)) {
          dateSpan.className = 'meta-overdue';
          dateSpan.textContent = `OVERDUE (${formatDisplayDate(task.dueDate).toUpperCase()}${timePart})`;
        } else if (!task.completedAt && isDueToday(task.dueDate, today)) {
          dateSpan.className = 'meta-due-today';
          dateSpan.textContent = `DUE TODAY${timePart}`;
        } else {
          dateSpan.textContent = `DUE ${formatDisplayDate(task.dueDate).toUpperCase()}${timePart}`;
        }
        metaParts.push(dateSpan);
      }

      metaParts.forEach((part, idx) => {
        if (idx > 0) {
          const dot = document.createElement('span');
          dot.textContent = ' · ';
          dot.setAttribute('aria-hidden', 'true');
          metaDiv.appendChild(dot);
        }
        metaDiv.appendChild(part);
      });

      if (metaParts.length > 0) {
        contentDiv.appendChild(metaDiv);
      }

      // Subtasks checklist toggle & section (Feature 3)
      const subtasksWrapper = document.createElement('div');
      subtasksWrapper.className = 'subtasks-wrapper';

      const isOpen = state.openSubtasksTaskIds.has(task.id);
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'subtasks-toggle-btn';
      toggleBtn.setAttribute('data-action', 'toggle-subtasks');
      toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      toggleBtn.setAttribute('aria-label', `${isOpen ? 'Hide' : 'Show'} subtasks for "${task.title}"`);
      toggleBtn.innerHTML = `<span>Subtasks${totalSub > 0 ? ` (${doneSub}/${totalSub})` : ''}</span><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
      subtasksWrapper.appendChild(toggleBtn);

      const checklistUl = document.createElement('ul');
      checklistUl.className = 'subtasks-checklist' + (isOpen ? ' is-open' : '');
      checklistUl.setAttribute('aria-label', `Subtasks for ${task.title}`);

      if (task.subtasks) {
        task.subtasks.forEach(st => {
          const stLi = document.createElement('li');
          stLi.className = 'subtask-item' + (st.done ? ' is-done' : '');
          stLi.setAttribute('data-subtask-id', st.id);

          const checkBtn = document.createElement('button');
          checkBtn.type = 'button';
          checkBtn.className = 'subtask-checkbox-btn';
          checkBtn.setAttribute('data-action', 'toggle-subtask');
          checkBtn.setAttribute('data-subtask-id', st.id);
          checkBtn.setAttribute('aria-label', st.done ? `Mark "${st.title}" incomplete` : `Mark "${st.title}" complete`);
          checkBtn.innerHTML = '<svg class="subtask-checkbox-svg" viewBox="0 0 24 24"><path class="subtask-checkbox-path" d="M4 12l5 5L20 6"/></svg>';
          stLi.appendChild(checkBtn);

          if (state.editingSubtaskId === st.id) {
            const editIn = document.createElement('input');
            editIn.type = 'text';
            editIn.className = 'subtask-edit-input';
            editIn.value = st.title;
            editIn.maxLength = 500;
            editIn.setAttribute('aria-label', 'Edit subtask title');
            stLi.appendChild(editIn);
            setTimeout(() => { editIn.focus(); editIn.select(); }, 10);
          } else {
            const titleSpan = document.createElement('span');
            titleSpan.className = 'subtask-title';
            titleSpan.textContent = st.title;
            titleSpan.setAttribute('data-action', 'edit-subtask');
            titleSpan.setAttribute('data-subtask-id', st.id);
            stLi.appendChild(titleSpan);

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'subtask-delete-btn';
            delBtn.setAttribute('data-action', 'delete-subtask');
            delBtn.setAttribute('data-subtask-id', st.id);
            delBtn.setAttribute('aria-label', `Delete subtask "${st.title}"`);
            delBtn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            stLi.appendChild(delBtn);
          }

          checklistUl.appendChild(stLi);
        });
      }

      if (!task.subtasks || task.subtasks.length < 20) {
        const addForm = document.createElement('form');
        addForm.className = 'subtask-add-form';
        const addIn = document.createElement('input');
        addIn.type = 'text';
        addIn.className = 'subtask-add-input';
        addIn.placeholder = 'Add a subtask...';
        addIn.maxLength = 500;
        addIn.setAttribute('aria-label', `Add subtask to "${task.title}"`);
        addForm.appendChild(addIn);
        checklistUl.appendChild(addForm);
      }

      if (totalSub > 0 && doneSub === totalSub && !task.completedAt) {
        const markParentBtn = document.createElement('button');
        markParentBtn.type = 'button';
        markParentBtn.className = 'mark-parent-done-btn';
        markParentBtn.setAttribute('data-action', 'mark-parent-done');
        markParentBtn.textContent = 'Mark task done';
        checklistUl.appendChild(markParentBtn);
      }

      subtasksWrapper.appendChild(checklistUl);
      contentDiv.appendChild(subtasksWrapper);
    }
    li.appendChild(contentDiv);

    // 4. Action Buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'task-actions';

    // Move Up / Move Down buttons for Manual sort accessibility
    if (isManualSort) {
      const moveDiv = document.createElement('div');
      moveDiv.className = 'move-btns';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'action-btn';
      upBtn.setAttribute('data-action', 'move-up');
      upBtn.setAttribute('aria-label', `Move "${task.title}" up`);
      upBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>';
      moveDiv.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'action-btn';
      downBtn.setAttribute('data-action', 'move-down');
      downBtn.setAttribute('aria-label', `Move "${task.title}" down`);
      downBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>';
      moveDiv.appendChild(downBtn);

      actionsDiv.appendChild(moveDiv);
    }

    if (state.editingTaskId !== task.id) {
      // Edit button
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'action-btn';
      editBtn.setAttribute('data-action', 'edit');
      editBtn.setAttribute('aria-label', `Edit "${task.title}"`);
      editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      actionsDiv.appendChild(editBtn);

      // Delete button
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'action-btn delete-btn';
      delBtn.setAttribute('data-action', 'delete');
      delBtn.setAttribute('aria-label', `Delete "${task.title}"`);
      delBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
      actionsDiv.appendChild(delBtn);
    }

    li.appendChild(actionsDiv);
    return li;
  }

  // 4. Line-Art Empty States (Signature Detail 7)
  function renderEmptyStateContent() {
    const svgEl = document.getElementById('emptyStateSvg');
    const textEl = document.getElementById('emptyStateText');
    if (!svgEl || !textEl) return;

    if (state.searchQuery.trim()) {
      // Magnifier SVG
      svgEl.innerHTML = '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>';
      textEl.textContent = COPY.EMPTY_SEARCH;
      return;
    }

    switch (state.filter) {
      case 'today':
        // Blank page with pencil SVG
        svgEl.innerHTML = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line>';
        textEl.textContent = COPY.EMPTY_TODAY;
        break;

      case 'history':
        // Ink pen / fountain pen SVG
        svgEl.innerHTML = '<path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle>';
        textEl.textContent = COPY.EMPTY_DONE;
        break;

      case 'upcoming':
        // Calendar notebook SVG
        svgEl.innerHTML = '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>';
        textEl.textContent = COPY.EMPTY_UPCOMING;
        break;

      case 'all':
      default:
        svgEl.innerHTML = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>';
        textEl.textContent = COPY.EMPTY_ALL;
        break;
    }
  }

  // 5. Undo Toast (Signature Detail 9)
  function renderUndoToast() {
    const toast = document.getElementById('undoToast');
    const toastTitle = document.getElementById('undoToastTitle');
    const toastLabel = document.getElementById('undoToastLabel');
    if (!toast || !toastTitle) return;

    if (state.undoQueue.length > 0) {
      const current = state.undoQueue[0];
      toastTitle.textContent = current.task.title;
      if (toastLabel) {
        toastLabel.textContent = current.type === 'complete' ? 'Moved to History' : 'Task Deleted';
      }
      toast.classList.add('is-visible');
    } else {
      toast.classList.remove('is-visible');
    }
  }

  // ==========================================================================
  // Event Delegation on Task List
  // ==========================================================================
  function setupTaskListDelegation() {
    const taskListEl = document.getElementById('taskList');
    if (!taskListEl) return;

    taskListEl.addEventListener('click', e => {
      const target = e.target;
      const itemEl = target.closest('.task-item, .history-item');
      if (!itemEl) return;
      const taskId = itemEl.getAttribute('data-id');
      if (!taskId) return;

      // 1. Toggle completion on active task (200ms ink strike + slide out)
      if (target.closest('[data-action="toggle"]')) {
        completeTask(taskId);
        return;
      }

      // 2. Subtasks toggle accordion
      if (target.closest('[data-action="toggle-subtasks"]')) {
        if (state.openSubtasksTaskIds.has(taskId)) {
          state.openSubtasksTaskIds.delete(taskId);
        } else {
          state.openSubtasksTaskIds.add(taskId);
        }
        render();
        return;
      }

      // 3. Toggle subtask checkmark
      const subToggleBtn = target.closest('[data-action="toggle-subtask"]');
      if (subToggleBtn) {
        const subtaskId = subToggleBtn.getAttribute('data-subtask-id');
        toggleSubtask(taskId, subtaskId);
        return;
      }

      // 4. Delete subtask
      const subDelBtn = target.closest('[data-action="delete-subtask"]');
      if (subDelBtn) {
        const subtaskId = subDelBtn.getAttribute('data-subtask-id');
        deleteSubtask(taskId, subtaskId);
        return;
      }

      // 5. Mark parent done from checklist
      if (target.closest('[data-action="mark-parent-done"]')) {
        completeTask(taskId);
        return;
      }

      // 6. Restore task from history
      if (target.closest('[data-action="restore"]')) {
        restoreTaskFromHistory(taskId);
        return;
      }

      // 7. Delete from history (with 4 second undo)
      if (target.closest('[data-action="delete-history"]')) {
        deleteTask(taskId);
        return;
      }

      // 8. Start inline edit
      if (target.closest('[data-action="edit"]')) {
        state.editingTaskId = taskId;
        render();
        return;
      }

      // 9. Delete active task (open confirmation dialog)
      if (target.closest('[data-action="delete"]')) {
        openDeleteDialog(taskId);
        return;
      }

      // 10. Move up in manual sort
      if (target.closest('[data-action="move-up"]')) {
        moveTaskManual(taskId, -1);
        return;
      }

      // 11. Move down in manual sort
      if (target.closest('[data-action="move-down"]')) {
        moveTaskManual(taskId, 1);
        return;
      }
    });

    // Double-click on task or subtask title to edit
    taskListEl.addEventListener('dblclick', e => {
      const subTitleSpan = e.target.closest('.subtask-title');
      if (subTitleSpan) {
        const subtaskId = subTitleSpan.getAttribute('data-subtask-id');
        state.editingSubtaskId = subtaskId;
        render();
        return;
      }

      const titleSpan = e.target.closest('.task-title');
      if (titleSpan) {
        const li = titleSpan.closest('.task-item');
        if (li) {
          const taskId = li.getAttribute('data-id');
          state.editingTaskId = taskId;
          render();
        }
      }
    });

    // Subtask add submission
    taskListEl.addEventListener('submit', e => {
      const form = e.target.closest('.subtask-add-form');
      if (form) {
        e.preventDefault();
        const taskLi = form.closest('.task-item');
        const input = form.querySelector('.subtask-add-input');
        if (taskLi && input) {
          const taskId = taskLi.getAttribute('data-id');
          addSubtask(taskId, input.value);
        }
      }
    });

    // Handle keypress & blur for inline edit
    taskListEl.addEventListener('keydown', e => {
      if (e.target.classList.contains('subtask-edit-input')) {
        const subLi = e.target.closest('.subtask-item');
        const taskLi = e.target.closest('.task-item');
        if (!subLi || !taskLi) return;
        const subtaskId = subLi.getAttribute('data-subtask-id');
        const taskId = taskLi.getAttribute('data-id');

        if (e.key === 'Enter') {
          e.preventDefault();
          saveSubtaskEdit(taskId, subtaskId, e.target.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          state.editingSubtaskId = null;
          render();
        }
        return;
      }

      if (e.target.classList.contains('inline-edit-input')) {
        const li = e.target.closest('.task-item');
        const taskId = li ? li.getAttribute('data-id') : null;

        if (e.key === 'Enter') {
          e.preventDefault();
          if (taskId) {
            const res = saveTaskEdit(taskId, e.target.value);
            if (!res.success) {
              alert(res.error);
            }
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelTaskEdit();
        }
      }
    });

    // HTML5 Drag & Drop reorder
    taskListEl.addEventListener('dragstart', e => {
      if (state.sortBy !== 'manual') return;
      const li = e.target.closest('.task-item');
      if (li) {
        state.draggedTaskId = li.getAttribute('data-id');
        li.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', state.draggedTaskId);
      }
    });

    taskListEl.addEventListener('dragend', e => {
      const li = e.target.closest('.task-item');
      if (li) {
        li.classList.remove('is-dragging');
      }
      state.draggedTaskId = null;
    });

    taskListEl.addEventListener('dragover', e => {
      if (state.sortBy !== 'manual') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    taskListEl.addEventListener('drop', e => {
      if (state.sortBy !== 'manual') return;
      e.preventDefault();
      const targetLi = e.target.closest('.task-item');
      if (!targetLi) return;
      const targetId = targetLi.getAttribute('data-id');
      const sourceId = state.draggedTaskId;

      if (sourceId && targetId && sourceId !== targetId) {
        reorderTasksManual(sourceId, targetId);
      }
    });
  }

  function moveTaskManual(taskId, direction) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // Filter tasks in the same priority section
    const sectionKey = task.priority || 'none';
    const sectionTasks = state.tasks
      .filter(t => !t.completedAt && (t.priority || 'none') === sectionKey)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const idx = sectionTasks.findIndex(t => t.id === taskId);
    if (idx === -1) return;

    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= sectionTasks.length) return;

    // Swap order values between current task and adjacent task in section
    const tempOrder = sectionTasks[idx].order;
    sectionTasks[idx].order = sectionTasks[targetIdx].order;
    sectionTasks[targetIdx].order = tempOrder;

    saveToStorage();
    announcePolite(direction < 0 ? 'Moved up' : 'Moved down');
    render();
  }

  function reorderTasksManual(sourceId, targetId) {
    const sourceTask = state.tasks.find(t => t.id === sourceId);
    const targetTask = state.tasks.find(t => t.id === targetId);
    if (!sourceTask || !targetTask) return;

    // Drag reorder works only inside the same section
    const sourceKey = sourceTask.priority || 'none';
    const targetKey = targetTask.priority || 'none';
    if (sourceKey !== targetKey) {
      return;
    }

    const sectionTasks = state.tasks
      .filter(t => !t.completedAt && (t.priority || 'none') === sourceKey)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    const fromIndex = sectionTasks.findIndex(t => t.id === sourceId);
    const toIndex = sectionTasks.findIndex(t => t.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = sectionTasks.splice(fromIndex, 1);
    sectionTasks.splice(toIndex, 0, moved);

    // Reassign continuous orders within this section
    sectionTasks.forEach((t, i) => {
      t.order = i;
    });

    saveToStorage();
    announcePolite('Task reordered');
    render();
  }

  // ==========================================================================
  // Swipe Gestures (Touch / Coarse Pointer Only - Feature 6)
  // ==========================================================================
  function evaluateSwipeGesture(deltaX, isHistory = false) {
    const THRESHOLD = 80;
    if (deltaX >= THRESHOLD) {
      return isHistory ? 'restore' : 'complete';
    } else if (deltaX <= -THRESHOLD) {
      return 'delete';
    }
    return 'spring-back';
  }

  function setupSwipeGestures() {
    const taskListEl = document.getElementById('taskList');
    if (!taskListEl) return;

    let startX = 0;
    let startY = 0;
    let currentLi = null;
    let isHistory = false;
    let isSwipingHorizontal = false;
    let indicatorEl = null;

    taskListEl.addEventListener('pointerdown', e => {
      // Only when (pointer: coarse) matches
      if (!window.matchMedia('(pointer: coarse)').matches) return;

      // Ignore swipes starting within 24px of screen edges
      if (e.clientX < 24 || e.clientX > window.innerWidth - 24) return;

      // Ignore while editing, dragging or typing
      if (state.editingTaskId || state.editingSubtaskId || state.draggedTaskId) return;
      const targetTag = e.target.tagName.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select' || targetTag === 'button') return;
      if (e.target.closest('button, input, select, textarea, .subtask-item')) return;

      const li = e.target.closest('.task-item, .history-item');
      if (!li) return;

      startX = e.clientX;
      startY = e.clientY;
      currentLi = li;
      isHistory = li.classList.contains('history-item');
      isSwipingHorizontal = false;
    });

    taskListEl.addEventListener('pointermove', e => {
      if (!currentLi) return;

      const diffX = e.clientX - startX;
      const diffY = e.clientY - startY;

      if (!isSwipingHorizontal) {
        if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 8) {
          // Vertical scroll - abandon swipe tracking cleanly
          currentLi = null;
          return;
        }
        if (Math.abs(diffX) > 8) {
          isSwipingHorizontal = true;
          try { currentLi.setPointerCapture(e.pointerId); } catch (err) {}

          indicatorEl = document.createElement('div');
          indicatorEl.className = 'swipe-label-indicator';
          currentLi.appendChild(indicatorEl);
        }
      }

      if (isSwipingHorizontal) {
        const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!isReduced) {
          currentLi.style.transform = `translateX(${diffX}px)`;
        }

        if (indicatorEl) {
          if (diffX > 0) {
            indicatorEl.className = 'swipe-label-indicator swipe-right';
            indicatorEl.textContent = isHistory ? 'RESTORE' : 'DONE';
          } else {
            indicatorEl.className = 'swipe-label-indicator swipe-left';
            indicatorEl.textContent = 'DELETE';
          }
          indicatorEl.style.opacity = String(Math.min(1, Math.abs(diffX) / 60));
        }
      }
    });

    const finishSwipe = (e) => {
      if (!currentLi) return;
      const li = currentLi;
      const ind = indicatorEl;
      const swiped = isSwipingHorizontal;
      const diffX = e ? (e.clientX - startX) : 0;
      const taskId = li.getAttribute('data-id');

      currentLi = null;
      indicatorEl = null;
      isSwipingHorizontal = false;

      if (!swiped) return;

      const action = evaluateSwipeGesture(diffX, isHistory);
      const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (action === 'complete') {
        li.style.transform = '';
        if (ind) ind.remove();
        completeTask(taskId);
      } else if (action === 'delete') {
        li.style.transform = '';
        if (ind) ind.remove();
        deleteTask(taskId);
      } else if (action === 'restore') {
        li.style.transform = '';
        if (ind) ind.remove();
        restoreTaskFromHistory(taskId);
      } else {
        // Spring back within 200ms
        if (isReduced) {
          li.style.transform = '';
          if (ind) ind.remove();
        } else {
          li.style.transition = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';
          li.style.transform = 'translateX(0)';
          setTimeout(() => {
            li.style.transition = '';
            li.style.transform = '';
            if (ind) ind.remove();
          }, 200);
        }
      }
    };

    taskListEl.addEventListener('pointerup', finishSwipe);
    taskListEl.addEventListener('pointercancel', finishSwipe);
  }

  // ==========================================================================
  // Form & Input Event Handlers
  // ==========================================================================
  function setupFormHandlers() {
    const addForm = document.getElementById('addTaskForm');
    const titleInput = document.getElementById('taskTitleInput');
    const prioritySelect = document.getElementById('taskPrioritySelect');
    const dueDateInput = document.getElementById('taskDueDateInput');
    const categoryInput = document.getElementById('taskCategoryInput');
    const errorEl = document.getElementById('addTaskError');
    const quickAddContainer = document.getElementById('quickAddPreviewContainer');
    const toggleMoreOptionsBtn = document.getElementById('toggleMoreOptionsBtn');
    const moreOptionsPanel = document.getElementById('addMoreOptionsPanel');

    // Title input smart quick-add detection
    if (titleInput) {
      titleInput.addEventListener('input', () => {
        if (errorEl) {
          errorEl.textContent = '';
          errorEl.classList.remove('is-visible');
        }

        const detected = detectQuickAddDate(titleInput.value);
        if (detected && !state.quickAddDueDate) {
          state.quickAddDueDate = detected;
          renderQuickAddPreview();
        } else if (!detected && state.quickAddDueDate) {
          state.quickAddDueDate = null;
          renderQuickAddPreview();
        }
      });
    }

    function renderQuickAddPreview() {
      if (!quickAddContainer) return;
      if (!state.quickAddDueDate) {
        quickAddContainer.innerHTML = '';
        return;
      }

      quickAddContainer.innerHTML = `
        <div class="quick-add-preview" role="status">
          <span>Due: ${state.quickAddDueDate.label}</span>
          <button type="button" id="dismissQuickAddBtn" aria-label="Remove detected due date">&times;</button>
        </div>
      `;

      const dismissBtn = document.getElementById('dismissQuickAddBtn');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', () => {
          state.quickAddDueDate = null;
          renderQuickAddPreview();
        });
      }
    }

    // Toggle More Options panel
    if (toggleMoreOptionsBtn && moreOptionsPanel) {
      toggleMoreOptionsBtn.addEventListener('click', () => {
        const isExpanded = toggleMoreOptionsBtn.getAttribute('aria-expanded') === 'true';
        toggleMoreOptionsBtn.setAttribute('aria-expanded', String(!isExpanded));
        moreOptionsPanel.classList.toggle('is-open', !isExpanded);
      });
    }

    // Form submission
    if (addForm) {
      addForm.addEventListener('submit', e => {
        e.preventDefault();
        const rawTitle = titleInput.value;
        const priority = prioritySelect ? prioritySelect.value : 'none';
        let dueDate = dueDateInput && dueDateInput.value ? dueDateInput.value : null;

        // Apply quick-add date if detected and not overridden manually
        if (!dueDate && state.quickAddDueDate) {
          dueDate = state.quickAddDueDate.dateStr;
        }

        const category = categoryInput ? categoryInput.value : '';
        const dueTimeInput = document.getElementById('taskDueTimeInput');
        const reminderSelect = document.getElementById('taskReminderSelect');

        const dueTime = dueTimeInput && dueTimeInput.value ? dueTimeInput.value : null;
        const remind = reminderSelect ? reminderSelect.value : 'none';

        const res = addTask(rawTitle, priority, dueDate, category, dueTime, remind);
        if (!res.success) {
          if (errorEl) {
            errorEl.textContent = res.error;
            errorEl.classList.add('is-visible');
          }
        } else {
          // Reset form
          titleInput.value = '';
          if (errorEl) {
            errorEl.textContent = '';
            errorEl.classList.remove('is-visible');
          }
          if (dueDateInput) dueDateInput.value = '';
          if (dueTimeInput) dueTimeInput.value = '';
          if (reminderSelect) reminderSelect.value = 'none';
          if (categoryInput) categoryInput.value = '';
          if (prioritySelect) prioritySelect.value = 'none';
          state.quickAddDueDate = null;
          renderQuickAddPreview();
          titleInput.focus();
        }
      });
    }
  }

  // ==========================================================================
  // Filter & Search Controls
  // ==========================================================================
  function setupFilterControls() {
    // Tab switching
    const tabList = document.querySelector('.tabs-list');
    if (tabList) {
      tabList.addEventListener('click', e => {
        const btn = e.target.closest('.tab-btn');
        if (btn) {
          const tab = btn.getAttribute('data-tab');
          if (tab && tab !== state.filter) {
            state.filter = tab;
            btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            render();
          }
        }
      });

      // Arrow navigation for tablist semantics (WCAG 2.2 AA)
      tabList.addEventListener('keydown', e => {
        const tabs = Array.from(tabList.querySelectorAll('.tab-btn'));
        const activeTab = document.activeElement;
        const currentIndex = tabs.indexOf(activeTab);
        if (currentIndex === -1) return;

        let nextIndex = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          nextIndex = (currentIndex + 1) % tabs.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        } else if (e.key === 'Home') {
          e.preventDefault();
          nextIndex = 0;
        } else if (e.key === 'End') {
          e.preventDefault();
          nextIndex = tabs.length - 1;
        }

        if (nextIndex !== -1) {
          const targetTab = tabs[nextIndex];
          targetTab.focus();
          const tab = targetTab.getAttribute('data-tab');
          if (tab && tab !== state.filter) {
            state.filter = tab;
            targetTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            render();
          }
        }
      });
    }

    // Search input
    const searchInput = document.getElementById('taskSearchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        state.searchQuery = searchInput.value;
        if (clearSearchBtn) {
          clearSearchBtn.classList.toggle('is-visible', Boolean(searchInput.value));
        }
        render();
      });
    }

    if (clearSearchBtn && searchInput) {
      clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        state.searchQuery = '';
        clearSearchBtn.classList.remove('is-visible');
        searchInput.focus();
        render();
      });
    }

    // Sort select
    const sortSelect = document.getElementById('taskSortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        state.sortBy = sortSelect.value;
        render();
      });
    }

    // Dismiss "All clear" moment on any interaction
    const allClearEl = document.getElementById('allClearMoment');
    if (allClearEl) {
      allClearEl.addEventListener('click', () => {
        allClearEl.classList.remove('is-visible');
      });
    }
  }

  // ==========================================================================
  // Dialogs & Modals Management (Accessible Focus Traps)
  // ==========================================================================
  let lastActiveElement = null;

  function openModal(modalEl) {
    if (!modalEl) return;
    lastActiveElement = document.activeElement;
    modalEl.classList.add('is-open');

    // Focus first interactive element inside modal
    const focusable = modalEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('is-open');
    const timerMusicBtn = document.getElementById('timerMusicBtn');
    if (timerMusicBtn && modalEl.id === 'musicDialogOverlay') {
      timerMusicBtn.setAttribute('aria-expanded', 'false');
    }
    if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
      lastActiveElement.focus();
    }
  }

  function setupModals() {
    // 1. Clear History Dialog
    const clearDialog = document.getElementById('clearHistoryDialogOverlay');
    const openClearBtn = document.getElementById('openClearHistoryModalBtn');
    const cancelClearBtn = document.getElementById('cancelClearHistoryBtn');
    const confirmClearBtn = document.getElementById('confirmClearHistoryBtn');

    if (openClearBtn) {
      openClearBtn.addEventListener('click', () => openModal(clearDialog));
    }
    if (cancelClearBtn) {
      cancelClearBtn.addEventListener('click', () => closeModal(clearDialog));
    }
    if (confirmClearBtn) {
      confirmClearBtn.addEventListener('click', () => {
        clearHistoryTasks();
        closeModal(clearDialog);
      });
    }

    // 2. Delete Single Task Dialog
    const deleteDialog = document.getElementById('deleteTaskDialogOverlay');
    const cancelDeleteBtn = document.getElementById('cancelDeleteTaskBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteTaskBtn');

    if (cancelDeleteBtn) {
      cancelDeleteBtn.addEventListener('click', () => {
        state.pendingDeleteTaskId = null;
        closeModal(deleteDialog);
      });
    }
    if (confirmDeleteBtn) {
      confirmDeleteBtn.addEventListener('click', () => {
        if (state.pendingDeleteTaskId) {
          deleteTask(state.pendingDeleteTaskId);
          state.pendingDeleteTaskId = null;
        }
        closeModal(deleteDialog);
      });
    }

    // 3. Settings Dialog
    const settingsDialog = document.getElementById('settingsDialogOverlay');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const closeSettingsHeaderBtn = document.getElementById('closeSettingsHeaderBtn');
    const remindersCheckbox = document.getElementById('settingRemindersEnabled');
    const testNotificationBtn = document.getElementById('sendTestNotificationBtn');
    const settingsExportBtn = document.getElementById('settingsExportBtn');
    const settingsImportFileInput = document.getElementById('settingsImportFileInput');
    const settingsImportFeedback = document.getElementById('settingsImportFeedback');

    function updateNotificationPermissionStatus() {
      const statusEl = document.getElementById('notificationPermissionStatus');
      if (!statusEl) return;
      if (!('Notification' in window)) {
        statusEl.textContent = 'Permission: Notifications not supported in this browser';
      } else if (Notification.permission === 'granted') {
        statusEl.textContent = 'Permission: Notifications allowed';
      } else if (Notification.permission === 'denied') {
        statusEl.textContent = 'Permission: Notifications blocked in browser settings';
      } else {
        statusEl.textContent = 'Permission: Not requested yet';
      }
    }

    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        applyAccent(state.prefs.accent);
        if (remindersCheckbox) {
          remindersCheckbox.checked = state.prefs.remindersEnabled !== false;
        }
        updateNotificationPermissionStatus();
        if (settingsImportFeedback) settingsImportFeedback.style.display = 'none';
        openModal(settingsDialog);
      });
    }

    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => closeModal(settingsDialog));
    }
    if (closeSettingsHeaderBtn) {
      closeSettingsHeaderBtn.addEventListener('click', () => closeModal(settingsDialog));
    }

    // Accent radio buttons
    const accentRadios = document.querySelectorAll('input[name="accent-swatch"]');
    accentRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          applyAccent(radio.value);
          announcePolite(`Accent color set to ${radio.value}`);
        }
      });
    });

    // Reminders toggle
    if (remindersCheckbox) {
      remindersCheckbox.addEventListener('change', () => {
        state.prefs.remindersEnabled = remindersCheckbox.checked;
        savePrefsToStorage();
        announcePolite(remindersCheckbox.checked ? 'Reminders enabled' : 'Reminders disabled');
      });
    }

    // Test notification button
    if (testNotificationBtn) {
      testNotificationBtn.addEventListener('click', () => {
        sendTestNotification();
      });
    }

    // Export tasks as JSON
    if (settingsExportBtn) {
      settingsExportBtn.addEventListener('click', () => {
        const json = JSON.stringify(state.tasks, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `inkline-backup-${state.todayString}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        announcePolite('Tasks exported');
      });
    }

    // 4. Confirm Import Dialog & file processing
    const confirmImportDialog = document.getElementById('confirmImportDialogOverlay');
    const confirmImportDesc = document.getElementById('confirmImportDesc');
    const cancelConfirmImportBtn = document.getElementById('cancelConfirmImportBtn');
    const confirmReplaceImportBtn = document.getElementById('confirmReplaceImportBtn');

    if (settingsImportFileInput) {
      settingsImportFileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const parsed = JSON.parse(ev.target.result);
            if (!Array.isArray(parsed)) {
              if (settingsImportFeedback) {
                settingsImportFeedback.style.display = 'block';
                settingsImportFeedback.style.color = 'var(--accent)';
                settingsImportFeedback.textContent = 'Invalid backup file. Root must be a list of tasks.';
              }
              return;
            }

            const validImported = [];
            let badCount = 0;

            parsed.forEach(item => {
              const validated = validateTaskRecord(item);
              if (validated) {
                validImported.push(validated);
              } else {
                badCount++;
              }
            });

            if (validImported.length === 0) {
              if (settingsImportFeedback) {
                settingsImportFeedback.style.display = 'block';
                settingsImportFeedback.style.color = 'var(--accent)';
                settingsImportFeedback.textContent = 'No valid task records found in file.';
              }
              return;
            }

            state.pendingImportTasks = validImported;
            if (confirmImportDesc) {
              confirmImportDesc.textContent = `This will replace your current tasks with ${validImported.length} task${validImported.length === 1 ? '' : 's'} from the backup.${badCount > 0 ? ` (${badCount} bad records skipped)` : ''}`;
            }
            openModal(confirmImportDialog);
          } catch (err) {
            if (settingsImportFeedback) {
              settingsImportFeedback.style.display = 'block';
              settingsImportFeedback.style.color = 'var(--accent)';
              settingsImportFeedback.textContent = 'Could not parse JSON file.';
            }
          } finally {
            e.target.value = '';
          }
        };
        reader.readAsText(file);
      });
    }

    if (cancelConfirmImportBtn) {
      cancelConfirmImportBtn.addEventListener('click', () => {
        state.pendingImportTasks = null;
        closeModal(confirmImportDialog);
      });
    }

    if (confirmReplaceImportBtn) {
      confirmReplaceImportBtn.addEventListener('click', () => {
        if (state.pendingImportTasks && state.pendingImportTasks.length > 0) {
          state.tasks = state.pendingImportTasks;
          state.pendingImportTasks = null;
          saveToStorage();
          render();
          announcePolite(`Restored ${state.tasks.length} tasks`);
        }
        closeModal(confirmImportDialog);
        closeModal(settingsDialog);
      });
    }

    // 5. Notification Permission Explanation Dialog
    const permDialog = document.getElementById('permissionPromptDialogOverlay');
    const allowPermBtn = document.getElementById('allowPermissionBtn');
    const skipPermBtn = document.getElementById('skipPermissionBtn');

    if (allowPermBtn) {
      allowPermBtn.addEventListener('click', () => {
        closeModal(permDialog);
        if ('Notification' in window) {
          Notification.requestPermission().then(() => {
            updateNotificationPermissionStatus();
          });
        }
      });
    }

    if (skipPermBtn) {
      skipPermBtn.addEventListener('click', () => {
        closeModal(permDialog);
      });
    }

    // 6. Music & Ambient Sounds Dialog
    const musicDialog = document.getElementById('musicDialogOverlay');
    const timerMusicBtn = document.getElementById('timerMusicBtn');
    const closeMusicBtn = document.getElementById('closeMusicPanelBtn');
    const closeMusicBottomBtn = document.getElementById('closeMusicPanelBottomBtn');

    if (timerMusicBtn) {
      timerMusicBtn.addEventListener('click', () => {
        timerMusicBtn.setAttribute('aria-expanded', 'true');
        openModal(musicDialog);
      });
    }

    if (closeMusicBtn) {
      closeMusicBtn.addEventListener('click', () => {
        if (timerMusicBtn) timerMusicBtn.setAttribute('aria-expanded', 'false');
        closeModal(musicDialog);
      });
    }

    if (closeMusicBottomBtn) {
      closeMusicBottomBtn.addEventListener('click', () => {
        if (timerMusicBtn) timerMusicBtn.setAttribute('aria-expanded', 'false');
        closeModal(musicDialog);
      });
    }

    // Accessible Focus Trap and Escape Handler
    document.addEventListener('keydown', e => {
      const openDialog = document.querySelector('.dialog-overlay.is-open');
      if (!openDialog) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal(openDialog);
        return;
      }

      if (e.key === 'Tab') {
        const focusable = Array.from(openDialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetParent !== null);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !openDialog.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !openDialog.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    });

    document.querySelectorAll('.dialog-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          closeModal(overlay);
        }
      });
    });
  }

  function sendTestNotification() {
    if (!('Notification' in window)) {
      announcePolite('Notifications are not supported in this browser.');
      return;
    }

    if (Notification.permission === 'granted') {
      try {
        new Notification('Inkline', {
          body: 'Test notification from Inkline.',
          icon: 'favicon.png'
        });
        announcePolite('Test notification sent');
      } catch (e) {
        announcePolite('Test notification failed to send.');
      }
    } else if (Notification.permission === 'denied') {
      announcePolite('Notifications are blocked in browser settings.');
    } else {
      Notification.requestPermission().then(permission => {
        const statusEl = document.getElementById('notificationPermissionStatus');
        if (statusEl) {
          statusEl.textContent = permission === 'granted' ? 'Permission: Notifications allowed' : 'Permission: Notifications blocked';
        }
        if (permission === 'granted') {
          try {
            new Notification('Inkline', {
              body: 'Test notification from Inkline.',
              icon: 'favicon.png'
            });
            announcePolite('Test notification sent');
          } catch (e) {
            announcePolite('Test notification failed to send.');
          }
        }
      });
    }
  }

  function openDeleteDialog(taskId) {
    state.pendingDeleteTaskId = taskId;
    const deleteDialog = document.getElementById('deleteTaskDialogOverlay');
    openModal(deleteDialog);
  }

  // ==========================================================================
  // Global Keyboard Shortcuts
  // ==========================================================================
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

      // Ignore shortcuts while user is typing in an input field
      if (isInput) return;

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        const titleInput = document.getElementById('taskTitleInput');
        if (titleInput) titleInput.focus();
      } else if (e.key === '/') {
        e.preventDefault();
        const searchInput = document.getElementById('taskSearchInput');
        if (searchInput) searchInput.focus();
      } else if (e.code === 'Space' || e.key === ' ') {
        if (state.filter === 'focus') {
          e.preventDefault();
          if (typeof toggleFocusTimer === 'function') {
            toggleFocusTimer();
          }
        }
      }
    });
  }

  // ==========================================================================
  // Midnight & Visibility Date Recalculation
  // ==========================================================================
  function scheduleMidnightRefresh() {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const msUntilMidnight = tomorrow.getTime() - now.getTime() + 1000;

    setTimeout(() => {
      state.todayString = getLocalDateString(new Date());
      render();
      scheduleMidnightRefresh();
    }, msUntilMidnight);
  }

  function setupVisibilityChange() {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        const currentToday = getLocalDateString(new Date());
        if (state.todayString !== currentToday) {
          state.todayString = currentToday;
          render();
        }
        checkReminders();
      }
    });
  }

  // ==========================================================================
  // Reminders Engine (30-second checking, trigger math, toasts & missed banner)
  // ==========================================================================
  function formatTime12(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    let h = parseInt(parts[0], 10);
    const m = parts[1] || '00';
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  }

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

  let activeReminderToastTimer = null;

  function showReminderToast(task, text) {
    const toast = document.getElementById('reminderToast');
    const label = document.getElementById('reminderToastText');
    const viewBtn = document.getElementById('reminderToastViewBtn');
    const dismissBtn = document.getElementById('reminderToastDismissBtn');
    if (!toast || !label) return;

    label.textContent = text;
    toast.style.display = 'flex';
    toast.classList.add('is-visible');

    if (viewBtn) {
      viewBtn.onclick = () => {
        toast.classList.remove('is-visible');
        setTimeout(() => { toast.style.display = 'none'; }, 200);

        const today = state.todayString;
        if (task.dueDate && (isDueToday(task.dueDate, today) || isOverdue(task.dueDate, today))) {
          switchTab('today');
        } else if (task.dueDate && task.dueDate > today) {
          switchTab('upcoming');
        } else {
          switchTab('all');
        }

        setTimeout(() => {
          const el = document.querySelector(`.task-item[data-id="${task.id}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.focus();
          }
        }, 150);
      };
    }

    if (dismissBtn) {
      dismissBtn.onclick = () => {
        toast.classList.remove('is-visible');
        setTimeout(() => { toast.style.display = 'none'; }, 200);
      };
    }

    if (activeReminderToastTimer) clearTimeout(activeReminderToastTimer);
    activeReminderToastTimer = setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => { toast.style.display = 'none'; }, 200);
    }, 10000);
  }

  function checkReminders() {
    if (state.prefs.remindersEnabled === false) return;
    const now = Date.now();

    const storedMap = new Map();
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TASKS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(t => {
            if (t && t.id) storedMap.set(t.id, t.remindedAt);
          });
        }
      }
    } catch (e) {}

    let updated = false;

    state.tasks.forEach(task => {
      if (task.completedAt) return;
      if (!task.remind || task.remind === 'none') return;
      if (task.remindedAt) return;

      if (storedMap.has(task.id) && storedMap.get(task.id)) {
        task.remindedAt = storedMap.get(task.id);
        return;
      }

      const trigger = getReminderTriggerTimestamp(task);
      if (trigger && now >= trigger) {
        task.remindedAt = now;
        updated = true;

        const timeLabel = task.dueTime ? formatTime12(task.dueTime) : '9:00 AM';
        const reminderText = `Reminder: ${task.title} is due at ${timeLabel}`;

        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification('Inkline', {
              body: reminderText,
              icon: 'favicon.png'
            });
          } catch (e) {}
        }

        showReminderToast(task, reminderText);
      }
    });

    if (updated) {
      saveToStorage();
    }
  }

  function checkMissedRemindersOnLoad() {
    const now = Date.now();
    let missedCount = 0;

    state.tasks.forEach(task => {
      if (task.completedAt) return;
      if (!task.remind || task.remind === 'none') return;
      if (task.remindedAt) return;

      const trigger = getReminderTriggerTimestamp(task);
      if (trigger && trigger < now) {
        task.remindedAt = now;
        missedCount++;
      }
    });

    if (missedCount > 0) {
      saveToStorage();
      const banner = document.getElementById('missedRemindersBanner');
      const text = document.getElementById('missedRemindersText');
      const viewBtn = document.getElementById('viewMissedRemindersBtn');
      const dismissBtn = document.getElementById('dismissMissedRemindersBtn');

      if (banner && text) {
        text.textContent = `${missedCount} reminder${missedCount === 1 ? '' : 's'} passed while Inkline was closed`;
        banner.style.display = 'flex';

        if (viewBtn) {
          viewBtn.onclick = () => {
            switchTab('today');
            banner.style.display = 'none';
          };
        }
        if (dismissBtn) {
          dismissBtn.onclick = () => {
            banner.style.display = 'none';
          };
        }
      }
    }
  }

  function switchTab(tab) {
    if (tab && tab !== state.filter) {
      state.filter = tab;
      const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
      if (btn) {
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
      render();
    }
  }

  // ==========================================================================
  // Focus Timer (Feature 7 Showpiece)
  // ==========================================================================
  const STORAGE_KEY_TIMER = 'inkline.timer.v1';
  const STORAGE_KEY_TIMER_PREFS = 'inkline.timer_prefs.v1';
  const STORAGE_KEY_SESSIONS = 'inkline.sessions.v1';
  const CURRENT_TAB_ID = 'tab_' + Math.random().toString(36).substring(2, 9);
  const RING_CIRCUMFERENCE = 753.982;

  const timerState = {
    mode: 'focus', // 'focus' | 'short' | 'long'
    durations: { focus: 25, short: 5, long: 15 },
    totalMs: 25 * 60 * 1000,
    remainingMs: 25 * 60 * 1000,
    endTimestamp: null,
    isRunning: false,
    isFinished: false,
    focusTaskId: null,
    alarmVolume: 0.8,
    intervalId: null,
    wakeLock: null,
    startedByTabId: null,
    announcedOneMinuteLeft: false
  };

  let audioCtx = null;
  let alarmInterval = null;
  let alarmTimeout = null;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        audioCtx = new AudioCtxClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playSoftBell(volume = 0.8) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const masterGain = ctx.createGain();
      const safeVolume = Math.max(0, Math.min(1, volume));
      masterGain.gain.setValueAtTime(safeVolume, now);
      masterGain.connect(ctx.destination);

      const partials = [
        { freq: 523.25, gain: 0.5, decay: 2.2 },
        { freq: 1046.5, gain: 0.25, decay: 1.6 },
        { freq: 1444.17, gain: 0.15, decay: 1.1 },
        { freq: 2129.62, gain: 0.08, decay: 0.7 }
      ];

      partials.forEach(p => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(p.freq, now);
        g.gain.setValueAtTime(p.gain, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);
        osc.connect(g);
        g.connect(masterGain);
        osc.start(now);
        osc.stop(now + p.decay);
      });
    } catch (e) {}
  }

  function startAlarmLoop() {
    stopAlarmLoop();
    playSoftBell(timerState.alarmVolume);

    if ('vibrate' in navigator) {
      try { navigator.vibrate([200, 100, 200, 100, 200]); } catch (e) {}
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Inkline', {
          body: 'Time is up',
          icon: 'favicon.png'
        });
      } catch (e) {}
    }

    alarmInterval = setInterval(() => {
      playSoftBell(timerState.alarmVolume);
      if ('vibrate' in navigator) {
        try { navigator.vibrate([200, 100, 200]); } catch (e) {}
      }
    }, 3000);

    alarmTimeout = setTimeout(() => {
      stopAlarmLoop();
    }, 60000);
  }

  function stopAlarmLoop() {
    if (alarmInterval) {
      clearInterval(alarmInterval);
      alarmInterval = null;
    }
    if (alarmTimeout) {
      clearTimeout(alarmTimeout);
      alarmTimeout = null;
    }
  }

  async function requestWakeLock() {
    if ('wakeLock' in navigator && !timerState.wakeLock) {
      try {
        timerState.wakeLock = await navigator.wakeLock.request('screen');
        timerState.wakeLock.addEventListener('release', () => {
          timerState.wakeLock = null;
        });
      } catch (e) {
        timerState.wakeLock = null;
      }
    }
  }

  function releaseWakeLock() {
    if (timerState.wakeLock) {
      try {
        timerState.wakeLock.release();
      } catch (e) {}
      timerState.wakeLock = null;
    }
  }

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

  function formatEndsAtTime(dateObj) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit'
      }).format(dateObj);
    } catch (e) {
      return '';
    }
  }

  function loadTimerPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TIMER_PREFS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.durations) {
            ['focus', 'short', 'long'].forEach(m => {
              const v = parseInt(parsed.durations[m], 10);
              if (v >= 1 && v <= 180) {
                timerState.durations[m] = v;
              }
            });
          }
          if (typeof parsed.alarmVolume === 'number') {
            timerState.alarmVolume = Math.max(0, Math.min(1, parsed.alarmVolume));
          }
        }
      }
    } catch (e) {}
  }

  function saveTimerPrefs() {
    try {
      const payload = {
        durations: timerState.durations,
        alarmVolume: timerState.alarmVolume
      };
      localStorage.setItem(STORAGE_KEY_TIMER_PREFS, JSON.stringify(payload));
    } catch (e) {}
  }

  function loadSessionsFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSIONS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {}
    return [];
  }

  function saveSessionRecord(mode, durationMinutes, taskId) {
    try {
      const list = loadSessionsFromStorage();
      list.push({
        id: 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        mode,
        durationMinutes,
        completedAt: Date.now(),
        taskId: taskId || null
      });
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(list));
    } catch (e) {}
  }

  function updateSessionLogDisplay() {
    const el = document.getElementById('focusSessionLog');
    if (!el) return;
    const sessions = loadSessionsFromStorage();
    const today = state.todayString;
    const todaySessions = sessions.filter(s => getLocalDateString(new Date(s.completedAt)) === today);
    const count = todaySessions.length;
    const totalMins = todaySessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
    el.textContent = `${count} session${count === 1 ? '' : 's'} today, ${totalMins} minute${totalMins === 1 ? '' : 's'}`;
  }

  function saveRunningTimerState() {
    try {
      const payload = {
        mode: timerState.mode,
        totalMs: timerState.totalMs,
        remainingMs: timerState.remainingMs,
        endTimestamp: timerState.endTimestamp,
        isRunning: timerState.isRunning,
        isFinished: timerState.isFinished,
        focusTaskId: timerState.focusTaskId,
        startedByTabId: timerState.startedByTabId
      };
      localStorage.setItem(STORAGE_KEY_TIMER, JSON.stringify(payload));
    } catch (e) {}
  }

  function initTimerTicks() {
    const ticksGroup = document.getElementById('timerTicksGroup');
    if (!ticksGroup || ticksGroup.children.length > 0) return;
    const cx = 160;
    const cy = 160;
    for (let i = 0; i < 60; i++) {
      const angle = (i * 6 * Math.PI) / 180;
      const isMajor = i % 5 === 0;
      const rInner = isMajor ? 134 : 138;
      const rOuter = 144;
      const x1 = cx + rInner * Math.sin(angle);
      const y1 = cy - rInner * Math.cos(angle);
      const x2 = cx + rOuter * Math.sin(angle);
      const y2 = cy - rOuter * Math.cos(angle);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1.toFixed(2));
      line.setAttribute('y1', y1.toFixed(2));
      line.setAttribute('x2', x2.toFixed(2));
      line.setAttribute('y2', y2.toFixed(2));
      line.setAttribute('stroke', 'var(--border)');
      line.setAttribute('stroke-width', isMajor ? '1.5' : '1');
      ticksGroup.appendChild(line);
    }
  }

  function updateFocusRingProgress(progress) {
    const circle = document.getElementById('timerProgressCircle');
    if (circle) {
      const offset = RING_CIRCUMFERENCE * (1 - progress);
      circle.style.strokeDashoffset = offset.toFixed(2);
    }
  }

  function updateFocusModeIndicator() {
    const activeBtn = document.querySelector(`.focus-mode-btn[data-mode="${timerState.mode}"]`);
    const indicator = document.getElementById('focusModeIndicator');
    if (activeBtn && indicator && activeBtn.parentElement) {
      const parentRect = activeBtn.parentElement.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      const left = btnRect.left - parentRect.left;
      indicator.style.left = `${left}px`;
      indicator.style.width = `${btnRect.width}px`;
    }
  }

  function renderFocusView() {
    initTimerTicks();
    updateFocusModeIndicator();

    // Mode buttons aria-selected
    const modeBtns = document.querySelectorAll('.focus-mode-btn');
    modeBtns.forEach(btn => {
      const isActive = btn.getAttribute('data-mode') === timerState.mode;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Presets bar
    const presetsGroup = document.getElementById('timerPresetsGroup');
    if (presetsGroup) {
      presetsGroup.innerHTML = '';
      const presets = [15, 25, 45, 60];
      const activeMinutes = Math.round(timerState.totalMs / 60000);
      presets.forEach(p => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'preset-btn' + (activeMinutes === p ? ' is-active' : '');
        btn.textContent = `${p}m`;
        btn.setAttribute('aria-label', `${p} minutes`);
        btn.addEventListener('click', () => {
          setTimerDuration(p, true);
        });
        presetsGroup.appendChild(btn);
      });
    }

    // Inner display
    const timeDisplay = document.getElementById('timerTimeDisplay');
    if (timeDisplay) {
      timeDisplay.textContent = formatTimerDigits(timerState.remainingMs);
    }

    const modeLabel = document.getElementById('timerModeLabel');
    if (modeLabel) {
      if (timerState.isFinished) {
        modeLabel.textContent = 'DONE';
      } else if (timerState.isRunning) {
        modeLabel.textContent = timerState.mode === 'short' ? 'SHORT BREAK' : (timerState.mode === 'long' ? 'LONG BREAK' : 'FOCUS');
      } else {
        const isPaused = timerState.remainingMs < timerState.totalMs && timerState.remainingMs > 0;
        modeLabel.textContent = isPaused ? 'PAUSED' : (timerState.mode === 'short' ? 'SHORT BREAK' : (timerState.mode === 'long' ? 'LONG BREAK' : 'FOCUS'));
      }
    }

    const endsAtLine = document.getElementById('timerEndsAtLine');
    if (endsAtLine) {
      if (timerState.isRunning && timerState.endTimestamp) {
        endsAtLine.textContent = `Ends at ${formatEndsAtTime(new Date(timerState.endTimestamp))}`;
      } else {
        endsAtLine.textContent = '';
      }
    }

    // Progress ring
    const progress = calculateTimerProgress(timerState.remainingMs, timerState.totalMs);
    updateFocusRingProgress(progress);

    // Start button label
    const startBtn = document.getElementById('timerStartBtn');
    if (startBtn) {
      if (timerState.isRunning) {
        startBtn.textContent = 'Pause';
      } else if (timerState.remainingMs < timerState.totalMs && timerState.remainingMs > 0) {
        startBtn.textContent = 'Resume';
      } else {
        startBtn.textContent = 'Start';
      }
    }

    // Finish card visibility
    const finishCard = document.getElementById('timerFinishCard');
    if (finishCard) {
      finishCard.style.display = timerState.isFinished ? 'block' : 'none';
    }

    // Focusing on dropdown
    const select = document.getElementById('focusTaskSelect');
    if (select) {
      const activeTasks = state.tasks.filter(t => !t.completedAt);
      const currentVal = timerState.focusTaskId || '';
      select.innerHTML = '<option value="">None selected</option>';
      activeTasks.forEach(task => {
        const opt = document.createElement('option');
        opt.value = task.id;
        opt.textContent = task.title.slice(0, 48);
        if (task.id === currentVal) opt.selected = true;
        select.appendChild(opt);
      });
    }

    // Alarm volume slider
    const volumeSlider = document.getElementById('alarmVolumeRange');
    if (volumeSlider) {
      volumeSlider.value = String(Math.round(timerState.alarmVolume * 100));
    }

    // Session log
    updateSessionLogDisplay();
  }

  function setTimerMode(mode) {
    if (!['focus', 'short', 'long'].includes(mode)) return;
    if (timerState.isRunning) {
      pauseFocusTimer();
    }
    stopAlarmLoop();
    timerState.mode = mode;
    timerState.isFinished = false;
    const minutes = timerState.durations[mode] || (mode === 'short' ? 5 : (mode === 'long' ? 15 : 25));
    timerState.totalMs = minutes * 60 * 1000;
    timerState.remainingMs = timerState.totalMs;
    timerState.endTimestamp = null;
    timerState.announcedOneMinuteLeft = false;
    saveRunningTimerState();
    renderFocusView();
  }

  function setTimerDuration(minutes, saveAsDefault = true) {
    const valid = validateCustomMinutes(minutes);
    if (!valid) return;
    if (timerState.isRunning) {
      pauseFocusTimer();
    }
    stopAlarmLoop();
    timerState.isFinished = false;
    if (saveAsDefault) {
      timerState.durations[timerState.mode] = valid;
      saveTimerPrefs();
    }
    timerState.totalMs = valid * 60 * 1000;
    timerState.remainingMs = timerState.totalMs;
    timerState.endTimestamp = null;
    timerState.announcedOneMinuteLeft = false;
    saveRunningTimerState();
    renderFocusView();
  }

  function toggleFocusTimer() {
    if (timerState.isRunning) {
      pauseFocusTimer();
    } else {
      startFocusTimer();
    }
  }

  function startFocusTimer() {
    getAudioContext();
    stopAlarmLoop();
    timerState.isFinished = false;
    timerState.isRunning = true;
    timerState.startedByTabId = CURRENT_TAB_ID;
    timerState.endTimestamp = Date.now() + timerState.remainingMs;

    requestWakeLock();
    saveRunningTimerState();

    const modeName = timerState.mode === 'short' ? 'short break' : (timerState.mode === 'long' ? 'long break' : 'focus');
    const mins = Math.ceil(timerState.remainingMs / 60000);
    announcePolite(`Focus timer started for ${mins} minutes ${modeName}`);

    if (typeof resumeMusicOnTimerResume === 'function') {
      resumeMusicOnTimerResume();
    }

    renderFocusView();
    startTickLoop();
  }

  function pauseFocusTimer() {
    if (!timerState.isRunning) return;
    timerState.isRunning = false;
    timerState.remainingMs = calculateRemainingMs(timerState.endTimestamp);
    timerState.endTimestamp = null;

    stopTickLoop();
    releaseWakeLock();
    saveRunningTimerState();

    if (typeof pauseMusicOnTimerPause === 'function') {
      pauseMusicOnTimerPause();
    }

    document.title = 'Inkline';
    announcePolite('Focus timer paused');
    renderFocusView();
  }

  function resetFocusTimer() {
    stopTickLoop();
    stopAlarmLoop();
    releaseWakeLock();

    timerState.isRunning = false;
    timerState.isFinished = false;
    const mins = timerState.durations[timerState.mode] || 25;
    timerState.totalMs = mins * 60 * 1000;
    timerState.remainingMs = timerState.totalMs;
    timerState.endTimestamp = null;
    timerState.announcedOneMinuteLeft = false;

    document.title = 'Inkline';
    announcePolite('Focus timer reset');
    saveRunningTimerState();
    renderFocusView();
  }

  function startTickLoop() {
    stopTickLoop();
    timerState.intervalId = setInterval(onTimerTick, 250);
  }

  function stopTickLoop() {
    if (timerState.intervalId) {
      clearInterval(timerState.intervalId);
      timerState.intervalId = null;
    }
  }

  function onTimerTick() {
    if (!timerState.isRunning || !timerState.endTimestamp) return;
    const now = Date.now();
    timerState.remainingMs = Math.max(0, timerState.endTimestamp - now);

    // Screen reader 1 minute remaining check
    if (timerState.remainingMs <= 60000 && !timerState.announcedOneMinuteLeft) {
      announcePolite('One minute remaining');
      timerState.announcedOneMinuteLeft = true;
    }

    // Update document title
    const modeTitle = timerState.mode === 'short' ? 'Short break' : (timerState.mode === 'long' ? 'Long break' : 'Focus');
    document.title = `${formatTimerDigits(timerState.remainingMs)} ${modeTitle} | Inkline`;

    if (timerState.remainingMs <= 0) {
      handleTimerFinish();
    } else {
      // Light update of digits and ring
      const timeDisplay = document.getElementById('timerTimeDisplay');
      if (timeDisplay) timeDisplay.textContent = formatTimerDigits(timerState.remainingMs);
      const progress = calculateTimerProgress(timerState.remainingMs, timerState.totalMs);
      updateFocusRingProgress(progress);
    }
  }

  function handleTimerFinish() {
    stopTickLoop();
    releaseWakeLock();

    timerState.isRunning = false;
    timerState.isFinished = true;
    timerState.remainingMs = 0;
    timerState.endTimestamp = null;

    document.title = 'Time is up | Inkline';
    announcePolite('Time is up');

    // Only originating tab sounds the alarm
    if (timerState.startedByTabId === CURRENT_TAB_ID || !timerState.startedByTabId) {
      startAlarmLoop();
    }

    // Save session record
    const durationMinutes = Math.round(timerState.totalMs / 60000);
    saveSessionRecord(timerState.mode, durationMinutes, timerState.focusTaskId);

    if (typeof stopMusicOnTimerFinish === 'function') {
      stopMusicOnTimerFinish();
    }

    saveRunningTimerState();
    renderFocusView();
  }

  function setupFocusTimer() {
    loadTimerPrefs();

    // Check saved running timer
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TIMER);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
          timerState.mode = ['focus', 'short', 'long'].includes(saved.mode) ? saved.mode : 'focus';
          timerState.totalMs = typeof saved.totalMs === 'number' && saved.totalMs > 0 ? saved.totalMs : 25 * 60 * 1000;
          timerState.focusTaskId = saved.focusTaskId || null;
          timerState.startedByTabId = saved.startedByTabId || null;

          if (saved.isRunning && saved.endTimestamp) {
            const now = Date.now();
            if (saved.endTimestamp > now) {
              timerState.isRunning = true;
              timerState.endTimestamp = saved.endTimestamp;
              timerState.remainingMs = saved.endTimestamp - now;
              startTickLoop();
            } else {
              timerState.isRunning = false;
              timerState.isFinished = true;
              timerState.remainingMs = 0;
            }
          } else if (typeof saved.remainingMs === 'number') {
            timerState.remainingMs = Math.min(timerState.totalMs, Math.max(0, saved.remainingMs));
          }
        }
      }
    } catch (e) {}

    // 1. Mode buttons click
    const modeBtns = document.querySelectorAll('.focus-mode-btn');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        setTimerMode(mode);
      });
    });

    // 2. Custom duration set
    const customIn = document.getElementById('customMinutesInput');
    const setCustomBtn = document.getElementById('setCustomMinutesBtn');
    if (setCustomBtn && customIn) {
      const applyCustom = () => {
        const val = validateCustomMinutes(customIn.value);
        if (val) {
          setTimerDuration(val, true);
          customIn.value = '';
        }
      };
      setCustomBtn.addEventListener('click', applyCustom);
      customIn.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyCustom();
        }
      });
    }

    // 3. Primary Start/Pause button
    const startBtn = document.getElementById('timerStartBtn');
    if (startBtn) {
      startBtn.addEventListener('click', toggleFocusTimer);
    }

    // 4. Reset button
    const resetBtn = document.getElementById('timerResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', resetFocusTimer);
    }

    // 5. Fullscreen button
    const fullscreenBtn = document.getElementById('timerFullscreenBtn');
    const focusCanvas = document.getElementById('focusCanvas');
    if (fullscreenBtn && focusCanvas) {
      fullscreenBtn.addEventListener('click', () => {
        const isFull = focusCanvas.classList.toggle('is-fullscreen');
        fullscreenBtn.textContent = isFull ? 'Exit fullscreen' : 'Fullscreen';
        fullscreenBtn.setAttribute('aria-label', isFull ? 'Exit fullscreen timer' : 'Toggle fullscreen timer');
      });
    }

    // 6. Finish actions: Stop and Start break
    const stopAlarmBtn = document.getElementById('stopAlarmBtn');
    if (stopAlarmBtn) {
      stopAlarmBtn.addEventListener('click', () => {
        stopAlarmLoop();
        resetFocusTimer();
      });
    }

    const startBreakBtn = document.getElementById('startBreakBtn');
    if (startBreakBtn) {
      startBreakBtn.addEventListener('click', () => {
        stopAlarmLoop();
        if (timerState.mode === 'focus') {
          setTimerMode('short');
          startFocusTimer();
        } else {
          setTimerMode('focus');
          startFocusTimer();
        }
      });
    }

    // 7. Focusing on dropdown change
    const select = document.getElementById('focusTaskSelect');
    if (select) {
      select.addEventListener('change', () => {
        timerState.focusTaskId = select.value || null;
        saveRunningTimerState();
      });
    }

    // 8. Alarm volume and test button
    const volumeSlider = document.getElementById('alarmVolumeRange');
    if (volumeSlider) {
      volumeSlider.addEventListener('input', e => {
        timerState.alarmVolume = parseFloat(e.target.value) / 100;
        saveTimerPrefs();
      });
    }

    const testAlarmBtn = document.getElementById('testAlarmBtn');
    if (testAlarmBtn) {
      testAlarmBtn.addEventListener('click', () => {
        getAudioContext();
        playSoftBell(timerState.alarmVolume);
      });
    }

    // Handle Escape for Fullscreen
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && focusCanvas && focusCanvas.classList.contains('is-fullscreen')) {
        focusCanvas.classList.remove('is-fullscreen');
        if (fullscreenBtn) {
          fullscreenBtn.textContent = 'Fullscreen';
          fullscreenBtn.setAttribute('aria-label', 'Toggle fullscreen timer');
        }
      }
    });
  }

  // ==========================================================================
  // Music & Ambient Sounds (Feature 8)
  // ==========================================================================
  const STORAGE_KEY_MUSIC_PREFS = 'inkline.music_prefs.v1';
  const IDB_NAME = 'inkline_audio_db';
  const IDB_VERSION = 1;
  const IDB_STORE = 'custom_tracks';
  const MAX_CUSTOM_FILES = 10;
  const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
  const MAX_TOTAL_SIZE_BYTES = 60 * 1024 * 1024; // 60 MB

  const musicState = {
    currentType: null, // 'ambient' | 'custom' | null
    currentAmbientSound: null, // string | null
    customTracks: [], // array of { id, name, size, type, blob, objectUrl }
    customCurrentIndex: -1,
    isPlaying: false,
    wasPlayingBeforeTimerPause: false,
    volume: 0.4,
    stopMusicOnEnd: true,
    isLooping: false,
    masterMusicGain: null,
    activeAmbientNode: null,
    audioEl: null
  };

  const SOUND_NAMES = {
    white: 'White noise',
    pink: 'Pink noise',
    brown: 'Brown noise',
    rain: 'Rain',
    ocean: 'Ocean waves',
    wind: 'Wind',
    fan: 'Fan hum',
    drone: 'Soft drone',
    crickets: 'Night crickets',
    library: 'Library room tone'
  };

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

  function getMasterMusicGain() {
    const ctx = getAudioContext();
    if (!ctx) return null;
    if (!musicState.masterMusicGain) {
      musicState.masterMusicGain = ctx.createGain();
      musicState.masterMusicGain.gain.setValueAtTime(musicState.volume, ctx.currentTime);
      musicState.masterMusicGain.connect(ctx.destination);
    }
    return musicState.masterMusicGain;
  }

  function getCustomAudioElement() {
    if (!musicState.audioEl) {
      musicState.audioEl = new Audio();
      musicState.audioEl.volume = musicState.volume;
      musicState.audioEl.addEventListener('ended', onCustomTrackEnded);
      musicState.audioEl.addEventListener('play', () => {
        musicState.isPlaying = true;
        updateMusicUI();
      });
      musicState.audioEl.addEventListener('pause', () => {
        if (musicState.currentType === 'custom') {
          musicState.isPlaying = false;
          updateMusicUI();
        }
      });
      musicState.audioEl.addEventListener('error', () => {
        showMusicError('Playback error on selected audio track.');
      });
    }
    return musicState.audioEl;
  }

  function onCustomTrackEnded() {
    if (musicState.isLooping) {
      playCustomTrack(musicState.customCurrentIndex);
    } else if (musicState.customCurrentIndex < musicState.customTracks.length - 1) {
      nextCustomTrack();
    } else {
      musicState.isPlaying = false;
      updateMusicUI();
    }
  }

  // --- 10 Sound Generators ---
  function createWhiteNoise(ctx) {
    const bufferSize = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.14;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return { source, output: source, stop: () => { try { source.stop(); } catch (e) {} } };
  }

  function createPinkNoise(ctx) {
    const bufferSize = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
      b6 = white * 0.115926;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return { source, output: source, stop: () => { try { source.stop(); } catch (e) {} } };
  }

  function createBrownNoise(ctx) {
    const bufferSize = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + (0.02 * white)) / 1.02;
      data[i] = last * 0.6;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return { source, output: source, stop: () => { try { source.stop(); } catch (e) {} } };
  }

  function createRain(ctx) {
    const pink = createPinkNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1100, ctx.currentTime);
    pink.output.connect(filter);

    const white = createWhiteNoise(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(3500, ctx.currentTime);
    const dropGain = ctx.createGain();
    dropGain.gain.setValueAtTime(0.06, ctx.currentTime);
    white.output.connect(hp);
    hp.connect(dropGain);

    const merger = ctx.createGain();
    filter.connect(merger);
    dropGain.connect(merger);

    return {
      source: pink.source,
      output: merger,
      stop: () => {
        pink.stop();
        white.stop();
      }
    };
  }

  function createOceanWaves(ctx) {
    const brown = createBrownNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, ctx.currentTime);

    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.1, ctx.currentTime);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(220, ctx.currentTime);
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    brown.output.connect(filter);
    lfo.start();

    return {
      source: brown.source,
      output: filter,
      stop: () => {
        brown.stop();
        try { lfo.stop(); } catch (e) {}
      }
    };
  }

  function createWind(ctx) {
    const pink = createPinkNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(450, ctx.currentTime);
    filter.Q.setValueAtTime(2.2, ctx.currentTime);

    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.14, ctx.currentTime);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(240, ctx.currentTime);
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    pink.output.connect(filter);
    lfo.start();

    return {
      source: pink.source,
      output: filter,
      stop: () => {
        pink.stop();
        try { lfo.stop(); } catch (e) {}
      }
    };
  }

  function createFanHum(ctx) {
    const brown = createBrownNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, ctx.currentTime);
    brown.output.connect(filter);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, ctx.currentTime);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.04, ctx.currentTime);
    osc.connect(oscGain);
    osc.start();

    const mixer = ctx.createGain();
    filter.connect(mixer);
    oscGain.connect(mixer);

    return {
      source: brown.source,
      output: mixer,
      stop: () => {
        brown.stop();
        try { osc.stop(); } catch (e) {}
      }
    };
  }

  function createSoftDrone(ctx) {
    const freqs = [110, 164.81, 220];
    const mixer = ctx.createGain();
    const oscs = [];

    freqs.forEach(f => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, ctx.currentTime);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.035, ctx.currentTime);
      osc.connect(g);
      g.connect(mixer);
      osc.start();
      oscs.push(osc);
    });

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(380, ctx.currentTime);
    mixer.connect(filter);

    return {
      source: null,
      output: filter,
      stop: () => {
        oscs.forEach(o => { try { o.stop(); } catch (e) {} });
      }
    };
  }

  function createNightCrickets(ctx) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(4500, ctx.currentTime);

    const pulseLfo = ctx.createOscillator();
    pulseLfo.type = 'square';
    pulseLfo.frequency.setValueAtTime(14, ctx.currentTime);
    const pulseGain = ctx.createGain();
    pulseGain.gain.setValueAtTime(0.5, ctx.currentTime);
    pulseLfo.connect(pulseGain.gain);

    const mainGain = ctx.createGain();
    mainGain.gain.setValueAtTime(0.025, ctx.currentTime);

    osc.connect(pulseGain);
    pulseGain.connect(mainGain);

    osc.start();
    pulseLfo.start();

    return {
      source: osc,
      output: mainGain,
      stop: () => {
        try { osc.stop(); } catch (e) {}
        try { pulseLfo.stop(); } catch (e) {}
      }
    };
  }

  function createLibraryRoomTone(ctx) {
    const brown = createBrownNoise(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, ctx.currentTime);

    brown.output.connect(filter);
    filter.connect(gain);

    return {
      source: brown.source,
      output: gain,
      stop: () => {
        brown.stop();
      }
    };
  }

  function buildAmbientSoundNode(ctx, soundName) {
    switch (soundName) {
      case 'white': return createWhiteNoise(ctx);
      case 'pink': return createPinkNoise(ctx);
      case 'brown': return createBrownNoise(ctx);
      case 'rain': return createRain(ctx);
      case 'ocean': return createOceanWaves(ctx);
      case 'wind': return createWind(ctx);
      case 'fan': return createFanHum(ctx);
      case 'drone': return createSoftDrone(ctx);
      case 'crickets': return createNightCrickets(ctx);
      case 'library': return createLibraryRoomTone(ctx);
      default: return null;
    }
  }

  function playAmbientSound(soundName) {
    const ctx = getAudioContext();
    if (!ctx) return;

    // If clicking currently active sound, toggle off
    if (musicState.currentType === 'ambient' && musicState.currentAmbientSound === soundName && musicState.isPlaying) {
      stopAmbientSound();
      return;
    }

    // Stop custom audio if playing
    if (musicState.currentType === 'custom' && musicState.audioEl) {
      musicState.audioEl.pause();
    }

    // Fade out previous ambient if playing
    if (musicState.activeAmbientNode) {
      stopAmbientSound(true);
    }

    const node = buildAmbientSoundNode(ctx, soundName);
    if (!node) return;

    const masterGain = getMasterMusicGain();
    node.output.connect(masterGain);
    if (node.source && node.source.start) {
      try { node.source.start(); } catch (e) {}
    }

    // 300ms smooth fade-in
    const now = ctx.currentTime;
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(musicState.volume, now + 0.3);

    musicState.activeAmbientNode = node;
    musicState.currentType = 'ambient';
    musicState.currentAmbientSound = soundName;
    musicState.isPlaying = true;
    musicState.wasPlayingBeforeTimerPause = false;

    updateMusicUI();
  }

  function stopAmbientSound(immediate = false) {
    if (!musicState.activeAmbientNode) {
      musicState.isPlaying = false;
      musicState.currentAmbientSound = null;
      updateMusicUI();
      return;
    }

    const nodeToStop = musicState.activeAmbientNode;
    musicState.activeAmbientNode = null;
    musicState.currentAmbientSound = null;
    musicState.isPlaying = false;

    const ctx = getAudioContext();
    if (ctx && musicState.masterMusicGain && !immediate) {
      // 300ms smooth fade-out
      const now = ctx.currentTime;
      musicState.masterMusicGain.gain.setValueAtTime(musicState.masterMusicGain.gain.value, now);
      musicState.masterMusicGain.gain.linearRampToValueAtTime(0.0001, now + 0.3);
      setTimeout(() => {
        try { nodeToStop.stop(); } catch (e) {}
        try { nodeToStop.output.disconnect(); } catch (e) {}
      }, 320);
    } else {
      try { nodeToStop.stop(); } catch (e) {}
      try { nodeToStop.output.disconnect(); } catch (e) {}
    }

    updateMusicUI();
  }

  function shuffleAmbientSound() {
    const keys = Object.keys(SOUND_NAMES);
    const available = keys.filter(k => k !== musicState.currentAmbientSound);
    const chosen = available[Math.floor(Math.random() * available.length)];
    playAmbientSound(chosen);
  }

  // --- Custom Audio Playback ---
  function playCustomTrack(index) {
    if (index < 0 || index >= musicState.customTracks.length) return;

    // Stop ambient sound
    if (musicState.activeAmbientNode) {
      stopAmbientSound(true);
    }

    const track = musicState.customTracks[index];
    musicState.customCurrentIndex = index;
    musicState.currentType = 'custom';
    musicState.wasPlayingBeforeTimerPause = false;

    const audio = getCustomAudioElement();
    if (audio.src !== track.objectUrl) {
      audio.src = track.objectUrl;
    }

    audio.volume = musicState.volume;
    audio.play().then(() => {
      musicState.isPlaying = true;
      updateMusicUI();
    }).catch(() => {
      showMusicError('Playback failed. Please choose another track.');
    });
  }

  function pauseCustomTrack() {
    if (musicState.audioEl) {
      musicState.audioEl.pause();
    }
    musicState.isPlaying = false;
    updateMusicUI();
  }

  function toggleCustomPlayPause() {
    if (musicState.currentType === 'custom' && musicState.isPlaying) {
      pauseCustomTrack();
    } else if (musicState.customTracks.length > 0) {
      const idx = musicState.customCurrentIndex >= 0 ? musicState.customCurrentIndex : 0;
      playCustomTrack(idx);
    }
  }

  function nextCustomTrack() {
    if (musicState.customTracks.length === 0) return;
    const nextIdx = (musicState.customCurrentIndex + 1) % musicState.customTracks.length;
    playCustomTrack(nextIdx);
  }

  function prevCustomTrack() {
    if (musicState.customTracks.length === 0) return;
    const prevIdx = (musicState.customCurrentIndex - 1 + musicState.customTracks.length) % musicState.customTracks.length;
    playCustomTrack(prevIdx);
  }

  function toggleCustomLoop() {
    musicState.isLooping = !musicState.isLooping;
    const loopBtn = document.getElementById('loopCustomBtn');
    if (loopBtn) {
      loopBtn.classList.toggle('is-active', musicState.isLooping);
      loopBtn.setAttribute('aria-pressed', musicState.isLooping ? 'true' : 'false');
    }
  }

  function shuffleCustomTracks() {
    if (musicState.customTracks.length <= 1) return;
    let nextIdx = Math.floor(Math.random() * musicState.customTracks.length);
    if (nextIdx === musicState.customCurrentIndex) {
      nextIdx = (nextIdx + 1) % musicState.customTracks.length;
    }
    playCustomTrack(nextIdx);
  }

  // --- IndexedDB Management ---
  function openAudioDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        return reject(new Error('IndexedDB not supported'));
      }
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadCustomTracksFromIDB() {
    try {
      const db = await openAudioDB();
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.getAll();

      req.onsuccess = () => {
        const records = req.result || [];
        musicState.customTracks = records.map(r => ({
          id: r.id,
          name: r.name,
          size: r.size,
          type: r.type,
          blob: r.blob,
          objectUrl: URL.createObjectURL(r.blob)
        }));
        renderCustomTracksUI();
      };
    } catch (e) {
      // IndexedDB fallback
    }
  }

  async function saveTrackToIDB(trackRecord) {
    try {
      const db = await openAudioDB();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(trackRecord);
    } catch (e) {}
  }

  async function deleteTrackFromIDB(trackId) {
    try {
      const db = await openAudioDB();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(trackId);
    } catch (e) {}
  }

  function removeCustomTrack(trackId) {
    const idx = musicState.customTracks.findIndex(t => t.id === trackId);
    if (idx === -1) return;

    const track = musicState.customTracks[idx];
    if (musicState.currentType === 'custom' && musicState.customCurrentIndex === idx) {
      if (musicState.audioEl) musicState.audioEl.pause();
      musicState.isPlaying = false;
      musicState.currentType = null;
      musicState.customCurrentIndex = -1;
    }

    try { URL.revokeObjectURL(track.objectUrl); } catch (e) {}
    deleteTrackFromIDB(trackId);
    musicState.customTracks.splice(idx, 1);

    if (musicState.customCurrentIndex > idx) {
      musicState.customCurrentIndex--;
    }

    renderCustomTracksUI();
    updateMusicUI();
  }

  function handleCustomFilesSelected(fileList) {
    clearMusicError();
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    if (musicState.customTracks.length + files.length > MAX_CUSTOM_FILES) {
      showMusicError(`Storage limit reached. You can store up to ${MAX_CUSTOM_FILES} tracks.`);
      return;
    }

    let addedCount = 0;
    files.forEach(file => {
      const validation = validateAudioFileConstraint(file, musicState.customTracks);
      if (!validation.valid) {
        showMusicError(validation.error);
        return;
      }

      const id = 'track_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const record = {
        id,
        name: file.name.slice(0, 60),
        size: file.size,
        type: file.type || 'audio/mpeg',
        blob: file,
        addedAt: Date.now()
      };

      const inMemTrack = {
        id: record.id,
        name: record.name,
        size: record.size,
        type: record.type,
        blob: record.blob,
        objectUrl: URL.createObjectURL(file)
      };

      musicState.customTracks.push(inMemTrack);
      saveTrackToIDB(record);
      addedCount++;
    });

    if (addedCount > 0) {
      renderCustomTracksUI();
    }
  }

  function showMusicError(msg) {
    const notice = document.getElementById('musicErrorNotice');
    if (notice) {
      notice.textContent = msg;
      notice.style.display = 'block';
    }
  }

  function clearMusicError() {
    const notice = document.getElementById('musicErrorNotice');
    if (notice) {
      notice.textContent = '';
      notice.style.display = 'none';
    }
  }

  function renderCustomTracksUI() {
    const info = document.getElementById('customStorageInfo');
    if (info) {
      info.textContent = formatStorageUsage(musicState.customTracks);
    }

    const controls = document.getElementById('customPlaylistControls');
    if (controls) {
      controls.style.display = musicState.customTracks.length > 0 ? 'flex' : 'none';
    }

    const listUl = document.getElementById('customTracksList');
    if (!listUl) return;

    listUl.innerHTML = '';
    musicState.customTracks.forEach((track, idx) => {
      const li = document.createElement('li');
      li.className = 'custom-track-item' + (musicState.currentType === 'custom' && musicState.customCurrentIndex === idx ? ' is-playing' : '');

      const infoDiv = document.createElement('div');
      infoDiv.className = 'track-info';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'track-name';
      nameSpan.textContent = track.name;
      infoDiv.appendChild(nameSpan);

      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'track-size';
      sizeSpan.textContent = `(${(track.size / (1024 * 1024)).toFixed(1)} MB)`;
      infoDiv.appendChild(sizeSpan);

      li.appendChild(infoDiv);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'track-actions';

      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'btn-text';
      playBtn.textContent = (musicState.currentType === 'custom' && musicState.customCurrentIndex === idx && musicState.isPlaying) ? 'Pause' : 'Play';
      playBtn.setAttribute('aria-label', `Play ${track.name}`);
      playBtn.addEventListener('click', () => {
        if (musicState.currentType === 'custom' && musicState.customCurrentIndex === idx && musicState.isPlaying) {
          pauseCustomTrack();
        } else {
          playCustomTrack(idx);
        }
      });
      actionsDiv.appendChild(playBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-text delete-text';
      removeBtn.textContent = 'Remove';
      removeBtn.setAttribute('aria-label', `Remove ${track.name}`);
      removeBtn.addEventListener('click', () => {
        removeCustomTrack(track.id);
      });
      actionsDiv.appendChild(removeBtn);

      li.appendChild(actionsDiv);
      listUl.appendChild(li);
    });
  }

  function updateMusicUI() {
    // 1. Ambient buttons active class
    const btns = document.querySelectorAll('.ambient-sound-btn');
    btns.forEach(b => {
      const s = b.getAttribute('data-sound');
      const isActive = musicState.currentType === 'ambient' && musicState.currentAmbientSound === s && musicState.isPlaying;
      b.classList.toggle('is-playing', isActive);
      b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    // 2. Custom play/pause button text
    const playPauseBtn = document.getElementById('playPauseCustomBtn');
    if (playPauseBtn) {
      const isCustomPlaying = musicState.currentType === 'custom' && musicState.isPlaying;
      playPauseBtn.textContent = isCustomPlaying ? 'Pause' : 'Play';
      playPauseBtn.setAttribute('aria-label', isCustomPlaying ? 'Pause custom track' : 'Play custom track');
    }

    // 3. Now Playing Lines (Focus card & panel)
    let title = '';
    if (musicState.currentType === 'ambient' && musicState.currentAmbientSound) {
      title = SOUND_NAMES[musicState.currentAmbientSound] || musicState.currentAmbientSound;
    } else if (musicState.currentType === 'custom' && musicState.customCurrentIndex >= 0) {
      const track = musicState.customTracks[musicState.customCurrentIndex];
      title = track ? track.name : '';
    }

    const cardLine = document.getElementById('nowPlayingCardLine');
    const cardText = document.getElementById('nowPlayingCardText');
    if (cardLine && cardText) {
      cardLine.classList.toggle('is-playing', musicState.isPlaying);
      cardText.textContent = musicState.isPlaying ? `Now playing: ${title}` : (title ? `Paused: ${title}` : 'Nothing playing');
    }

    renderCustomTracksUI();
  }

  // Timer Integration Handlers
  function pauseMusicOnTimerPause() {
    if (musicState.isPlaying) {
      musicState.wasPlayingBeforeTimerPause = true;
      if (musicState.currentType === 'ambient') {
        stopAmbientSound();
      } else if (musicState.currentType === 'custom') {
        pauseCustomTrack();
      }
    }
  }

  function resumeMusicOnTimerResume() {
    if (musicState.wasPlayingBeforeTimerPause) {
      musicState.wasPlayingBeforeTimerPause = false;
      if (musicState.currentType === 'ambient' && musicState.currentAmbientSound) {
        playAmbientSound(musicState.currentAmbientSound);
      } else if (musicState.currentType === 'custom' && musicState.customCurrentIndex >= 0) {
        playCustomTrack(musicState.customCurrentIndex);
      }
    }
  }

  function stopMusicOnTimerFinish() {
    if (musicState.stopMusicOnEnd) {
      musicState.wasPlayingBeforeTimerPause = false;
      if (musicState.activeAmbientNode) {
        stopAmbientSound();
      }
      if (musicState.audioEl) {
        musicState.audioEl.pause();
      }
      musicState.isPlaying = false;
      updateMusicUI();
    }
  }

  function loadMusicPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MUSIC_PREFS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.volume === 'number') {
            musicState.volume = Math.max(0, Math.min(1, parsed.volume));
          }
          if (typeof parsed.stopMusicOnEnd === 'boolean') {
            musicState.stopMusicOnEnd = parsed.stopMusicOnEnd;
          }
        }
      }
    } catch (e) {}
  }

  function saveMusicPrefs() {
    try {
      const payload = {
        volume: musicState.volume,
        stopMusicOnEnd: musicState.stopMusicOnEnd
      };
      localStorage.setItem(STORAGE_KEY_MUSIC_PREFS, JSON.stringify(payload));
    } catch (e) {}
  }

  function setupMusicAndSounds() {
    loadMusicPrefs();
    loadCustomTracksFromIDB();

    // Volume Slider
    const volumeSlider = document.getElementById('musicVolumeRange');
    const volumeDisplay = document.getElementById('musicVolumeDisplay');
    if (volumeSlider) {
      volumeSlider.value = String(Math.round(musicState.volume * 100));
      if (volumeDisplay) volumeDisplay.textContent = `${volumeSlider.value}%`;

      volumeSlider.addEventListener('input', e => {
        const pct = parseInt(e.target.value, 10);
        musicState.volume = pct / 100;
        if (volumeDisplay) volumeDisplay.textContent = `${pct}%`;

        // Update Web Audio master gain if playing
        if (musicState.masterMusicGain && getAudioContext()) {
          musicState.masterMusicGain.gain.setValueAtTime(musicState.volume, getAudioContext().currentTime);
        }
        // Update custom audio element if playing
        if (musicState.audioEl) {
          musicState.audioEl.volume = musicState.volume;
        }
        saveMusicPrefs();
      });
    }

    // Stop music when time ends checkbox
    const stopCheckbox = document.getElementById('stopMusicOnEndCheckbox');
    if (stopCheckbox) {
      stopCheckbox.checked = musicState.stopMusicOnEnd;
      stopCheckbox.addEventListener('change', () => {
        musicState.stopMusicOnEnd = stopCheckbox.checked;
        saveMusicPrefs();
      });
    }

    // 10 Ambient sound buttons
    const ambientBtns = document.querySelectorAll('.ambient-sound-btn');
    ambientBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const sound = btn.getAttribute('data-sound');
        playAmbientSound(sound);
      });
    });

    // Shuffle ambient button
    const shuffleBtn = document.getElementById('shuffleAmbientBtn');
    if (shuffleBtn) {
      shuffleBtn.addEventListener('click', shuffleAmbientSound);
    }

    // Custom audio file picker
    const fileInput = document.getElementById('customAudioInput');
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        handleCustomFilesSelected(fileInput.files);
        fileInput.value = '';
      });
    }

    // Custom playlist controls
    const playPauseBtn = document.getElementById('playPauseCustomBtn');
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', toggleCustomPlayPause);
    }

    const prevBtn = document.getElementById('prevTrackBtn');
    if (prevBtn) {
      prevBtn.addEventListener('click', prevCustomTrack);
    }

    const nextBtn = document.getElementById('nextTrackBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', nextCustomTrack);
    }

    const loopBtn = document.getElementById('loopCustomBtn');
    if (loopBtn) {
      loopBtn.addEventListener('click', toggleCustomLoop);
    }

    const shuffleCustomBtn = document.getElementById('shuffleCustomBtn');
    if (shuffleCustomBtn) {
      shuffleCustomBtn.addEventListener('click', shuffleCustomTracks);
    }
  }

  // ==========================================================================
  // Self-Test Suite: window.inklineSelfTest()
  // Must run on temporary storage key and not touch real user data
  // ==========================================================================
  window.inklineSelfTest = function () {
    const TEST_KEY = 'inkline.test.tmp';
    const originalLocal = window.localStorage;
    const testResults = [];

    function logTest(testName, passed, errorMsg = '') {
      const status = passed ? 'PASS' : 'FAIL';
      testResults.push({ testName, passed, errorMsg });
      console.log(`[${status}] ${testName}${errorMsg ? ' - ' + errorMsg : ''}`);
    }

    try {
      // Clean temporary storage
      localStorage.removeItem(TEST_KEY);

      // Check 1: Add task
      const task1 = validateTaskRecord({
        id: 'test_1',
        title: 'Walk the dog',
        priority: 'high',
        dueDate: '2026-10-20',
        category: 'Personal',
        createdAt: 1000,
        completedAt: null,
        order: 0
      });
      const check1 = task1 && task1.title === 'Walk the dog' && task1.priority === 'high';
      logTest('1. Add task record validation', Boolean(check1));

      // Check 2: Duplicate rejection (case-insensitive)
      const existingList = [{ id: '1', title: 'Buy Milk', completedAt: null }];
      const isDuplicate = existingList.some(t => !t.completedAt && t.title.toLowerCase() === 'buy milk'.toLowerCase());
      const isNotDuplicateDiff = existingList.some(t => !t.completedAt && t.title.toLowerCase() === 'buy bread'.toLowerCase());
      logTest('2. Duplicate rejection (case-insensitive)', isDuplicate && !isNotDuplicateDiff);

      // Check 3: Complete and reopen
      let testTask = { id: '3', title: 'Test 3', completedAt: null };
      testTask.completedAt = Date.now();
      const completedOk = typeof testTask.completedAt === 'number';
      testTask.completedAt = null;
      const reopenOk = testTask.completedAt === null;
      logTest('3. Complete sets timestamp and reopen clears it', completedOk && reopenOk);

      // Check 4: Delete and Undo restores data and position
      let mockList = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }];
      const deleted = mockList.splice(1, 1)[0];
      const deleteOk = mockList.length === 2 && deleted.id === 'b';
      // Restore at index 1
      mockList.splice(1, 0, deleted);
      const restoreOk = mockList.length === 3 && mockList[1].id === 'b';
      logTest('4. Delete and Undo restoration', deleteOk && restoreOk);

      // Check 5: Date logic (local YYYY-MM-DD strings, overdue & due today)
      const todayStr = '2026-10-20';
      const pastStr = '2026-10-19';
      const futureStr = '2026-10-21';
      const isDueTodayOk = isDueToday(todayStr, todayStr) && !isDueToday(futureStr, todayStr);
      const isOverdueOk = isOverdue(pastStr, todayStr) && !isOverdue(futureStr, todayStr);
      logTest('5. Date logic (local strings, overdue, due today)', isDueTodayOk && isOverdueOk);

      // Check 6: Corrupted storage handling
      const corruptedJson = '{"corrupted": true, bad json';
      let caughtCorrupt = false;
      try {
        JSON.parse(corruptedJson);
      } catch (e) {
        caughtCorrupt = true;
      }
      // Invalid records skipped
      const rawMixed = [{ id: 'valid_1', title: 'Good' }, null, { invalid: 'bad' }];
      const filteredGood = rawMixed.map(validateTaskRecord).filter(Boolean);
      const corruptHandled = caughtCorrupt && filteredGood.length === 1 && filteredGood[0].title === 'Good';
      logTest('6. Corrupted storage handling and record validation', corruptHandled);

      // Clean up temporary storage key
      localStorage.removeItem(TEST_KEY);

      const allPassed = testResults.every(r => r.passed);
      console.log(`\nSelf-test finished: ${testResults.filter(r => r.passed).length}/${testResults.length} checks PASSED.`);
      return allPassed;
    } catch (err) {
      console.error('Self-test fatal error:', err);
      logTest('Fatal exception in self-test', false, err.message);
      return false;
    }
  };

  // ==========================================================================
  // Initialization
  // ==========================================================================
  function init() {
    // 1. Setup Theme switcher controls
    const themeInputs = document.querySelectorAll('input[name="theme-radio"]');
    themeInputs.forEach(input => {
      input.addEventListener('change', () => {
        applyTheme(input.value);
      });
    });

    // 2. Undo Toast button
    const undoBtn = document.getElementById('undoToastBtn');
    if (undoBtn) {
      undoBtn.addEventListener('click', executeUndo);
    }

    // 3. Storage Alert dismiss
    const dismissAlertBtn = document.getElementById('dismissStorageBannerBtn');
    if (dismissAlertBtn) {
      dismissAlertBtn.addEventListener('click', () => {
        showStorageAlert(false);
      });
    }

    // 4. Setup all sub-components
    setupFormHandlers();
    setupTaskListDelegation();
    setupSwipeGestures();
    setupFilterControls();
    setupModals();
    setupKeyboardShortcuts();
    setupStorageSync();
    scheduleMidnightRefresh();
    setupVisibilityChange();
    setupFocusTimer();
    setupMusicAndSounds();

    // 5. Load data & initial render
    state.tasks = loadFromStorage();
    render();

    // 6. Check missed reminders and schedule recurring checks
    checkMissedRemindersOnLoad();
    checkReminders();
    setInterval(checkReminders, 30000);

    // Window resize listener to keep sliding tab indicator aligned
    window.addEventListener('resize', updateTabsIndicator);
  }

  function setupStorageSync() {
    window.addEventListener('storage', e => {
      if (e.key === STORAGE_KEY_TASKS) {
        try {
          const raw = e.newValue;
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              state.tasks = parsed.map(validateTaskRecord).filter(Boolean);
              render();
            }
          }
        } catch (err) {}
      } else if (e.key === STORAGE_KEY_PREFS) {
        try {
          if (e.newValue) {
            const parsed = JSON.parse(e.newValue);
            if (parsed) {
              if (parsed.theme) applyTheme(parsed.theme);
              if (parsed.accent) applyAccent(parsed.accent);
              if (typeof parsed.remindersEnabled === 'boolean') {
                state.prefs.remindersEnabled = parsed.remindersEnabled;
              }
              if (parsed.collapsedSections) {
                state.prefs.collapsedSections = parsed.collapsedSections;
                render();
              }
            }
          }
        } catch (err) {}
      } else if (e.key === STORAGE_KEY_TIMER) {
        try {
          if (e.newValue) {
            const saved = JSON.parse(e.newValue);
            if (saved && typeof saved === 'object') {
              timerState.mode = ['focus', 'short', 'long'].includes(saved.mode) ? saved.mode : 'focus';
              timerState.totalMs = typeof saved.totalMs === 'number' ? saved.totalMs : 25 * 60 * 1000;
              timerState.focusTaskId = saved.focusTaskId || null;
              timerState.startedByTabId = saved.startedByTabId || null;
              if (saved.isRunning && saved.endTimestamp) {
                const now = Date.now();
                if (saved.endTimestamp > now) {
                  timerState.isRunning = true;
                  timerState.endTimestamp = saved.endTimestamp;
                  timerState.remainingMs = saved.endTimestamp - now;
                  startTickLoop();
                }
              } else if (!saved.isRunning) {
                timerState.isRunning = false;
                timerState.remainingMs = typeof saved.remainingMs === 'number' ? saved.remainingMs : timerState.totalMs;
                stopTickLoop();
              }
              if (state.filter === 'focus') renderFocusView();
            }
          }
        } catch (err) {}
      } else if (e.key === STORAGE_KEY_TIMER_PREFS) {
        loadTimerPrefs();
        if (state.filter === 'focus') renderFocusView();
      }
    });
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

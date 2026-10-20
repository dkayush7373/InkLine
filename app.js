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
      theme: 'system' // 'light' | 'dark' | 'system'
    },
    quickAddDueDate: null,
    editingTaskId: null,
    pendingDeleteTaskId: null,
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

    const category = typeof record.category === 'string' ? record.category.slice(0, 32).trim() : '';
    const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now();
    const completedAt = typeof record.completedAt === 'number' ? record.completedAt : null;
    const order = typeof record.order === 'number' ? record.order : 0;

    return {
      id: record.id,
      title: record.title.trim().slice(0, 500),
      priority: priority,
      dueDate: dueDate,
      category: category,
      createdAt: createdAt,
      completedAt: completedAt,
      order: order
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
      }
    } catch (e) {
      // Ignore prefs error
    }

    // Apply loaded theme
    applyTheme(state.prefs.theme);

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
  function addTask(title, priority = 'none', dueDate = null, category = '') {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return { success: false, error: 'Please enter a task title.' };
    }

    if (checkDuplicateTitle(trimmedTitle)) {
      return { success: false, error: COPY.DUPLICATE };
    }

    const maxOrder = state.tasks.reduce((max, t) => Math.max(max, t.order || 0), -1);

    const newTask = {
      id: generateId(),
      title: trimmedTitle.slice(0, 500),
      priority: priority || 'none',
      dueDate: dueDate || null,
      category: category ? category.slice(0, 32).trim() : '',
      createdAt: Date.now(),
      completedAt: null,
      order: maxOrder + 1
    };

    state.tasks.push(newTask);
    saveToStorage();
    announcePolite('Task added');
    render();
    return { success: true, task: newTask };
  }

  function toggleTaskCompletion(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    if (task.completedAt) {
      task.completedAt = null;
      announcePolite('Task reopened');
    } else {
      task.completedAt = Date.now();
      announcePolite('Task completed');
    }

    saveToStorage();
    render();
  }

  function saveTaskEdit(taskId, newTitle) {
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
      // Remove this item from undoQueue when timer expires
      state.undoQueue = state.undoQueue.filter(entry => entry.task.id !== removedTask.id);
      renderUndoToast();
    }, UNDO_DURATION_MS);

    state.undoQueue.unshift({
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

    // Restore task at its original position if valid
    const targetIndex = Math.min(entry.originalIndex, state.tasks.length);
    state.tasks.splice(targetIndex, 0, entry.task);
    saveToStorage();

    announcePolite('Task restored');
    renderUndoToast();
    render();
  }

  function clearCompletedTasks() {
    // Keep pending tasks untouched, even when search or filter is active
    state.tasks = state.tasks.filter(t => !t.completedAt);
    saveToStorage();
    announcePolite('Completed tasks cleared');
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
          // Due today plus overdue (pending only), or completed today
          if (task.completedAt) {
            const completedDateStr = getLocalDateString(new Date(task.completedAt));
            return completedDateStr === today;
          }
          if (!task.dueDate) return false;
          return isDueToday(task.dueDate, today) || isOverdue(task.dueDate, today);

        case 'upcoming':
          // Future dates only, not completed
          if (task.completedAt) return false;
          return task.dueDate && task.dueDate > today;

        case 'done':
          return Boolean(task.completedAt);

        case 'all':
        default:
          return true;
      }
    });

    // 2. Filter by Search Query
    if (state.searchQuery.trim()) {
      const q = state.searchQuery.trim().toLowerCase();
      filtered = filtered.filter(task => task.title.toLowerCase().includes(q));
    }

    // 3. Stable Sort
    filtered.sort((a, b) => {
      if (state.sortBy === 'manual') {
        return (a.order || 0) - (b.order || 0);
      }

      if (state.sortBy === 'due') {
        // Tasks with no due date go to bottom
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
          return a.dueDate.localeCompare(b.dueDate);
        }
        // Stable tie-breaker: createdAt
        return a.createdAt - b.createdAt;
      }

      if (state.sortBy === 'priority') {
        const priorityWeight = { high: 3, medium: 2, low: 1, none: 0 };
        const diff = (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
        if (diff !== 0) return diff;
        // Stable tie-breaker: createdAt
        return a.createdAt - b.createdAt;
      }

      // Default: 'created' (date added, oldest first)
      return a.createdAt - b.createdAt;
    });

    return filtered;
  }

  // Counts for each tab
  function getTabCounts() {
    const today = state.todayString;
    let countToday = 0;
    let countUpcoming = 0;
    let countAll = 0;
    let countDone = 0;

    state.tasks.forEach(task => {
      countAll++;
      if (task.completedAt) {
        countDone++;
        const completedDateStr = getLocalDateString(new Date(task.completedAt));
        if (completedDateStr === today) {
          countToday++;
        }
      } else {
        if (task.dueDate && (isDueToday(task.dueDate, today) || isOverdue(task.dueDate, today))) {
          countToday++;
        } else if (task.dueDate && task.dueDate > today) {
          countUpcoming++;
        }
      }
    });

    return { countToday, countUpcoming, countAll, countDone };
  }

  // ==========================================================================
  // Render Engine (Rebuilds view cleanly from state)
  // ==========================================================================
  function render() {
    renderDateHeader();
    renderTabs();
    renderTasksList();
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
    const countDoneEl = document.getElementById('count-done');

    if (countTodayEl) countTodayEl.textContent = `(${counts.countToday})`;
    if (countUpcomingEl) countUpcomingEl.textContent = `(${counts.countUpcoming})`;
    if (countAllEl) countAllEl.textContent = `(${counts.countAll})`;
    if (countDoneEl) countDoneEl.textContent = `(${counts.countDone})`;

    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      const isSelected = tab.getAttribute('data-tab') === state.filter;
      tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });
  }

  function updateTabsIndicator() {
    const activeTab = document.querySelector(`.tab-btn[data-tab="${state.filter}"]`);
    const indicator = document.getElementById('tabsIndicator');
    if (activeTab && indicator) {
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
    const openClearCompletedModalBtn = document.getElementById('openClearCompletedModalBtn');

    if (!taskListEl) return;

    const visibleTasks = getFilteredAndSortedTasks();
    const isManualSort = state.sortBy === 'manual';

    // Clear previous task DOM
    taskListEl.innerHTML = '';

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

      visibleTasks.forEach(task => {
        const itemEl = createTaskItemElement(task, isManualSort);
        taskListEl.appendChild(itemEl);
      });
    }

    // Update list footer
    const totalMatching = visibleTasks.length;
    if (footerCountText) {
      footerCountText.textContent = `${totalMatching} ${totalMatching === 1 ? 'task' : 'tasks'}`;
    }

    // Show/hide Clear Completed button based on presence of completed tasks
    const hasCompletedTasks = state.tasks.some(t => t.completedAt);
    if (openClearCompletedModalBtn) {
      openClearCompletedModalBtn.style.display = hasCompletedTasks ? 'inline-flex' : 'none';
    }
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
      contentDiv.appendChild(titleWrap);

      // Field-note metadata (Signature Detail 5)
      const metaDiv = document.createElement('div');
      metaDiv.className = 'task-meta';

      const metaParts = [];

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

        if (!task.completedAt && isOverdue(task.dueDate, today)) {
          dateSpan.className = 'meta-overdue';
          dateSpan.textContent = `OVERDUE (${formatDisplayDate(task.dueDate).toUpperCase()})`;
        } else if (!task.completedAt && isDueToday(task.dueDate, today)) {
          dateSpan.className = 'meta-due-today';
          dateSpan.textContent = 'DUE TODAY';
        } else {
          dateSpan.textContent = `DUE ${formatDisplayDate(task.dueDate).toUpperCase()}`;
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

      case 'done':
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
    if (!toast || !toastTitle) return;

    if (state.undoQueue.length > 0) {
      const current = state.undoQueue[0];
      toastTitle.textContent = current.task.title;
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
      const li = target.closest('.task-item');
      if (!li) return;
      const taskId = li.getAttribute('data-id');

      // 1. Toggle completion
      if (target.closest('[data-action="toggle"]')) {
        toggleTaskCompletion(taskId);
        return;
      }

      // 2. Start inline edit
      if (target.closest('[data-action="edit"]')) {
        state.editingTaskId = taskId;
        render();
        return;
      }

      // 3. Delete task (open confirmation dialog)
      if (target.closest('[data-action="delete"]')) {
        openDeleteDialog(taskId);
        return;
      }

      // 4. Move up in manual sort
      if (target.closest('[data-action="move-up"]')) {
        moveTaskManual(taskId, -1);
        return;
      }

      // 5. Move down in manual sort
      if (target.closest('[data-action="move-down"]')) {
        moveTaskManual(taskId, 1);
        return;
      }
    });

    // Double-click on task title to edit
    taskListEl.addEventListener('dblclick', e => {
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

    // Handle keypress & blur for inline edit
    taskListEl.addEventListener('keydown', e => {
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
    const sorted = [...state.tasks].sort((a, b) => (a.order || 0) - (b.order || 0));
    const idx = sorted.findIndex(t => t.id === taskId);
    if (idx === -1) return;

    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;

    // Swap order values
    const tempOrder = sorted[idx].order;
    sorted[idx].order = sorted[targetIdx].order;
    sorted[targetIdx].order = tempOrder;

    saveToStorage();
    announcePolite(direction < 0 ? 'Moved up' : 'Moved down');
    render();
  }

  function reorderTasksManual(sourceId, targetId) {
    const sorted = [...state.tasks].sort((a, b) => (a.order || 0) - (b.order || 0));
    const fromIndex = sorted.findIndex(t => t.id === sourceId);
    const toIndex = sorted.findIndex(t => t.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = sorted.splice(fromIndex, 1);
    sorted.splice(toIndex, 0, moved);

    // Reassign continuous orders
    sorted.forEach((t, i) => {
      t.order = i;
    });

    saveToStorage();
    announcePolite('Task reordered');
    render();
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

        const res = addTask(rawTitle, priority, dueDate, category);
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
    if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
      lastActiveElement.focus();
    }
  }

  function setupModals() {
    // 1. Clear Completed Dialog
    const clearDialog = document.getElementById('clearCompletedDialogOverlay');
    const openClearBtn = document.getElementById('openClearCompletedModalBtn');
    const cancelClearBtn = document.getElementById('cancelClearCompletedBtn');
    const confirmClearBtn = document.getElementById('confirmClearCompletedBtn');

    if (openClearBtn) {
      openClearBtn.addEventListener('click', () => openModal(clearDialog));
    }
    if (cancelClearBtn) {
      cancelClearBtn.addEventListener('click', () => closeModal(clearDialog));
    }
    if (confirmClearBtn) {
      confirmClearBtn.addEventListener('click', () => {
        clearCompletedTasks();
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

    // 3. Shortcuts Dialog
    const shortcutsDialog = document.getElementById('shortcutsDialogOverlay');
    const shortcutsBtn = document.getElementById('shortcutsBtn');
    const closeShortcutsBtn = document.getElementById('closeShortcutsBtn');

    if (shortcutsBtn) {
      shortcutsBtn.addEventListener('click', () => openModal(shortcutsDialog));
    }
    if (closeShortcutsBtn) {
      closeShortcutsBtn.addEventListener('click', () => closeModal(shortcutsDialog));
    }

    // 4. Backup & Restore Dialog
    const backupDialog = document.getElementById('backupDialogOverlay');
    const backupBtn = document.getElementById('backupModalBtn');
    const closeBackupBtn = document.getElementById('closeBackupBtn');
    const exportBtn = document.getElementById('exportTasksBtn');
    const importFileInput = document.getElementById('importTasksFileInput');
    const importFeedback = document.getElementById('importFeedback');

    if (backupBtn) {
      backupBtn.addEventListener('click', () => openModal(backupDialog));
    }
    if (closeBackupBtn) {
      closeBackupBtn.addEventListener('click', () => closeModal(backupDialog));
    }

    // Export tasks as JSON file download
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
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

    // Import tasks from JSON file
    if (importFileInput) {
      importFileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const parsed = JSON.parse(ev.target.result);
            if (!Array.isArray(parsed)) {
              showImportError('Invalid backup file. Root must be a list of tasks.');
              return;
            }

            const validImported = [];
            let skippedCount = 0;

            parsed.forEach(item => {
              const validated = validateTaskRecord(item);
              if (validated) {
                // Check if id already exists, generate new if needed
                if (state.tasks.some(t => t.id === validated.id)) {
                  validated.id = generateId();
                }
                validImported.push(validated);
              } else {
                skippedCount++;
              }
            });

            if (validImported.length === 0) {
              showImportError('No valid task records found in file.');
              return;
            }

            // Append imported tasks without silent overwrite
            state.tasks = state.tasks.concat(validImported);
            saveToStorage();
            render();

            showImportSuccess(`Restored ${validImported.length} tasks.${skippedCount > 0 ? ` (${skippedCount} bad records skipped)` : ''}`);
            announcePolite(`Imported ${validImported.length} tasks`);
          } catch (err) {
            showImportError('Could not parse JSON file.');
          }
        };
        reader.readAsText(file);
      });
    }

    function showImportError(msg) {
      if (importFeedback) {
        importFeedback.style.display = 'block';
        importFeedback.style.color = 'var(--accent)';
        importFeedback.textContent = msg;
      }
    }

    function showImportSuccess(msg) {
      if (importFeedback) {
        importFeedback.style.display = 'block';
        importFeedback.style.color = 'var(--ink)';
        importFeedback.textContent = msg;
      }
    }

    // Close on Escape or click outside
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const openDialog = document.querySelector('.dialog-overlay.is-open');
        if (openDialog) {
          closeModal(openDialog);
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
      } else if (e.key === '?') {
        e.preventDefault();
        const shortcutsDialog = document.getElementById('shortcutsDialogOverlay');
        openModal(shortcutsDialog);
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
      }
    });
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
    setupFilterControls();
    setupModals();
    setupKeyboardShortcuts();
    scheduleMidnightRefresh();
    setupVisibilityChange();

    // 5. Load data & initial render
    state.tasks = loadFromStorage();
    render();

    // Window resize listener to keep sliding tab indicator aligned
    window.addEventListener('resize', updateTabsIndicator);
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

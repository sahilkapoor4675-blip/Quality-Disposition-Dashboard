(() => {
  'use strict';

  const STORAGE_KEY = 'quality-dashboard-todos-v1';
  const THEME_KEY = 'quality-dashboard-todo-theme-v1';
  let todos = loadTodos();
  let currentFilter = 'all';

  const form = document.querySelector('#todoForm');
  const input = document.querySelector('#todoInput');
  const list = document.querySelector('#todoList');
  const emptyState = document.querySelector('#emptyState');
  const emptyTitle = document.querySelector('#emptyTitle');
  const emptyMessage = document.querySelector('#emptyMessage');
  const clearCompletedButton = document.querySelector('#clearCompleted');
  const themeToggle = document.querySelector('#themeToggle');

  function loadTodos() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(todo => todo && todo.id && typeof todo.text === 'string') : [];
    } catch (error) {
      return [];
    }
  }

  function saveTodos() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(todos)); } catch (error) { /* Storage may be unavailable in private browsing. */ }
  }

  function makeId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
  }

  function visibleTodos() {
    return todos.filter(todo => currentFilter === 'all' || (currentFilter === 'active' ? !todo.completed : todo.completed));
  }

  function render() {
    const completed = todos.filter(todo => todo.completed).length;
    document.querySelector('#allCount').textContent = todos.length;
    document.querySelector('#activeCount').textContent = todos.length - completed;
    document.querySelector('#completedCount').textContent = completed;
    document.querySelector('#taskSummary').textContent = `${todos.length} ${todos.length === 1 ? 'task' : 'tasks'}`;
    clearCompletedButton.disabled = completed === 0;

    list.innerHTML = visibleTodos().map(todo => `
      <li class="todo-item ${todo.completed ? 'completed' : ''}" data-id="${escapeHtml(todo.id)}">
        <input class="todo-check" type="checkbox" ${todo.completed ? 'checked' : ''} aria-label="Mark ${escapeHtml(todo.text)} as ${todo.completed ? 'active' : 'completed'}">
        <span class="todo-text">${escapeHtml(todo.text)}</span>
        <div class="todo-actions">
          <button class="action-button edit" type="button" aria-label="Edit task">Edit</button>
          <button class="action-button delete" type="button" aria-label="Delete task">Delete</button>
        </div>
      </li>`).join('');

    const hasVisible = visibleTodos().length > 0;
    emptyState.hidden = hasVisible;
    if (!hasVisible) {
      const isFiltered = todos.length > 0 && currentFilter !== 'all';
      emptyTitle.textContent = isFiltered ? 'No matching tasks' : 'Nothing here yet';
      emptyMessage.textContent = isFiltered ? 'Try another filter or add a new task.' : 'Add a task above to get started.';
    }
    document.querySelectorAll('.filter-button').forEach(button => button.classList.toggle('active', button.dataset.filter === currentFilter));
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    todos.unshift({ id: makeId(), text, completed: false, createdAt: Date.now() });
    saveTodos(); render(); form.reset(); input.focus();
  });

  list.addEventListener('change', event => {
    if (!event.target.classList.contains('todo-check')) return;
    const todo = todos.find(item => item.id === event.target.closest('.todo-item').dataset.id);
    if (todo) { todo.completed = event.target.checked; saveTodos(); render(); }
  });

  list.addEventListener('click', event => {
    const item = event.target.closest('.todo-item');
    if (!item) return;
    const todo = todos.find(entry => entry.id === item.dataset.id);
    if (!todo) return;
    if (event.target.closest('.delete')) {
      todos = todos.filter(entry => entry.id !== todo.id); saveTodos(); render(); return;
    }
    if (event.target.closest('.edit')) {
      const nextText = window.prompt('Edit task', todo.text);
      if (nextText === null) return;
      const trimmed = nextText.trim();
      if (trimmed) { todo.text = trimmed; saveTodos(); render(); }
    }
  });

  document.querySelector('.filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (button) { currentFilter = button.dataset.filter; render(); }
  });

  clearCompletedButton.addEventListener('click', () => {
    todos = todos.filter(todo => !todo.completed); saveTodos(); render();
  });

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeToggle.textContent = theme === 'dark' ? '☀' : '☾';
    themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
  const savedTheme = localStorage.getItem(THEME_KEY);
  applyTheme(savedTheme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (error) {}
    applyTheme(next);
  });

  render();
})();

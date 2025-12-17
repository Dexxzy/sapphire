// ============================================
// SAPPHIRE - Renderer Process
// ============================================

// State
let currentNote = null;
let notes = [];
let allTags = [];
let templates = [];
let settings = {};
let trashNotes = [];
let saveTimeout = null;
let quill = null;
let splitQuill = null;
let currentView = 'all';
let selectedTag = null;
let commandPaletteIndex = 0;

// AI State
let aiStatus = { running: false, models: [] };
let aiModel = '';
let aiChatHistory = [];
let aiIsGenerating = false;
let aiLastResponse = '';
let aiSelectionRange = null;
let removeChunkListener = null;
let removeCompleteListener = null;
let removeErrorListener = null;

// Pomodoro State
let pomodoroTime = 25 * 60;
let pomodoroInterval = null;
let pomodoroIsRunning = false;
let pomodoroIsBreak = false;
let pomodoroSessions = 0;
let pomodoroFocusTime = 25;
let pomodoroBreakTime = 5;

// Graph State
let graphZoom = 1;
let graphPan = { x: 0, y: 0 };
let graphNodes = [];
let graphDragging = false;

// Note Link Autocomplete State
let noteLinkActive = false;
let noteLinkSearch = '';
let noteLinkIndex = 0;
let noteLinkStartPos = null;

// DOM Elements
const elements = {
  sidebar: document.getElementById('sidebar'),
  sidebarResize: document.getElementById('sidebar-resize'),
  notesList: document.getElementById('notes-list'),
  noteTitleInput: document.getElementById('note-title'),
  editorContainer: document.getElementById('editor-container'),
  emptyState: document.getElementById('empty-state'),
  saveStatus: document.getElementById('save-status'),
  wordCount: document.getElementById('word-count'),
  charCount: document.getElementById('char-count'),
  readingTime: document.getElementById('reading-time'),
  searchInput: document.getElementById('search-input'),
  sortSelect: document.getElementById('sort-select'),
  tagsPanel: document.getElementById('tags-panel'),
  tagsList: document.getElementById('tags-list'),
  trashPanel: document.getElementById('trash-panel'),
  trashList: document.getElementById('trash-list'),
  noteTags: document.getElementById('note-tags'),
  backlinksCount: document.getElementById('backlinks-count'),
  backlinksList: document.getElementById('backlinks-list'),
  splitPane: document.getElementById('split-pane'),
  splitNoteTitle: document.getElementById('split-note-title'),
  // Modals
  commandPalette: document.getElementById('command-palette'),
  commandInput: document.getElementById('command-input'),
  commandList: document.getElementById('command-list'),
  exportModal: document.getElementById('export-modal'),
  historyModal: document.getElementById('history-modal'),
  historyList: document.getElementById('history-list'),
  historyPreview: document.getElementById('history-preview'),
  settingsModal: document.getElementById('settings-modal'),
  templateModal: document.getElementById('template-modal'),
  templateList: document.getElementById('template-list'),
  tagModal: document.getElementById('tag-modal'),
  tagInput: document.getElementById('tag-input'),
  existingTags: document.getElementById('existing-tags'),
  moreDropdown: document.getElementById('more-dropdown'),
  toastContainer: document.getElementById('toast-container'),
  // AI Elements
  aiPanel: document.getElementById('ai-panel'),
  aiStatus: document.getElementById('ai-status'),
  aiModelSelect: document.getElementById('ai-model-select'),
  aiChatMessages: document.getElementById('ai-chat-messages'),
  aiChatInput: document.getElementById('ai-chat-input'),
  aiChatSend: document.getElementById('ai-chat-send'),
  aiChatCancel: document.getElementById('ai-chat-cancel'),
  aiOutput: document.getElementById('ai-output'),
  aiOutputContent: document.getElementById('ai-output-content'),
  // New Feature Elements
  pomodoroModal: document.getElementById('pomodoro-modal'),
  pomodoroTime: document.getElementById('pomodoro-time'),
  pomodoroLabel: document.getElementById('pomodoro-label'),
  pomodoroRing: document.getElementById('pomodoro-ring'),
  pomodoroDots: document.getElementById('pomodoro-dots'),
  statsModal: document.getElementById('stats-modal'),
  graphModal: document.getElementById('graph-modal'),
  graphCanvas: document.getElementById('graph-canvas'),
  shortcutsModal: document.getElementById('shortcuts-modal'),
  readingMode: document.getElementById('reading-mode'),
  readingTitle: document.getElementById('reading-title'),
  readingContent: document.getElementById('reading-content'),
  noteLinkPopup: document.getElementById('note-link-popup'),
  noteLinkList: document.getElementById('note-link-list'),
  quickCapture: document.getElementById('quick-capture'),
  quickCaptureText: document.getElementById('quick-capture-text'),
  activityHeatmap: document.getElementById('activity-heatmap')
};

// ============================================
// INITIALIZATION
// ============================================

async function init() {
  // Load settings
  settings = await window.api.settings.get();
  applySettings();

  // Load data
  templates = await window.api.templates.get();
  allTags = await window.api.tags.get();

  // Initialize editor
  initEditor();

  // Load notes
  await loadNotes();

  // Setup event listeners
  setupEventListeners();

  // Initialize AI
  await initAI();

  // Hide editor initially
  hideEditor();

  // Load first note if exists
  if (notes.length > 0) {
    loadNote(notes[0].id);
  }
}

function initEditor() {
  quill = new Quill('#editor', {
    theme: 'snow',
    modules: {
      toolbar: '#toolbar'
    },
    placeholder: 'Start writing...'
  });

  // Auto-save on content change
  quill.on('text-change', () => {
    if (currentNote) {
      updateStats();
      scheduleAutoSave();
    }
  });

  // Handle image paste/drop
  quill.root.addEventListener('paste', handleImagePaste);
  quill.root.addEventListener('drop', handleImageDrop);
}

function applySettings() {
  document.documentElement.style.setProperty('--editor-font-size', settings.editorFontSize + 'px');
  document.documentElement.style.setProperty('--editor-line-height', settings.lineHeight);

  if (settings.focusMode) {
    document.body.classList.add('focus-mode');
  }
  if (settings.typewriterMode) {
    document.body.classList.add('typewriter-mode');
  }

  // Update settings UI
  const fontSizeSetting = document.getElementById('font-size-setting');
  const lineHeightSetting = document.getElementById('line-height-setting');
  if (fontSizeSetting) {
    fontSizeSetting.value = settings.editorFontSize;
    document.getElementById('font-size-value').textContent = settings.editorFontSize + 'px';
  }
  if (lineHeightSetting) {
    lineHeightSetting.value = settings.lineHeight;
    document.getElementById('line-height-value').textContent = settings.lineHeight;
  }
}

// ============================================
// NOTE OPERATIONS
// ============================================

async function loadNotes() {
  notes = await window.api.notes.list();
  sortNotes();
  renderNotesList();
  updateTagsList();
}

function sortNotes() {
  const [sortBy, sortOrder] = (elements.sortSelect.value || 'updatedAt-desc').split('-');

  notes.sort((a, b) => {
    // Pinned notes always first
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;

    let comparison = 0;
    if (sortBy === 'title') {
      comparison = (a.title || '').localeCompare(b.title || '');
    } else {
      comparison = new Date(b[sortBy]) - new Date(a[sortBy]);
    }

    return sortOrder === 'asc' ? -comparison : comparison;
  });
}

function renderNotesList(filter = '') {
  let filteredNotes = notes;

  // Apply view filter
  if (currentView === 'favorites') {
    filteredNotes = filteredNotes.filter(n => n.favorite);
  } else if (currentView === 'tags' && selectedTag) {
    filteredNotes = filteredNotes.filter(n => n.tags && n.tags.includes(selectedTag));
  }

  // Apply search filter
  if (filter) {
    const lowerFilter = filter.toLowerCase();
    filteredNotes = filteredNotes.filter(n =>
      (n.title || '').toLowerCase().includes(lowerFilter) ||
      (n.preview || '').toLowerCase().includes(lowerFilter)
    );
  }

  elements.notesList.innerHTML = filteredNotes.map(note => `
    <div class="note-item ${currentNote?.id === note.id ? 'active' : ''}" data-id="${note.id}">
      <div class="note-item-header">
        ${note.pinned ? '<svg class="note-pin-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="3"/></svg>' : ''}
        ${note.favorite ? '<svg class="note-favorite-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>' : ''}
        <div class="note-item-title">${escapeHtml(note.title) || 'Untitled'}</div>
      </div>
      ${note.preview ? `<div class="note-item-preview">${escapeHtml(note.preview)}</div>` : ''}
      <div class="note-item-meta">
        <span>${formatDate(note.updatedAt)}</span>
        ${note.wordCount ? `<span>${note.wordCount} words</span>` : ''}
      </div>
      ${note.tags && note.tags.length > 0 ? `
        <div class="note-item-tags">
          ${note.tags.slice(0, 3).map(tag => `<span class="note-item-tag">${escapeHtml(tag)}</span>`).join('')}
          ${note.tags.length > 3 ? `<span class="note-item-tag">+${note.tags.length - 3}</span>` : ''}
        </div>
      ` : ''}
    </div>
  `).join('');

  // Add click handlers
  elements.notesList.querySelectorAll('.note-item').forEach(item => {
    item.addEventListener('click', () => loadNote(item.dataset.id));
  });
}

async function loadNote(id) {
  // Save current note first
  if (currentNote) {
    await saveCurrentNote();
  }

  const note = await window.api.notes.get(id);
  if (note) {
    currentNote = note;
    elements.noteTitleInput.value = note.title || '';
    quill.root.innerHTML = note.content || '';
    showEditor();
    updateStats();
    updateNoteTags();
    updateBacklinks();
    updatePinFavoriteButtons();
    renderNotesList(elements.searchInput.value);
  }
}

async function createNewNote(templateContent = '') {
  // Save current note first
  if (currentNote) {
    await saveCurrentNote();
  }

  const newNote = {
    id: generateId(),
    title: '',
    content: templateContent,
    createdAt: new Date().toISOString(),
    tags: [],
    pinned: false,
    favorite: false
  };

  currentNote = await window.api.notes.save(newNote);
  elements.noteTitleInput.value = '';
  quill.root.innerHTML = templateContent;
  showEditor();
  elements.noteTitleInput.focus();
  await loadNotes();
  showToast('Note created', 'success');
}

async function createDailyNote() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  const title = today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  // Check if daily note exists
  const existingNote = notes.find(n => n.title === title);
  if (existingNote) {
    loadNote(existingNote.id);
    return;
  }

  // Get daily note template
  const dailyTemplate = templates.find(t => t.id === 'daily');
  const content = dailyTemplate ? dailyTemplate.content.replace('Daily Note', title) : `<h2>${title}</h2><p></p>`;

  await createNewNote(content);
  elements.noteTitleInput.value = title;
  scheduleAutoSave();
}

async function saveCurrentNote() {
  if (!currentNote) return;

  elements.saveStatus.textContent = 'Saving...';

  const noteData = {
    id: currentNote.id,
    title: elements.noteTitleInput.value || 'Untitled',
    content: quill.root.innerHTML,
    createdAt: currentNote.createdAt,
    tags: currentNote.tags || [],
    pinned: currentNote.pinned || false,
    favorite: currentNote.favorite || false,
    links: extractLinks(quill.root.innerHTML)
  };

  currentNote = await window.api.notes.save(noteData);
  elements.saveStatus.textContent = 'Saved';

  // Update notes list
  const noteIndex = notes.findIndex(n => n.id === currentNote.id);
  if (noteIndex >= 0) {
    notes[noteIndex] = { ...notes[noteIndex], ...currentNote };
  }
  renderNotesList(elements.searchInput.value);
}

function scheduleAutoSave() {
  elements.saveStatus.textContent = 'Editing...';
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(saveCurrentNote, 1000);
}

async function deleteCurrentNote() {
  if (!currentNote) return;

  if (confirm('Move this note to trash?')) {
    await window.api.notes.delete(currentNote.id);
    currentNote = null;
    hideEditor();
    await loadNotes();
    showToast('Note moved to trash', 'info');
  }
}

async function duplicateNote() {
  if (!currentNote) return;

  await saveCurrentNote();
  const duplicated = await window.api.notes.duplicate(currentNote.id);
  if (duplicated) {
    await loadNotes();
    loadNote(duplicated.id);
    showToast('Note duplicated', 'success');
  }
}

async function togglePin() {
  if (!currentNote) return;

  currentNote.pinned = !currentNote.pinned;
  await saveCurrentNote();
  updatePinFavoriteButtons();
  await loadNotes();
  showToast(currentNote.pinned ? 'Note pinned' : 'Note unpinned', 'info');
}

async function toggleFavorite() {
  if (!currentNote) return;

  currentNote.favorite = !currentNote.favorite;
  await saveCurrentNote();
  updatePinFavoriteButtons();
  await loadNotes();
  showToast(currentNote.favorite ? 'Added to favorites' : 'Removed from favorites', 'info');
}

function updatePinFavoriteButtons() {
  const pinBtn = document.getElementById('pin-btn');
  const favBtn = document.getElementById('favorite-btn');

  if (currentNote?.pinned) {
    pinBtn.classList.add('active');
  } else {
    pinBtn.classList.remove('active');
  }

  if (currentNote?.favorite) {
    favBtn.classList.add('active');
  } else {
    favBtn.classList.remove('active');
  }
}

// ============================================
// TAGS
// ============================================

function updateTagsList() {
  // Collect all unique tags
  const tagCounts = {};
  notes.forEach(note => {
    (note.tags || []).forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  allTags = Object.keys(tagCounts).sort();

  elements.tagsList.innerHTML = allTags.map(tag => `
    <div class="tag-item ${selectedTag === tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
      <span>${escapeHtml(tag)}</span>
      <span class="tag-count">${tagCounts[tag]}</span>
    </div>
  `).join('');

  // Add click handlers
  elements.tagsList.querySelectorAll('.tag-item').forEach(item => {
    item.addEventListener('click', () => {
      const tag = item.dataset.tag;
      if (selectedTag === tag) {
        selectedTag = null;
      } else {
        selectedTag = tag;
      }
      updateTagsList();
      renderNotesList(elements.searchInput.value);
    });
  });
}

function updateNoteTags() {
  if (!currentNote) return;

  elements.noteTags.innerHTML = (currentNote.tags || []).map(tag => `
    <div class="note-tag">
      <span>${escapeHtml(tag)}</span>
      <button class="note-tag-remove" data-tag="${escapeHtml(tag)}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  `).join('');

  // Add remove handlers
  elements.noteTags.querySelectorAll('.note-tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTag(btn.dataset.tag);
    });
  });
}

async function addTag(tagName) {
  if (!currentNote || !tagName) return;

  tagName = tagName.trim().toLowerCase();
  if (!tagName) return;

  if (!currentNote.tags) {
    currentNote.tags = [];
  }

  if (!currentNote.tags.includes(tagName)) {
    currentNote.tags.push(tagName);
    await saveCurrentNote();
    updateNoteTags();
    updateTagsList();
    showToast(`Tag "${tagName}" added`, 'success');
  }

  closeTagModal();
}

async function removeTag(tagName) {
  if (!currentNote || !currentNote.tags) return;

  currentNote.tags = currentNote.tags.filter(t => t !== tagName);
  await saveCurrentNote();
  updateNoteTags();
  updateTagsList();
}

function openTagModal() {
  elements.tagModal.classList.remove('hidden');
  elements.tagInput.value = '';
  elements.tagInput.focus();

  // Show existing tags
  elements.existingTags.innerHTML = allTags
    .filter(tag => !currentNote?.tags?.includes(tag))
    .map(tag => `<div class="existing-tag" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</div>`)
    .join('');

  elements.existingTags.querySelectorAll('.existing-tag').forEach(item => {
    item.addEventListener('click', () => addTag(item.dataset.tag));
  });
}

function closeTagModal() {
  elements.tagModal.classList.add('hidden');
}

// ============================================
// BACKLINKS
// ============================================

function extractLinks(content) {
  // Extract note IDs from internal links
  const linkRegex = /\[\[([^\]]+)\]\]/g;
  const links = [];
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const linkedNote = notes.find(n => n.title.toLowerCase() === match[1].toLowerCase());
    if (linkedNote) {
      links.push(linkedNote.id);
    }
  }
  return links;
}

async function updateBacklinks() {
  if (!currentNote) return;

  const backlinks = await window.api.notes.getBacklinks(currentNote.id);
  elements.backlinksCount.textContent = backlinks.length;

  elements.backlinksList.innerHTML = backlinks.map(link => `
    <div class="backlink-item" data-id="${link.id}">${escapeHtml(link.title)}</div>
  `).join('');

  elements.backlinksList.querySelectorAll('.backlink-item').forEach(item => {
    item.addEventListener('click', () => loadNote(item.dataset.id));
  });
}

// ============================================
// TRASH
// ============================================

async function loadTrash() {
  trashNotes = await window.api.trash.list();
  renderTrashList();
}

function renderTrashList() {
  elements.trashList.innerHTML = trashNotes.map(note => `
    <div class="trash-item" data-id="${note.id}">
      <div class="trash-item-info">
        <div class="trash-item-title">${escapeHtml(note.title)}</div>
        <div class="trash-item-date">Deleted ${formatDate(note.deletedAt)}</div>
      </div>
      <div class="trash-item-actions">
        <button class="btn-icon-sm restore-btn" data-id="${note.id}" title="Restore">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>
        <button class="btn-icon-sm delete-btn" data-id="${note.id}" title="Delete Permanently">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
  `).join('');

  // Add handlers
  elements.trashList.querySelectorAll('.restore-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.notes.restore(btn.dataset.id);
      await loadTrash();
      await loadNotes();
      showToast('Note restored', 'success');
    });
  });

  elements.trashList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Permanently delete this note? This cannot be undone.')) {
        await window.api.notes.permanentDelete(btn.dataset.id);
        await loadTrash();
        showToast('Note permanently deleted', 'info');
      }
    });
  });
}

async function emptyTrash() {
  if (confirm('Permanently delete all notes in trash? This cannot be undone.')) {
    await window.api.trash.empty();
    await loadTrash();
    showToast('Trash emptied', 'info');
  }
}

// ============================================
// HISTORY
// ============================================

async function openHistoryModal() {
  if (!currentNote) return;

  elements.historyModal.classList.remove('hidden');
  const history = await window.api.history.list(currentNote.id);

  elements.historyList.innerHTML = history.map((item, index) => {
    const date = new Date(item.timestamp);
    return `
      <div class="history-item" data-file="${item.file}">
        <div class="history-item-date">${date.toLocaleDateString()}</div>
        <div class="history-item-time">${date.toLocaleTimeString()}</div>
      </div>
    `;
  }).join('');

  if (history.length === 0) {
    elements.historyList.innerHTML = '<p style="padding: 20px; color: var(--text-muted);">No history available</p>';
  }

  elements.historyPreview.innerHTML = '<p class="history-empty">Select a version to preview</p>';

  // Add click handlers
  elements.historyList.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', async () => {
      elements.historyList.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const version = await window.api.history.get(currentNote.id, item.dataset.file);
      if (version) {
        elements.historyPreview.innerHTML = `
          <h3 style="margin-bottom: 16px;">${escapeHtml(version.title)}</h3>
          <div>${version.content}</div>
          <div class="history-actions">
            <button class="btn-secondary" id="restore-history-btn">Restore this version</button>
          </div>
        `;

        document.getElementById('restore-history-btn').addEventListener('click', async () => {
          if (confirm('Restore this version? Current changes will be saved to history.')) {
            await window.api.history.restore(currentNote.id, item.dataset.file);
            closeHistoryModal();
            loadNote(currentNote.id);
            showToast('Version restored', 'success');
          }
        });
      }
    });
  });
}

function closeHistoryModal() {
  elements.historyModal.classList.add('hidden');
}

// ============================================
// EXPORT/IMPORT
// ============================================

async function exportNote(format) {
  if (!currentNote) return;

  await saveCurrentNote();
  const result = await window.api.notes.export(currentNote.id, format);
  closeExportModal();

  if (result.success) {
    showToast('Note exported successfully', 'success');
  }
}

async function importNotes() {
  const imported = await window.api.notes.import();
  if (imported.length > 0) {
    await loadNotes();
    showToast(`${imported.length} note(s) imported`, 'success');
  }
}

function openExportModal() {
  elements.exportModal.classList.remove('hidden');
}

function closeExportModal() {
  elements.exportModal.classList.add('hidden');
}

// ============================================
// TEMPLATES
// ============================================

function openTemplateModal() {
  elements.templateModal.classList.remove('hidden');

  elements.templateList.innerHTML = templates.map(template => `
    <div class="template-item" data-id="${template.id}">
      <svg class="template-item-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="3" y1="9" x2="21" y2="9"></line>
        <line x1="9" y1="21" x2="9" y2="9"></line>
      </svg>
      <span class="template-item-name">${escapeHtml(template.name)}</span>
    </div>
  `).join('');

  elements.templateList.querySelectorAll('.template-item').forEach(item => {
    item.addEventListener('click', () => {
      const template = templates.find(t => t.id === item.dataset.id);
      if (template) {
        createNewNote(template.content);
        closeTemplateModal();
      }
    });
  });
}

function closeTemplateModal() {
  elements.templateModal.classList.add('hidden');
}

async function saveAsTemplate() {
  if (!currentNote) return;

  const name = prompt('Template name:', currentNote.title);
  if (!name) return;

  const newTemplate = {
    id: generateId(),
    name,
    content: quill.root.innerHTML
  };

  templates.push(newTemplate);
  await window.api.templates.save(templates);
  showToast('Template saved', 'success');
}

// ============================================
// COMMAND PALETTE
// ============================================

const commands = [
  { id: 'new-note', title: 'New Note', desc: 'Create a new note', shortcut: ['Cmd', 'N'], action: () => createNewNote() },
  { id: 'daily-note', title: 'Daily Note', desc: "Open today's daily note", action: () => createDailyNote() },
  { id: 'search', title: 'Search Notes', desc: 'Search through all notes', shortcut: ['Cmd', 'F'], action: () => elements.searchInput.focus() },
  { id: 'save', title: 'Save Note', desc: 'Save current note', shortcut: ['Cmd', 'S'], action: () => saveCurrentNote() },
  { id: 'delete', title: 'Delete Note', desc: 'Move note to trash', action: () => deleteCurrentNote() },
  { id: 'duplicate', title: 'Duplicate Note', desc: 'Create a copy of this note', action: () => duplicateNote() },
  { id: 'pin', title: 'Toggle Pin', desc: 'Pin or unpin note', action: () => togglePin() },
  { id: 'favorite', title: 'Toggle Favorite', desc: 'Add or remove from favorites', action: () => toggleFavorite() },
  { id: 'export', title: 'Export Note', desc: 'Export to various formats', action: () => openExportModal() },
  { id: 'import', title: 'Import Notes', desc: 'Import notes from files', action: () => importNotes() },
  { id: 'history', title: 'Version History', desc: 'View and restore previous versions', action: () => openHistoryModal() },
  { id: 'template', title: 'Use Template', desc: 'Create note from template', action: () => openTemplateModal() },
  { id: 'save-template', title: 'Save as Template', desc: 'Save current note as template', action: () => saveAsTemplate() },
  { id: 'focus', title: 'Toggle Focus Mode', desc: 'Distraction-free writing', shortcut: ['Cmd', 'Shift', 'F'], action: () => toggleFocusMode() },
  { id: 'typewriter', title: 'Toggle Typewriter Mode', desc: 'Keep cursor centered', action: () => toggleTypewriterMode() },
  { id: 'settings', title: 'Settings', desc: 'Open settings', action: () => openSettingsModal() },
  { id: 'vault', title: 'Open Vault Folder', desc: 'Show notes location', action: () => openVaultFolder() },
  // AI Commands
  { id: 'ai-panel', title: 'AI Assistant', desc: 'Toggle AI panel', shortcut: ['Cmd', 'J'], action: () => toggleAIPanel() },
  { id: 'ai-summarize', title: 'AI: Summarize', desc: 'Summarize selected text or note', action: () => executeAIAction('summarize') },
  { id: 'ai-expand', title: 'AI: Expand', desc: 'Expand on selected text', action: () => executeAIAction('expand') },
  { id: 'ai-rewrite', title: 'AI: Rewrite', desc: 'Rewrite selected text', action: () => executeAIAction('rewrite') },
  { id: 'ai-simplify', title: 'AI: Simplify', desc: 'Simplify selected text', action: () => executeAIAction('simplify') },
  { id: 'ai-professional', title: 'AI: Make Professional', desc: 'Make text more professional', action: () => executeAIAction('professional') },
  { id: 'ai-casual', title: 'AI: Make Casual', desc: 'Make text more casual', action: () => executeAIAction('casual') },
  { id: 'ai-grammar', title: 'AI: Fix Grammar', desc: 'Fix grammar and spelling', action: () => executeAIAction('fix_grammar') },
  { id: 'ai-continue', title: 'AI: Continue Writing', desc: 'Continue writing from cursor', action: () => executeAIAction('continue') },
  { id: 'ai-suggest-tags', title: 'AI: Suggest Tags', desc: 'Get AI-suggested tags for note', action: () => aiSuggestTags() },
  { id: 'ai-suggest-title', title: 'AI: Suggest Title', desc: 'Get AI-suggested title for note', action: () => aiSuggestTitle() },
  // New Feature Commands
  { id: 'pomodoro', title: 'Pomodoro Timer', desc: 'Start a focus session', action: () => openPomodoroModal() },
  { id: 'statistics', title: 'Statistics', desc: 'View writing statistics and goals', action: () => openStatsModal() },
  { id: 'graph', title: 'Note Graph', desc: 'Visualize note connections', action: () => openGraphModal() },
  { id: 'shortcuts', title: 'Keyboard Shortcuts', desc: 'View all keyboard shortcuts', shortcut: ['Cmd', '?'], action: () => openShortcutsModal() },
  { id: 'reading', title: 'Reading Mode', desc: 'Distraction-free reading view', shortcut: ['Cmd', 'R'], action: () => enterReadingMode() },
  { id: 'quick-capture', title: 'Quick Capture', desc: 'Quickly jot down a thought', shortcut: ['Cmd', 'Shift', 'N'], action: () => toggleQuickCapture() },
  { id: 'toggle-sidebar', title: 'Toggle Sidebar', desc: 'Show or hide the sidebar', shortcut: ['Cmd', '\\'], action: () => toggleSidebar() },
  { id: 'theme-blue', title: 'Theme: Blue (Default)', desc: 'Switch to blue accent color', action: () => setAccentColor('blue') },
  { id: 'theme-purple', title: 'Theme: Purple', desc: 'Switch to purple accent color', action: () => setAccentColor('purple') },
  { id: 'theme-pink', title: 'Theme: Pink', desc: 'Switch to pink accent color', action: () => setAccentColor('pink') },
  { id: 'theme-cyan', title: 'Theme: Cyan', desc: 'Switch to cyan accent color', action: () => setAccentColor('cyan') },
  { id: 'theme-orange', title: 'Theme: Orange', desc: 'Switch to orange accent color', action: () => setAccentColor('orange') },
  { id: 'theme-green', title: 'Theme: Green', desc: 'Switch to green accent color', action: () => setAccentColor('green') },
  { id: 'daily-note', title: 'Daily Note', desc: 'Create or open today\'s note', shortcut: ['Cmd', 'D'], action: () => createDailyNote() },
];

function openCommandPalette() {
  elements.commandPalette.classList.remove('hidden');
  elements.commandInput.value = '';
  elements.commandInput.focus();
  commandPaletteIndex = 0;
  renderCommandList('');
}

function closeCommandPalette() {
  elements.commandPalette.classList.add('hidden');
}

function renderCommandList(filter) {
  const filteredCommands = filter
    ? commands.filter(cmd =>
        cmd.title.toLowerCase().includes(filter.toLowerCase()) ||
        cmd.desc.toLowerCase().includes(filter.toLowerCase())
      )
    : commands;

  // Also search notes if filter exists
  let noteResults = [];
  if (filter && filter.length > 1) {
    noteResults = notes
      .filter(n => (n.title || '').toLowerCase().includes(filter.toLowerCase()))
      .slice(0, 5);
  }

  let html = '';

  if (filteredCommands.length > 0) {
    html += '<div class="command-section-title">Commands</div>';
    html += filteredCommands.map((cmd, index) => `
      <div class="command-item ${index === commandPaletteIndex ? 'active' : ''}" data-action="${cmd.id}">
        <div class="command-item-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
        </div>
        <div class="command-item-text">
          <div class="command-item-title">${cmd.title}</div>
          <div class="command-item-desc">${cmd.desc}</div>
        </div>
        ${cmd.shortcut ? `
          <div class="command-item-shortcut">
            ${cmd.shortcut.map(k => `<kbd>${k}</kbd>`).join('')}
          </div>
        ` : ''}
      </div>
    `).join('');
  }

  if (noteResults.length > 0) {
    html += '<div class="command-section-title">Notes</div>';
    html += noteResults.map(note => `
      <div class="command-item" data-note="${note.id}">
        <div class="command-item-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <div class="command-item-text">
          <div class="command-item-title">${escapeHtml(note.title)}</div>
          <div class="command-item-desc">${escapeHtml(note.preview || '').substring(0, 50)}</div>
        </div>
      </div>
    `).join('');
  }

  elements.commandList.innerHTML = html || '<p style="padding: 20px; text-align: center; color: var(--text-muted);">No results found</p>';

  // Add click handlers
  elements.commandList.querySelectorAll('.command-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.action) {
        const cmd = commands.find(c => c.id === item.dataset.action);
        if (cmd) {
          closeCommandPalette();
          cmd.action();
        }
      } else if (item.dataset.note) {
        closeCommandPalette();
        loadNote(item.dataset.note);
      }
    });
  });
}

function executeSelectedCommand() {
  const items = elements.commandList.querySelectorAll('.command-item');
  if (items[commandPaletteIndex]) {
    items[commandPaletteIndex].click();
  }
}

// ============================================
// SETTINGS
// ============================================

function openSettingsModal() {
  elements.settingsModal.classList.remove('hidden');
  updateAISettingsUI();
}

async function updateAISettingsUI() {
  const aiEnabledSetting = document.getElementById('ai-enabled-setting');
  const aiModelSetting = document.getElementById('ai-model-setting');
  const aiStatusSetting = document.getElementById('ai-status-setting');

  // Update enabled checkbox
  if (aiEnabledSetting) {
    aiEnabledSetting.checked = settings.aiEnabled !== false;
  }

  // Update status
  if (aiStatusSetting) {
    if (aiStatus.running) {
      aiStatusSetting.textContent = 'Connected';
      aiStatusSetting.classList.remove('offline');
      aiStatusSetting.classList.add('online');
    } else {
      aiStatusSetting.textContent = 'Offline - Make sure Ollama is running';
      aiStatusSetting.classList.remove('online');
      aiStatusSetting.classList.add('offline');
    }
  }

  // Update model select
  if (aiModelSetting) {
    if (aiStatus.models && aiStatus.models.length > 0) {
      aiModelSetting.innerHTML = aiStatus.models.map(model => `
        <option value="${model.name}" ${model.name === aiModel ? 'selected' : ''}>
          ${model.name}
        </option>
      `).join('');
    } else {
      aiModelSetting.innerHTML = '<option value="">No models available</option>';
    }
  }
}

function closeSettingsModal() {
  elements.settingsModal.classList.add('hidden');
}

async function updateSetting(key, value) {
  settings[key] = value;
  await window.api.settings.save(settings);
  applySettings();
}

// ============================================
// FOCUS & TYPEWRITER MODES
// ============================================

function toggleFocusMode() {
  document.body.classList.toggle('focus-mode');
  settings.focusMode = document.body.classList.contains('focus-mode');
  window.api.settings.save(settings);

  const btn = document.getElementById('focus-mode-btn');
  btn.classList.toggle('active', settings.focusMode);

  showToast(settings.focusMode ? 'Focus mode enabled' : 'Focus mode disabled', 'info');
}

function toggleTypewriterMode() {
  document.body.classList.toggle('typewriter-mode');
  settings.typewriterMode = document.body.classList.contains('typewriter-mode');
  window.api.settings.save(settings);

  const btn = document.getElementById('typewriter-btn');
  btn.classList.toggle('active', settings.typewriterMode);

  showToast(settings.typewriterMode ? 'Typewriter mode enabled' : 'Typewriter mode disabled', 'info');
}

// ============================================
// SPLIT VIEW
// ============================================

function toggleSplitView() {
  elements.splitPane.classList.toggle('hidden');
  document.getElementById('split-view-btn').classList.toggle('active');

  if (!elements.splitPane.classList.contains('hidden') && !splitQuill) {
    splitQuill = new Quill('#split-editor', {
      theme: 'snow',
      modules: { toolbar: false },
      readOnly: true
    });
  }
}

function closeSplitView() {
  elements.splitPane.classList.add('hidden');
  document.getElementById('split-view-btn').classList.remove('active');
}

// ============================================
// UI HELPERS
// ============================================

function showEditor() {
  elements.editorContainer.classList.remove('editor-hidden');
  elements.emptyState.classList.add('hidden');
}

function hideEditor() {
  elements.editorContainer.classList.add('editor-hidden');
  elements.emptyState.classList.remove('hidden');
}

function updateStats() {
  const text = quill.getText().trim();
  const words = text ? text.split(/\s+/).filter(w => w).length : 0;
  const chars = text.length;
  const readingTime = Math.max(1, Math.ceil(words / 200));

  elements.wordCount.textContent = `${words} word${words !== 1 ? 's' : ''}`;
  elements.charCount.textContent = `${chars} char${chars !== 1 ? 's' : ''}`;
  elements.readingTime.textContent = `${readingTime} min read`;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-message">${message}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

async function openVaultFolder() {
  const path = await window.api.notes.getPath();
  await window.api.shell.openPath(path);
}

// ============================================
// IMAGE HANDLING
// ============================================

async function handleImagePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      await insertImage(file);
      break;
    }
  }
}

async function handleImageDrop(e) {
  const files = e.dataTransfer?.files;
  if (!files) return;

  for (const file of files) {
    if (file.type.startsWith('image/')) {
      e.preventDefault();
      await insertImage(file);
      break;
    }
  }
}

async function insertImage(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    const url = await window.api.images.save(base64, file.name);

    // For now, insert as data URL (could implement custom protocol later)
    const range = quill.getSelection(true);
    quill.insertEmbed(range.index, 'image', e.target.result);
  };
  reader.readAsDataURL(file);
}

// ============================================
// DROPDOWN MENU
// ============================================

function showMoreDropdown(e) {
  const btn = document.getElementById('more-btn');
  const rect = btn.getBoundingClientRect();

  elements.moreDropdown.style.top = rect.bottom + 4 + 'px';
  elements.moreDropdown.style.right = (window.innerWidth - rect.right) + 'px';
  elements.moreDropdown.classList.remove('hidden');
}

function hideMoreDropdown() {
  elements.moreDropdown.classList.add('hidden');
}

// ============================================
// SIDEBAR RESIZE
// ============================================

function initSidebarResize() {
  let isResizing = false;

  elements.sidebarResize.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const newWidth = Math.min(400, Math.max(200, e.clientX));
    elements.sidebar.style.width = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

// ============================================
// VIEW SWITCHING
// ============================================

function switchView(view) {
  currentView = view;

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });

  // Show/hide panels
  elements.notesList.classList.toggle('hidden', view === 'trash');
  elements.tagsPanel.classList.toggle('hidden', view !== 'tags');
  elements.trashPanel.classList.toggle('hidden', view !== 'trash');
  document.querySelector('.sort-options').classList.toggle('hidden', view === 'trash');

  if (view === 'trash') {
    loadTrash();
  } else if (view === 'tags') {
    updateTagsList();
  }

  renderNotesList(elements.searchInput.value);
}

// ============================================
// UTILITIES
// ============================================

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function formatDate(dateString) {
  if (!dateString) return '';

  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  // New note
  document.getElementById('new-note-btn').addEventListener('click', () => createNewNote());
  document.getElementById('empty-new-note').addEventListener('click', () => createNewNote());

  // Daily note
  document.getElementById('daily-note-btn').addEventListener('click', createDailyNote);
  document.getElementById('empty-daily-note').addEventListener('click', createDailyNote);

  // Note actions
  document.getElementById('delete-btn').addEventListener('click', deleteCurrentNote);
  document.getElementById('duplicate-btn').addEventListener('click', duplicateNote);
  document.getElementById('export-btn').addEventListener('click', openExportModal);
  document.getElementById('pin-btn').addEventListener('click', togglePin);
  document.getElementById('favorite-btn').addEventListener('click', toggleFavorite);
  document.getElementById('history-btn').addEventListener('click', openHistoryModal);
  document.getElementById('focus-mode-btn').addEventListener('click', toggleFocusMode);
  document.getElementById('split-view-btn').addEventListener('click', toggleSplitView);
  document.getElementById('close-split-btn').addEventListener('click', closeSplitView);
  document.getElementById('typewriter-btn').addEventListener('click', toggleTypewriterMode);

  // Title input
  elements.noteTitleInput.addEventListener('input', scheduleAutoSave);

  // Search
  elements.searchInput.addEventListener('input', (e) => {
    renderNotesList(e.target.value);
  });

  // Sort
  elements.sortSelect.addEventListener('change', () => {
    sortNotes();
    renderNotesList(elements.searchInput.value);
  });

  // Navigation tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  // Tags
  document.getElementById('add-tag-btn').addEventListener('click', openTagModal);
  document.getElementById('cancel-tag').addEventListener('click', closeTagModal);
  document.getElementById('confirm-tag').addEventListener('click', () => addTag(elements.tagInput.value));
  elements.tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTag(elements.tagInput.value);
    if (e.key === 'Escape') closeTagModal();
  });

  // Trash
  document.getElementById('empty-trash-btn').addEventListener('click', emptyTrash);

  // Command palette
  document.getElementById('command-palette-btn').addEventListener('click', openCommandPalette);
  elements.commandInput.addEventListener('input', (e) => {
    commandPaletteIndex = 0;
    renderCommandList(e.target.value);
  });
  elements.commandInput.addEventListener('keydown', (e) => {
    const items = elements.commandList.querySelectorAll('.command-item');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      commandPaletteIndex = Math.min(commandPaletteIndex + 1, items.length - 1);
      items.forEach((item, i) => item.classList.toggle('active', i === commandPaletteIndex));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      commandPaletteIndex = Math.max(commandPaletteIndex - 1, 0);
      items.forEach((item, i) => item.classList.toggle('active', i === commandPaletteIndex));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeSelectedCommand();
    } else if (e.key === 'Escape') {
      closeCommandPalette();
    }
  });

  // Export modal
  document.querySelectorAll('.export-option').forEach(btn => {
    btn.addEventListener('click', () => exportNote(btn.dataset.format));
  });
  document.getElementById('cancel-export').addEventListener('click', closeExportModal);

  // History modal
  document.getElementById('close-history').addEventListener('click', closeHistoryModal);

  // Settings
  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
  document.getElementById('close-settings').addEventListener('click', closeSettingsModal);

  document.getElementById('font-size-setting').addEventListener('input', (e) => {
    document.getElementById('font-size-value').textContent = e.target.value + 'px';
    updateSetting('editorFontSize', parseInt(e.target.value));
  });

  document.getElementById('line-height-setting').addEventListener('input', (e) => {
    document.getElementById('line-height-value').textContent = e.target.value;
    updateSetting('lineHeight', parseFloat(e.target.value));
  });

  // AI Settings
  document.getElementById('ai-enabled-setting')?.addEventListener('change', (e) => {
    updateSetting('aiEnabled', e.target.checked);
  });

  document.getElementById('ai-model-setting')?.addEventListener('change', (e) => {
    aiModel = e.target.value;
    updateSetting('aiModel', e.target.value);
    // Also update the panel select
    if (elements.aiModelSelect) {
      elements.aiModelSelect.value = e.target.value;
    }
  });

  document.getElementById('ai-refresh-status')?.addEventListener('click', async () => {
    await checkAIStatus();
    updateAISettingsUI();
    showToast(aiStatus.running ? 'AI connected' : 'AI offline - Make sure Ollama is running', aiStatus.running ? 'success' : 'error');
  });

  // Templates
  document.getElementById('cancel-template').addEventListener('click', closeTemplateModal);

  // Vault
  document.getElementById('vault-btn').addEventListener('click', openVaultFolder);

  // Import
  document.getElementById('import-btn').addEventListener('click', importNotes);

  // More dropdown
  document.getElementById('more-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (elements.moreDropdown.classList.contains('hidden')) {
      showMoreDropdown(e);
    } else {
      hideMoreDropdown();
    }
  });

  document.getElementById('menu-duplicate').addEventListener('click', () => { hideMoreDropdown(); duplicateNote(); });
  document.getElementById('menu-template').addEventListener('click', () => { hideMoreDropdown(); saveAsTemplate(); });
  document.getElementById('menu-delete').addEventListener('click', () => { hideMoreDropdown(); deleteCurrentNote(); });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!elements.moreDropdown.contains(e.target) && e.target.id !== 'more-btn') {
      hideMoreDropdown();
    }
  });

  // Modal backdrop clicks
  elements.commandPalette.addEventListener('click', (e) => {
    if (e.target === elements.commandPalette) closeCommandPalette();
  });
  elements.exportModal.addEventListener('click', (e) => {
    if (e.target === elements.exportModal) closeExportModal();
  });
  elements.historyModal.addEventListener('click', (e) => {
    if (e.target === elements.historyModal) closeHistoryModal();
  });
  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) closeSettingsModal();
  });
  elements.templateModal.addEventListener('click', (e) => {
    if (e.target === elements.templateModal) closeTemplateModal();
  });
  elements.tagModal.addEventListener('click', (e) => {
    if (e.target === elements.tagModal) closeTagModal();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const isMod = e.metaKey || e.ctrlKey;

    // Cmd+N: New note (Cmd+Shift+N: Quick Capture)
    if (isMod && e.key === 'n' && !e.shiftKey) {
      e.preventDefault();
      createNewNote();
    }
    if (isMod && e.key === 'N' && e.shiftKey) {
      e.preventDefault();
      toggleQuickCapture();
    }

    // Cmd+S: Save note
    if (isMod && e.key === 's') {
      e.preventDefault();
      saveCurrentNote();
    }

    // Cmd+F: Focus search
    if (isMod && e.key === 'f' && !e.shiftKey) {
      e.preventDefault();
      elements.searchInput.focus();
    }

    // Cmd+P: Command palette
    if (isMod && e.key === 'p') {
      e.preventDefault();
      openCommandPalette();
    }

    // Cmd+Shift+F: Focus mode
    if (isMod && e.shiftKey && e.key === 'f') {
      e.preventDefault();
      toggleFocusMode();
    }

    // Cmd+J: Toggle AI panel
    if (isMod && e.key === 'j') {
      e.preventDefault();
      toggleAIPanel();
    }

    // Cmd+R: Reading mode
    if (isMod && e.key === 'r') {
      e.preventDefault();
      enterReadingMode();
    }

    // Cmd+\: Toggle sidebar
    if (isMod && e.key === '\\') {
      e.preventDefault();
      toggleSidebar();
    }

    // Cmd+? or Cmd+/: Show shortcuts
    if (isMod && (e.key === '?' || e.key === '/')) {
      e.preventDefault();
      openShortcutsModal();
    }

    // Cmd+D: Daily note
    if (isMod && e.key === 'd') {
      e.preventDefault();
      createDailyNote();
    }

    // Escape: Close modals
    if (e.key === 'Escape') {
      // Close in priority order
      if (!elements.readingMode?.classList.contains('hidden')) {
        exitReadingMode();
      } else if (!elements.quickCapture?.classList.contains('hidden')) {
        closeQuickCapture();
      } else if (!elements.pomodoroModal?.classList.contains('hidden')) {
        closePomodoroModal();
      } else if (!elements.statsModal?.classList.contains('hidden')) {
        closeStatsModal();
      } else if (!elements.graphModal?.classList.contains('hidden')) {
        closeGraphModal();
      } else if (!elements.shortcutsModal?.classList.contains('hidden')) {
        closeShortcutsModal();
      } else {
        closeCommandPalette();
        closeExportModal();
        closeHistoryModal();
        closeSettingsModal();
        closeTemplateModal();
        closeTagModal();
        hideMoreDropdown();
        hideAIOutput();
      }
    }
  });

  // Sidebar resize
  initSidebarResize();

  // AI Event Listeners
  setupAIEventListeners();
}

function setupAIEventListeners() {
  // AI Panel toggle
  document.getElementById('ai-btn')?.addEventListener('click', toggleAIPanel);
  document.getElementById('close-ai-panel')?.addEventListener('click', closeAIPanel);

  // AI Model select
  elements.aiModelSelect?.addEventListener('change', (e) => {
    aiModel = e.target.value;
    settings.aiModel = aiModel;
    window.api.settings.save(settings);
  });

  // AI Action buttons
  document.querySelectorAll('.ai-action-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', () => executeAIAction(btn.dataset.action));
  });

  // AI Translation buttons
  document.querySelectorAll('.ai-action-btn-sm[data-action]').forEach(btn => {
    btn.addEventListener('click', () => executeAIAction(btn.dataset.action));
  });

  // AI Chat
  elements.aiChatSend?.addEventListener('click', sendAIChatMessage);
  elements.aiChatCancel?.addEventListener('click', cancelAIGeneration);
  elements.aiChatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAIChatMessage();
    }
  });

  // AI Output actions
  document.getElementById('ai-output-close')?.addEventListener('click', hideAIOutput);
  document.getElementById('ai-output-replace')?.addEventListener('click', aiReplaceSelection);
  document.getElementById('ai-output-insert')?.addEventListener('click', aiInsertBelow);
  document.getElementById('ai-output-copy')?.addEventListener('click', aiCopyOutput);

  // AI Suggest buttons
  document.getElementById('ai-suggest-tags')?.addEventListener('click', aiSuggestTags);
  document.getElementById('ai-suggest-title')?.addEventListener('click', aiSuggestTitle);
}

// ============================================
// AI INTEGRATION
// ============================================

async function initAI() {
  // Check AI status
  await checkAIStatus();

  // Set up event listeners for AI streaming
  setupAIListeners();

  // Load saved model preference
  if (settings.aiModel) {
    aiModel = settings.aiModel;
  }
}

async function checkAIStatus() {
  try {
    aiStatus = await window.api.ai.status();
    updateAIStatusUI();

    if (aiStatus.running) {
      // Models are already loaded in aiStatus from the status call
      if (!aiStatus.models || aiStatus.models.length === 0) {
        const modelsData = await window.api.ai.models();
        aiStatus.models = modelsData || [];
      }
      populateModelSelect();
    }
  } catch (error) {
    console.error('Error checking AI status:', error);
    aiStatus = { running: false, models: [] };
    updateAIStatusUI();
  }
}

function updateAIStatusUI() {
  const statusDot = elements.aiStatus.querySelector('.ai-status-dot');
  const statusText = elements.aiStatus.querySelector('.ai-status-text');
  const aiBtn = document.getElementById('ai-btn');

  if (aiStatus.running) {
    statusDot.classList.remove('offline');
    statusDot.classList.add('online');
    statusText.textContent = 'Connected';
    aiBtn?.classList.add('ai-online');
  } else {
    statusDot.classList.remove('online');
    statusDot.classList.add('offline');
    statusText.textContent = 'Offline';
    aiBtn?.classList.remove('ai-online');
  }
}

function populateModelSelect() {
  elements.aiModelSelect.innerHTML = aiStatus.models.length === 0
    ? '<option value="">No models found</option>'
    : aiStatus.models.map(model => `
        <option value="${model.name}" ${model.name === aiModel ? 'selected' : ''}>
          ${model.name}
        </option>
      `).join('');

  // Set default model if none selected
  if (!aiModel && aiStatus.models.length > 0) {
    aiModel = aiStatus.models[0].name;
    elements.aiModelSelect.value = aiModel;
  }
}

function setupAIListeners() {
  // Stream chunk listener
  removeChunkListener = window.api.ai.onChunk((data) => {
    if (data.chunk) {
      aiLastResponse += data.chunk;
      updateAIOutput(aiLastResponse, true);
    }
  });

  // Completion listener
  removeCompleteListener = window.api.ai.onComplete((data) => {
    aiIsGenerating = false;
    updateAIOutput(aiLastResponse, false);
    updateAIGeneratingUI(false);
  });

  // Error listener
  removeErrorListener = window.api.ai.onError((data) => {
    aiIsGenerating = false;
    showToast(`AI Error: ${data.error}`, 'error');
    updateAIGeneratingUI(false);
  });
}

function toggleAIPanel() {
  elements.aiPanel.classList.toggle('hidden');
  document.getElementById('ai-btn')?.classList.toggle('active');

  if (!elements.aiPanel.classList.contains('hidden')) {
    // Refresh status when opening
    checkAIStatus();
  }
}

function closeAIPanel() {
  elements.aiPanel.classList.add('hidden');
  document.getElementById('ai-btn')?.classList.remove('active');
}

// AI Actions
async function executeAIAction(action) {
  if (!aiStatus.running) {
    showToast('AI is not available. Make sure Ollama is running.', 'error');
    return;
  }

  if (!aiModel) {
    showToast('Please select an AI model first.', 'error');
    return;
  }

  // Get selected text or full content
  const selection = quill.getSelection();
  let text = '';

  if (selection && selection.length > 0) {
    text = quill.getText(selection.index, selection.length);
    aiSelectionRange = selection;
  } else {
    text = quill.getText();
    aiSelectionRange = null;
  }

  if (!text.trim()) {
    showToast('Please select some text or add content to the note.', 'error');
    return;
  }

  // Start generation
  aiIsGenerating = true;
  aiLastResponse = '';
  updateAIGeneratingUI(true);
  showAIOutput();

  try {
    await window.api.ai.action({
      action,
      text,
      model: aiModel
    });
  } catch (error) {
    showToast(`AI Error: ${error.message}`, 'error');
    aiIsGenerating = false;
    updateAIGeneratingUI(false);
  }
}

async function sendAIChatMessage() {
  const message = elements.aiChatInput.value.trim();
  if (!message) return;

  if (!aiStatus.running) {
    showToast('AI is not available. Make sure Ollama is running.', 'error');
    return;
  }

  if (!aiModel) {
    showToast('Please select an AI model first.', 'error');
    return;
  }

  // Add user message to chat
  addChatMessage(message, 'user');
  elements.aiChatInput.value = '';

  // Get note content for context
  const noteContent = quill.getText();
  const noteTitle = elements.noteTitleInput.value || 'Untitled';

  // Build context
  const systemContext = `You are a helpful AI assistant integrated into a note-taking app called Sapphire.
The user is currently working on a note titled "${noteTitle}".

Note content:
${noteContent.substring(0, 2000)}${noteContent.length > 2000 ? '...' : ''}

Help the user with their question about their note or provide writing assistance.`;

  // Add to chat history
  aiChatHistory.push({ role: 'user', content: message });

  // Start generation
  aiIsGenerating = true;
  updateAIGeneratingUI(true);

  // Add loading message
  const loadingMsgEl = addChatMessage('', 'assistant', true);
  let streamedResponse = '';

  // Set up a temporary chunk handler for this chat message
  const chatChunkHandler = (data) => {
    if (data.chunk) {
      streamedResponse += data.chunk;
      loadingMsgEl.textContent = streamedResponse;
    }
  };

  // Listen for chunks
  const removeHandler = window.api.ai.onChunk(chatChunkHandler);

  try {
    const response = await window.api.ai.chat({
      model: aiModel,
      messages: [
        { role: 'system', content: systemContext },
        ...aiChatHistory
      ]
    });

    // Clean up the chunk listener
    removeHandler();

    // Use streamed response or fallback to response object
    const responseText = streamedResponse || response.response || '';
    loadingMsgEl.textContent = responseText;
    loadingMsgEl.classList.remove('loading');

    // Add to history
    if (responseText) {
      aiChatHistory.push({
        role: 'assistant',
        content: responseText
      });
    }

    if (response.error) {
      loadingMsgEl.textContent = `Error: ${response.error}`;
      loadingMsgEl.classList.add('error');
    }

  } catch (error) {
    removeHandler();
    loadingMsgEl.textContent = `Error: ${error.message}`;
    loadingMsgEl.classList.add('error');
  }

  aiIsGenerating = false;
  updateAIGeneratingUI(false);
}

function addChatMessage(text, role, isLoading = false) {
  // Clear empty state if present
  const emptyState = elements.aiChatMessages.querySelector('.ai-chat-empty');
  if (emptyState) {
    emptyState.remove();
  }

  const msgEl = document.createElement('div');
  msgEl.className = `ai-chat-message ${role}${isLoading ? ' loading' : ''}`;
  msgEl.textContent = text;
  elements.aiChatMessages.appendChild(msgEl);
  elements.aiChatMessages.scrollTop = elements.aiChatMessages.scrollHeight;

  return msgEl;
}

function clearAIChat() {
  aiChatHistory = [];
  elements.aiChatMessages.innerHTML = '<div class="ai-chat-empty">Ask anything about your note...</div>';
}

async function cancelAIGeneration() {
  try {
    await window.api.ai.cancel();
    aiIsGenerating = false;
    updateAIGeneratingUI(false);
    showToast('AI generation cancelled', 'info');
  } catch (error) {
    console.error('Error cancelling AI:', error);
  }
}

function updateAIGeneratingUI(generating) {
  if (generating) {
    elements.aiChatSend.classList.add('hidden');
    elements.aiChatCancel.classList.remove('hidden');
  } else {
    elements.aiChatSend.classList.remove('hidden');
    elements.aiChatCancel.classList.add('hidden');
  }
}

function showAIOutput() {
  elements.aiOutput.classList.remove('hidden');
  elements.aiOutputContent.innerHTML = '<div class="ai-loading"></div> Generating...';
}

function hideAIOutput() {
  elements.aiOutput.classList.add('hidden');
  aiLastResponse = '';
}

function updateAIOutput(content, streaming) {
  elements.aiOutputContent.innerHTML = escapeHtml(content) + (streaming ? '<span class="ai-streaming"></span>' : '');
}

function aiReplaceSelection() {
  if (!aiLastResponse) return;

  if (aiSelectionRange) {
    quill.deleteText(aiSelectionRange.index, aiSelectionRange.length);
    quill.insertText(aiSelectionRange.index, aiLastResponse);
  } else {
    // Replace all content
    quill.setText(aiLastResponse);
  }

  hideAIOutput();
  scheduleAutoSave();
  showToast('Text replaced', 'success');
}

function aiInsertBelow() {
  if (!aiLastResponse) return;

  const selection = quill.getSelection();
  const insertIndex = selection ? selection.index + selection.length : quill.getLength();

  quill.insertText(insertIndex, '\n\n' + aiLastResponse);

  hideAIOutput();
  scheduleAutoSave();
  showToast('Text inserted', 'success');
}

function aiCopyOutput() {
  if (!aiLastResponse) return;

  navigator.clipboard.writeText(aiLastResponse).then(() => {
    showToast('Copied to clipboard', 'success');
  });
}

async function aiSuggestTags() {
  if (!aiStatus.running || !aiModel) {
    showToast('AI is not available', 'error');
    return;
  }

  const content = quill.getText();
  if (!content.trim()) {
    showToast('Note is empty', 'error');
    return;
  }

  const title = elements.noteTitleInput.value || 'Untitled';
  showToast('Generating tag suggestions...', 'info');

  try {
    const result = await window.api.ai.suggestTags(title, content);
    if (result.success && result.tags && result.tags.length > 0) {
      // Show tags in a dialog or automatically add them
      const confirmTags = confirm(`Suggested tags:\n${result.tags.join(', ')}\n\nAdd these tags to the note?`);
      if (confirmTags) {
        for (const tag of result.tags) {
          await addTag(tag);
        }
      }
    } else if (result.error) {
      showToast(`Error: ${result.error}`, 'error');
    } else {
      showToast('No tags suggested', 'info');
    }
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  }
}

async function aiSuggestTitle() {
  if (!aiStatus.running || !aiModel) {
    showToast('AI is not available', 'error');
    return;
  }

  const content = quill.getText();
  if (!content.trim()) {
    showToast('Note is empty', 'error');
    return;
  }

  showToast('Generating title suggestion...', 'info');

  try {
    const result = await window.api.ai.suggestTitle(content);
    if (result.success && result.title) {
      const confirmTitle = confirm(`Suggested title:\n"${result.title}"\n\nUse this title?`);
      if (confirmTitle) {
        elements.noteTitleInput.value = result.title;
        scheduleAutoSave();
        showToast('Title updated', 'success');
      }
    } else if (result.error) {
      showToast(`Error: ${result.error}`, 'error');
    } else {
      showToast('No title suggested', 'info');
    }
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  }
}

// ============================================
// POMODORO TIMER
// ============================================

function openPomodoroModal() {
  elements.pomodoroModal.classList.remove('hidden');
  updatePomodoroDisplay();
  updatePomodoroDots();
}

function closePomodoroModal() {
  elements.pomodoroModal.classList.add('hidden');
}

function startPomodoro() {
  if (pomodoroIsRunning) {
    pausePomodoro();
    return;
  }

  pomodoroIsRunning = true;
  document.getElementById('pomodoro-start').textContent = 'Pause';

  pomodoroInterval = setInterval(() => {
    pomodoroTime--;
    updatePomodoroDisplay();

    if (pomodoroTime <= 0) {
      clearInterval(pomodoroInterval);
      pomodoroIsRunning = false;

      if (!pomodoroIsBreak) {
        // Finished focus session
        pomodoroSessions++;
        updatePomodoroDots();
        showToast(`Focus session complete! Take a ${pomodoroBreakTime} minute break.`, 'success');
        pomodoroIsBreak = true;
        pomodoroTime = pomodoroBreakTime * 60;
        elements.pomodoroLabel.textContent = 'Break Time';
        elements.pomodoroLabel.classList.add('break');
      } else {
        // Finished break
        showToast('Break over! Ready for another focus session?', 'info');
        pomodoroIsBreak = false;
        pomodoroTime = pomodoroFocusTime * 60;
        elements.pomodoroLabel.textContent = 'Focus Time';
        elements.pomodoroLabel.classList.remove('break');
      }

      document.getElementById('pomodoro-start').textContent = 'Start';
      updatePomodoroDisplay();
    }
  }, 1000);
}

function pausePomodoro() {
  clearInterval(pomodoroInterval);
  pomodoroIsRunning = false;
  document.getElementById('pomodoro-start').textContent = 'Start';
}

function resetPomodoro() {
  pausePomodoro();
  pomodoroIsBreak = false;
  pomodoroTime = pomodoroFocusTime * 60;
  elements.pomodoroLabel.textContent = 'Focus Time';
  elements.pomodoroLabel.classList.remove('break');
  updatePomodoroDisplay();
}

function updatePomodoroDisplay() {
  const minutes = Math.floor(pomodoroTime / 60);
  const seconds = pomodoroTime % 60;
  elements.pomodoroTime.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

  // Update ring progress
  const totalTime = pomodoroIsBreak ? pomodoroBreakTime * 60 : pomodoroFocusTime * 60;
  const progress = (totalTime - pomodoroTime) / totalTime;
  const circumference = 283;
  const offset = circumference - (progress * circumference);

  if (elements.pomodoroRing) {
    elements.pomodoroRing.style.strokeDashoffset = offset;
    elements.pomodoroRing.style.stroke = pomodoroIsBreak ? 'var(--success)' : 'var(--accent-primary)';
  }
}

function updatePomodoroDots() {
  if (!elements.pomodoroDots) return;

  elements.pomodoroDots.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const dot = document.createElement('div');
    dot.className = `pomodoro-dot ${i < pomodoroSessions % 4 ? 'completed' : ''}`;
    elements.pomodoroDots.appendChild(dot);
  }

  document.getElementById('pomodoro-sessions').textContent = pomodoroSessions;
}

// ============================================
// STATISTICS
// ============================================

function openStatsModal() {
  elements.statsModal.classList.remove('hidden');
  updateStatistics();
  generateActivityHeatmap();
}

function closeStatsModal() {
  elements.statsModal.classList.add('hidden');
}

function updateStatistics() {
  // Calculate total notes
  document.getElementById('stats-total-notes').textContent = notes.length;

  // Calculate total words
  let totalWords = 0;
  notes.forEach(note => {
    if (note.wordCount) totalWords += note.wordCount;
  });
  document.getElementById('stats-total-words').textContent = totalWords.toLocaleString();

  // Calculate reading time
  const readingMinutes = Math.ceil(totalWords / 200);
  document.getElementById('stats-reading-time').textContent = readingMinutes > 60
    ? `${Math.floor(readingMinutes / 60)}h ${readingMinutes % 60}m`
    : `${readingMinutes}m`;

  // Calculate unique tags
  const uniqueTags = new Set();
  notes.forEach(note => {
    (note.tags || []).forEach(tag => uniqueTags.add(tag));
  });
  document.getElementById('stats-total-tags').textContent = uniqueTags.size;

  // Update goals
  updateGoals(totalWords);
}

function updateGoals(totalWords) {
  const dailyGoal = parseInt(document.getElementById('daily-word-goal')?.value) || 500;

  // Get today's word count (from notes modified today)
  const today = new Date().toDateString();
  let todayWords = 0;
  notes.forEach(note => {
    if (new Date(note.updatedAt).toDateString() === today) {
      todayWords += note.wordCount || 0;
    }
  });

  const wordProgress = Math.min(100, (todayWords / dailyGoal) * 100);
  document.getElementById('goal-words-progress').textContent = `${todayWords.toLocaleString()} / ${dailyGoal.toLocaleString()}`;
  document.getElementById('goal-words-fill').style.width = `${wordProgress}%`;

  // Get notes this week
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekNotes = notes.filter(note => new Date(note.createdAt) > weekAgo).length;
  const noteProgress = Math.min(100, (weekNotes / 7) * 100);
  document.getElementById('goal-notes-progress').textContent = `${weekNotes} / 7`;
  document.getElementById('goal-notes-fill').style.width = `${noteProgress}%`;
}

function generateActivityHeatmap() {
  if (!elements.activityHeatmap) return;

  elements.activityHeatmap.innerHTML = '';

  // Generate last 28 days
  const today = new Date();
  for (let i = 27; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toDateString();

    // Count activity for this day
    const activity = notes.filter(note =>
      new Date(note.updatedAt).toDateString() === dateStr
    ).length;

    const level = activity === 0 ? '' :
                  activity <= 1 ? 'level-1' :
                  activity <= 3 ? 'level-2' :
                  activity <= 5 ? 'level-3' : 'level-4';

    const day = document.createElement('div');
    day.className = `heatmap-day ${level}`;
    day.title = `${date.toLocaleDateString()}: ${activity} note${activity !== 1 ? 's' : ''}`;
    elements.activityHeatmap.appendChild(day);
  }
}

// ============================================
// NOTE GRAPH
// ============================================

function openGraphModal() {
  elements.graphModal.classList.remove('hidden');
  setTimeout(renderGraph, 100);
}

function closeGraphModal() {
  elements.graphModal.classList.add('hidden');
}

function renderGraph() {
  const canvas = elements.graphCanvas;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  // Build node data
  graphNodes = notes.map((note, index) => {
    const angle = (index / notes.length) * Math.PI * 2;
    const radius = Math.min(canvas.width, canvas.height) * 0.35;
    return {
      id: note.id,
      title: note.title || 'Untitled',
      x: canvas.width / 2 + Math.cos(angle) * radius * (0.5 + Math.random() * 0.5),
      y: canvas.height / 2 + Math.sin(angle) * radius * (0.5 + Math.random() * 0.5),
      links: note.links || [],
      isCurrent: currentNote?.id === note.id
    };
  });

  // Apply force simulation
  for (let i = 0; i < 50; i++) {
    applyForces();
  }

  drawGraph(ctx, canvas);

  // Add interactivity
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (const node of graphNodes) {
      const dx = x - node.x;
      const dy = y - node.y;
      if (Math.sqrt(dx * dx + dy * dy) < 15) {
        closeGraphModal();
        loadNote(node.id);
        break;
      }
    }
  };
}

function applyForces() {
  const k = 100; // Repulsion constant
  const l = 150; // Ideal link length

  for (let i = 0; i < graphNodes.length; i++) {
    const node = graphNodes[i];
    let fx = 0, fy = 0;

    // Repulsion from other nodes
    for (let j = 0; j < graphNodes.length; j++) {
      if (i === j) continue;
      const other = graphNodes[j];
      const dx = node.x - other.x;
      const dy = node.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      fx += (k * k / dist) * (dx / dist);
      fy += (k * k / dist) * (dy / dist);
    }

    // Attraction from links
    for (const linkId of node.links) {
      const linked = graphNodes.find(n => n.id === linkId);
      if (linked) {
        const dx = linked.x - node.x;
        const dy = linked.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        fx += (dist - l) * (dx / dist) * 0.1;
        fy += (dist - l) * (dy / dist) * 0.1;
      }
    }

    // Center gravity
    const cx = elements.graphCanvas.width / 2;
    const cy = elements.graphCanvas.height / 2;
    fx += (cx - node.x) * 0.01;
    fy += (cy - node.y) * 0.01;

    node.x += fx * 0.1;
    node.y += fy * 0.1;
  }
}

function drawGraph(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw links
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
  ctx.lineWidth = 1;

  for (const node of graphNodes) {
    for (const linkId of node.links) {
      const linked = graphNodes.find(n => n.id === linkId);
      if (linked) {
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(linked.x, linked.y);
        ctx.stroke();
      }
    }
  }

  // Draw nodes
  for (const node of graphNodes) {
    const isLinked = currentNote && (node.links.includes(currentNote.id) ||
                     graphNodes.find(n => n.id === currentNote.id)?.links.includes(node.id));

    ctx.beginPath();
    ctx.arc(node.x, node.y, node.isCurrent ? 12 : 8, 0, Math.PI * 2);

    if (node.isCurrent) {
      ctx.fillStyle = '#3b82f6';
      ctx.shadowColor = '#3b82f6';
      ctx.shadowBlur = 15;
    } else if (isLinked) {
      ctx.fillStyle = '#8b5cf6';
      ctx.shadowColor = '#8b5cf6';
      ctx.shadowBlur = 10;
    } else {
      ctx.fillStyle = '#5c6370';
      ctx.shadowBlur = 0;
    }

    ctx.fill();
    ctx.shadowBlur = 0;

    // Draw label
    ctx.fillStyle = 'var(--text-secondary)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(node.title.substring(0, 15) + (node.title.length > 15 ? '...' : ''), node.x, node.y + 22);
  }
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

function openShortcutsModal() {
  elements.shortcutsModal.classList.remove('hidden');
}

function closeShortcutsModal() {
  elements.shortcutsModal.classList.add('hidden');
}

// ============================================
// READING MODE
// ============================================

function enterReadingMode() {
  if (!currentNote) {
    showToast('Open a note first', 'error');
    return;
  }

  elements.readingTitle.textContent = currentNote.title || 'Untitled';
  elements.readingContent.innerHTML = quill.root.innerHTML;
  elements.readingMode.classList.remove('hidden');
}

function exitReadingMode() {
  elements.readingMode.classList.add('hidden');
}

// ============================================
// QUICK CAPTURE
// ============================================

function toggleQuickCapture() {
  elements.quickCapture.classList.toggle('hidden');
  if (!elements.quickCapture.classList.contains('hidden')) {
    elements.quickCaptureText.focus();
  }
}

function closeQuickCapture() {
  elements.quickCapture.classList.add('hidden');
  elements.quickCaptureText.value = '';
}

async function quickCaptureSave() {
  const text = elements.quickCaptureText.value.trim();
  if (!text) return;

  await createNewNote(`<p>${escapeHtml(text)}</p>`);
  closeQuickCapture();
  showToast('Quick note saved!', 'success');
}

async function quickCaptureAppend() {
  const text = elements.quickCaptureText.value.trim();
  if (!text || !currentNote) {
    showToast('Open a note first', 'error');
    return;
  }

  quill.insertText(quill.getLength(), '\n\n' + text);
  closeQuickCapture();
  scheduleAutoSave();
  showToast('Added to current note', 'success');
}

// ============================================
// NOTE LINK AUTOCOMPLETE
// ============================================

function setupNoteLinkAutocomplete() {
  quill.on('text-change', (delta, oldDelta, source) => {
    if (source !== 'user') return;

    const selection = quill.getSelection();
    if (!selection) return;

    const text = quill.getText(0, selection.index);
    const lastBrackets = text.lastIndexOf('[[');

    if (lastBrackets !== -1 && !text.substring(lastBrackets).includes(']]')) {
      noteLinkActive = true;
      noteLinkSearch = text.substring(lastBrackets + 2);
      noteLinkStartPos = lastBrackets;
      showNoteLinkPopup(selection.index);
    } else {
      hideNoteLinkPopup();
    }
  });
}

function showNoteLinkPopup(cursorIndex) {
  const filteredNotes = notes.filter(n =>
    n.id !== currentNote?.id &&
    (n.title || '').toLowerCase().includes(noteLinkSearch.toLowerCase())
  ).slice(0, 5);

  if (filteredNotes.length === 0) {
    hideNoteLinkPopup();
    return;
  }

  elements.noteLinkList.innerHTML = filteredNotes.map((note, i) => `
    <div class="note-link-item ${i === noteLinkIndex ? 'active' : ''}" data-id="${note.id}" data-title="${escapeHtml(note.title)}">
      <div class="note-link-item-title">${escapeHtml(note.title) || 'Untitled'}</div>
    </div>
  `).join('');

  // Position popup near cursor
  const bounds = quill.getBounds(cursorIndex);
  const editorRect = document.getElementById('editor').getBoundingClientRect();
  elements.noteLinkPopup.style.left = (editorRect.left + bounds.left) + 'px';
  elements.noteLinkPopup.style.top = (editorRect.top + bounds.bottom + 5) + 'px';
  elements.noteLinkPopup.classList.remove('hidden');

  // Add click handlers
  elements.noteLinkList.querySelectorAll('.note-link-item').forEach(item => {
    item.addEventListener('click', () => insertNoteLink(item.dataset.title));
  });
}

function hideNoteLinkPopup() {
  elements.noteLinkPopup.classList.add('hidden');
  noteLinkActive = false;
  noteLinkSearch = '';
  noteLinkIndex = 0;
}

function insertNoteLink(title) {
  const selection = quill.getSelection();
  if (!selection || noteLinkStartPos === null) return;

  // Delete the [[ and search text
  quill.deleteText(noteLinkStartPos, selection.index - noteLinkStartPos);

  // Insert the link
  quill.insertText(noteLinkStartPos, `[[${title}]]`, { color: '#3b82f6' });
  quill.setSelection(noteLinkStartPos + title.length + 4);

  hideNoteLinkPopup();
}

// ============================================
// SIDEBAR TOGGLE
// ============================================

function toggleSidebar() {
  document.body.classList.toggle('sidebar-hidden');
}

// ============================================
// ACCENT COLOR
// ============================================

function setAccentColor(color) {
  const container = document.querySelector('.app-container');
  if (color === 'blue') {
    container.removeAttribute('data-accent');
  } else {
    container.setAttribute('data-accent', color);
  }
  settings.accentColor = color;
  window.api.settings.save(settings);
  showToast(`Theme changed to ${color}`, 'success');
}

// ============================================
// NEW FEATURE EVENT LISTENERS
// ============================================

function setupNewFeatureListeners() {
  // Pomodoro
  document.getElementById('pomodoro-btn')?.addEventListener('click', openPomodoroModal);
  document.getElementById('close-pomodoro')?.addEventListener('click', closePomodoroModal);
  document.getElementById('pomodoro-start')?.addEventListener('click', startPomodoro);
  document.getElementById('pomodoro-reset')?.addEventListener('click', resetPomodoro);

  document.getElementById('pomodoro-focus-time')?.addEventListener('change', (e) => {
    pomodoroFocusTime = parseInt(e.target.value) || 25;
    if (!pomodoroIsRunning && !pomodoroIsBreak) {
      pomodoroTime = pomodoroFocusTime * 60;
      updatePomodoroDisplay();
    }
  });

  document.getElementById('pomodoro-break-time')?.addEventListener('change', (e) => {
    pomodoroBreakTime = parseInt(e.target.value) || 5;
  });

  // Statistics
  document.getElementById('stats-btn')?.addEventListener('click', openStatsModal);
  document.getElementById('close-stats')?.addEventListener('click', closeStatsModal);
  document.getElementById('daily-word-goal')?.addEventListener('change', () => updateStatistics());

  // Graph
  document.getElementById('graph-btn')?.addEventListener('click', openGraphModal);
  document.getElementById('close-graph')?.addEventListener('click', closeGraphModal);
  document.getElementById('graph-zoom-in')?.addEventListener('click', () => {
    graphZoom *= 1.2;
    renderGraph();
  });
  document.getElementById('graph-zoom-out')?.addEventListener('click', () => {
    graphZoom /= 1.2;
    renderGraph();
  });
  document.getElementById('graph-reset')?.addEventListener('click', () => {
    graphZoom = 1;
    graphPan = { x: 0, y: 0 };
    renderGraph();
  });

  // Shortcuts
  document.getElementById('shortcuts-btn')?.addEventListener('click', openShortcutsModal);
  document.getElementById('close-shortcuts')?.addEventListener('click', closeShortcutsModal);

  // Reading Mode
  document.getElementById('exit-reading-mode')?.addEventListener('click', exitReadingMode);

  // Quick Capture
  document.getElementById('quick-capture-fab')?.addEventListener('click', toggleQuickCapture);
  document.getElementById('close-quick-capture')?.addEventListener('click', closeQuickCapture);
  document.getElementById('quick-capture-save')?.addEventListener('click', quickCaptureSave);
  document.getElementById('quick-capture-append')?.addEventListener('click', quickCaptureAppend);

  // Modal backdrop clicks
  elements.pomodoroModal?.addEventListener('click', (e) => {
    if (e.target === elements.pomodoroModal) closePomodoroModal();
  });
  elements.statsModal?.addEventListener('click', (e) => {
    if (e.target === elements.statsModal) closeStatsModal();
  });
  elements.graphModal?.addEventListener('click', (e) => {
    if (e.target === elements.graphModal) closeGraphModal();
  });
  elements.shortcutsModal?.addEventListener('click', (e) => {
    if (e.target === elements.shortcutsModal) closeShortcutsModal();
  });

  // Note Link autocomplete keyboard handling
  document.addEventListener('keydown', (e) => {
    if (noteLinkActive) {
      const items = elements.noteLinkList.querySelectorAll('.note-link-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        noteLinkIndex = Math.min(noteLinkIndex + 1, items.length - 1);
        items.forEach((item, i) => item.classList.toggle('active', i === noteLinkIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        noteLinkIndex = Math.max(noteLinkIndex - 1, 0);
        items.forEach((item, i) => item.classList.toggle('active', i === noteLinkIndex));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const activeItem = items[noteLinkIndex];
        if (activeItem) insertNoteLink(activeItem.dataset.title);
      } else if (e.key === 'Escape') {
        hideNoteLinkPopup();
      }
    }
  });

  // Apply saved accent color
  if (settings.accentColor && settings.accentColor !== 'blue') {
    document.querySelector('.app-container')?.setAttribute('data-accent', settings.accentColor);
  }
}

// ============================================
// INITIALIZE
// ============================================

init();

// Setup new features after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  setupNewFeatureListeners();
  setupNoteLinkAutocomplete();
});

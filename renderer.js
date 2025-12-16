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
  aiOutputContent: document.getElementById('ai-output-content')
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

    // Cmd+N: New note
    if (isMod && e.key === 'n') {
      e.preventDefault();
      createNewNote();
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

    // Escape: Close modals
    if (e.key === 'Escape') {
      closeCommandPalette();
      closeExportModal();
      closeHistoryModal();
      closeSettingsModal();
      closeTemplateModal();
      closeTagModal();
      hideMoreDropdown();
      hideAIOutput();
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
// INITIALIZE
// ============================================

init();

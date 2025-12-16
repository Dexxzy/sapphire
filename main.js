const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, net } = require('electron');
const path = require('path');
const fs = require('fs');

// ============================================
// OLLAMA AI INTEGRATION
// ============================================

const OLLAMA_BASE_URL = 'http://localhost:11434';

// Check if Ollama is running
async function checkOllamaStatus() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      return { running: true, models: data.models || [] };
    }
    return { running: false, models: [] };
  } catch (error) {
    return { running: false, models: [], error: error.message };
  }
}

// Get available models
async function getOllamaModels() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      return data.models || [];
    }
    return [];
  } catch (error) {
    return [];
  }
}

// Stream completion from Ollama
async function streamOllamaCompletion(model, prompt, systemPrompt, onChunk) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      system: systemPrompt,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.response) {
          fullResponse += json.response;
          onChunk(json.response, fullResponse);
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }

  return fullResponse;
}

// Non-streaming completion
async function ollamaComplete(model, prompt, systemPrompt) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      system: systemPrompt,
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.response;
}

// Chat completion with history
async function ollamaChat(model, messages, onChunk) {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.message?.content) {
          fullResponse += json.message.content;
          onChunk(json.message.content, fullResponse);
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }

  return fullResponse;
}

// Secure: Disable remote module, use context isolation
app.enableSandbox();

// Store notes in user's app data directory (private, local storage)
const getDataDir = () => {
  const dataPath = app.getPath('userData');
  return dataPath;
};

const getNotesDir = () => {
  const notesPath = path.join(getDataDir(), 'notes');
  if (!fs.existsSync(notesPath)) {
    fs.mkdirSync(notesPath, { recursive: true });
  }
  return notesPath;
};

const getTrashDir = () => {
  const trashPath = path.join(getDataDir(), 'trash');
  if (!fs.existsSync(trashPath)) {
    fs.mkdirSync(trashPath, { recursive: true });
  }
  return trashPath;
};

const getHistoryDir = () => {
  const historyPath = path.join(getDataDir(), 'history');
  if (!fs.existsSync(historyPath)) {
    fs.mkdirSync(historyPath, { recursive: true });
  }
  return historyPath;
};

const getImagesDir = () => {
  const imagesPath = path.join(getDataDir(), 'images');
  if (!fs.existsSync(imagesPath)) {
    fs.mkdirSync(imagesPath, { recursive: true });
  }
  return imagesPath;
};

const getSettingsPath = () => path.join(getDataDir(), 'settings.json');
const getTagsPath = () => path.join(getDataDir(), 'tags.json');
const getTemplatesPath = () => path.join(getDataDir(), 'templates.json');

// Default settings
const defaultSettings = {
  theme: 'dark',
  sidebarWidth: 280,
  editorFontSize: 16,
  lineHeight: 1.8,
  focusMode: false,
  typewriterMode: false,
  showWordCount: true,
  sortBy: 'updatedAt',
  sortOrder: 'desc',
  spellcheck: true,
  // AI Settings
  aiEnabled: true,
  aiModel: 'gemma3:latest',
  aiAutoSuggest: false
};

// Load settings
function loadSettings() {
  const settingsPath = getSettingsPath();
  if (fs.existsSync(settingsPath)) {
    return { ...defaultSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) };
  }
  return defaultSettings;
}

// Save settings
function saveSettings(settings) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

// Load tags
function loadTags() {
  const tagsPath = getTagsPath();
  if (fs.existsSync(tagsPath)) {
    return JSON.parse(fs.readFileSync(tagsPath, 'utf-8'));
  }
  return [];
}

// Save tags
function saveTags(tags) {
  fs.writeFileSync(getTagsPath(), JSON.stringify(tags, null, 2), 'utf-8');
}

// Load templates
function loadTemplates() {
  const templatesPath = getTemplatesPath();
  if (fs.existsSync(templatesPath)) {
    return JSON.parse(fs.readFileSync(templatesPath, 'utf-8'));
  }
  return [
    { id: 'meeting', name: 'Meeting Notes', content: '<h2>Meeting Notes</h2><p><strong>Date:</strong> </p><p><strong>Attendees:</strong> </p><h3>Agenda</h3><ul><li></li></ul><h3>Notes</h3><p></p><h3>Action Items</h3><ul data-checked="false"><li></li></ul>' },
    { id: 'daily', name: 'Daily Note', content: '<h2>Daily Note</h2><h3>Goals for Today</h3><ul data-checked="false"><li></li></ul><h3>Notes</h3><p></p><h3>Gratitude</h3><p></p>' },
    { id: 'project', name: 'Project', content: '<h2>Project Name</h2><p><strong>Status:</strong> </p><p><strong>Deadline:</strong> </p><h3>Overview</h3><p></p><h3>Tasks</h3><ul data-checked="false"><li></li></ul><h3>Resources</h3><ul><li></li></ul>' }
  ];
}

// Save templates
function saveTemplates(templates) {
  fs.writeFileSync(getTemplatesPath(), JSON.stringify(templates, null, 2), 'utf-8');
}

function createWindow() {
  const settings = loadSettings();

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: settings.spellcheck
    }
  });

  // Security: Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  // Security: Block new windows
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  mainWindow.loadFile('index.html');
}

// IPC Handlers

// Settings
ipcMain.handle('settings:get', async () => loadSettings());
ipcMain.handle('settings:save', async (event, settings) => {
  saveSettings(settings);
  return settings;
});

// Tags
ipcMain.handle('tags:get', async () => loadTags());
ipcMain.handle('tags:save', async (event, tags) => {
  saveTags(tags);
  return tags;
});

// Templates
ipcMain.handle('templates:get', async () => loadTemplates());
ipcMain.handle('templates:save', async (event, templates) => {
  saveTemplates(templates);
  return templates;
});

// Get all notes metadata
ipcMain.handle('notes:list', async () => {
  const notesDir = getNotesDir();
  const files = fs.readdirSync(notesDir).filter(f => f.endsWith('.json'));

  const notes = files.map(file => {
    const filePath = path.join(notesDir, file);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return {
        id: path.basename(file, '.json'),
        title: content.title || 'Untitled',
        preview: content.preview || '',
        updatedAt: content.updatedAt || fs.statSync(filePath).mtime.toISOString(),
        createdAt: content.createdAt,
        pinned: content.pinned || false,
        folder: content.folder || null,
        tags: content.tags || [],
        wordCount: content.wordCount || 0,
        favorite: content.favorite || false
      };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);

  return notes;
});

// Get a single note
ipcMain.handle('notes:get', async (event, id) => {
  const sanitizedId = path.basename(id);
  const filePath = path.join(getNotesDir(), `${sanitizedId}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
});

// Save a note
ipcMain.handle('notes:save', async (event, note) => {
  const sanitizedId = path.basename(note.id);
  const filePath = path.join(getNotesDir(), `${sanitizedId}.json`);

  // Create history snapshot before saving (if note exists)
  if (fs.existsSync(filePath)) {
    const existingNote = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const historyDir = getHistoryDir();
    const historyFile = path.join(historyDir, `${sanitizedId}_${Date.now()}.json`);
    fs.writeFileSync(historyFile, JSON.stringify(existingNote, null, 2), 'utf-8');

    // Keep only last 50 versions per note
    const historyFiles = fs.readdirSync(historyDir)
      .filter(f => f.startsWith(sanitizedId + '_'))
      .sort()
      .reverse();
    if (historyFiles.length > 50) {
      historyFiles.slice(50).forEach(f => {
        fs.unlinkSync(path.join(historyDir, f));
      });
    }
  }

  // Generate preview (first 100 chars of plain text)
  const plainText = note.content ? note.content.replace(/<[^>]*>/g, '').trim() : '';
  const preview = plainText.substring(0, 100);
  const wordCount = plainText ? plainText.split(/\s+/).filter(w => w).length : 0;

  const noteData = {
    id: sanitizedId,
    title: note.title || 'Untitled',
    content: note.content,
    preview,
    wordCount,
    createdAt: note.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pinned: note.pinned || false,
    favorite: note.favorite || false,
    folder: note.folder || null,
    tags: note.tags || [],
    links: note.links || [],
    backlinks: note.backlinks || []
  };

  fs.writeFileSync(filePath, JSON.stringify(noteData, null, 2), 'utf-8');
  return noteData;
});

// Delete a note (move to trash)
ipcMain.handle('notes:delete', async (event, id) => {
  const sanitizedId = path.basename(id);
  const filePath = path.join(getNotesDir(), `${sanitizedId}.json`);
  const trashPath = path.join(getTrashDir(), `${sanitizedId}.json`);

  if (fs.existsSync(filePath)) {
    const note = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    note.deletedAt = new Date().toISOString();
    fs.writeFileSync(trashPath, JSON.stringify(note, null, 2), 'utf-8');
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
});

// Permanently delete a note
ipcMain.handle('notes:permanentDelete', async (event, id) => {
  const sanitizedId = path.basename(id);
  const trashPath = path.join(getTrashDir(), `${sanitizedId}.json`);

  if (fs.existsSync(trashPath)) {
    fs.unlinkSync(trashPath);
    return true;
  }
  return false;
});

// Restore a note from trash
ipcMain.handle('notes:restore', async (event, id) => {
  const sanitizedId = path.basename(id);
  const trashPath = path.join(getTrashDir(), `${sanitizedId}.json`);
  const filePath = path.join(getNotesDir(), `${sanitizedId}.json`);

  if (fs.existsSync(trashPath)) {
    const note = JSON.parse(fs.readFileSync(trashPath, 'utf-8'));
    delete note.deletedAt;
    fs.writeFileSync(filePath, JSON.stringify(note, null, 2), 'utf-8');
    fs.unlinkSync(trashPath);
    return note;
  }
  return null;
});

// Get trash
ipcMain.handle('trash:list', async () => {
  const trashDir = getTrashDir();
  const files = fs.readdirSync(trashDir).filter(f => f.endsWith('.json'));

  return files.map(file => {
    const filePath = path.join(trashDir, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      id: path.basename(file, '.json'),
      title: content.title || 'Untitled',
      deletedAt: content.deletedAt
    };
  });
});

// Empty trash
ipcMain.handle('trash:empty', async () => {
  const trashDir = getTrashDir();
  const files = fs.readdirSync(trashDir).filter(f => f.endsWith('.json'));
  files.forEach(file => fs.unlinkSync(path.join(trashDir, file)));
  return true;
});

// Get note history
ipcMain.handle('history:list', async (event, noteId) => {
  const sanitizedId = path.basename(noteId);
  const historyDir = getHistoryDir();
  const files = fs.readdirSync(historyDir)
    .filter(f => f.startsWith(sanitizedId + '_'))
    .sort()
    .reverse();

  return files.map(file => {
    const timestamp = parseInt(file.replace(sanitizedId + '_', '').replace('.json', ''));
    return {
      file,
      timestamp,
      date: new Date(timestamp).toISOString()
    };
  });
});

// Get specific history version
ipcMain.handle('history:get', async (event, { noteId, file }) => {
  const sanitizedId = path.basename(noteId);
  const sanitizedFile = path.basename(file);
  if (!sanitizedFile.startsWith(sanitizedId + '_')) return null;

  const filePath = path.join(getHistoryDir(), sanitizedFile);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return null;
});

// Restore from history
ipcMain.handle('history:restore', async (event, { noteId, file }) => {
  const sanitizedId = path.basename(noteId);
  const sanitizedFile = path.basename(file);
  if (!sanitizedFile.startsWith(sanitizedId + '_')) return null;

  const historyPath = path.join(getHistoryDir(), sanitizedFile);
  const notePath = path.join(getNotesDir(), `${sanitizedId}.json`);

  if (fs.existsSync(historyPath)) {
    const historicalNote = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    historicalNote.updatedAt = new Date().toISOString();
    fs.writeFileSync(notePath, JSON.stringify(historicalNote, null, 2), 'utf-8');
    return historicalNote;
  }
  return null;
});

// Duplicate note
ipcMain.handle('notes:duplicate', async (event, id) => {
  const sanitizedId = path.basename(id);
  const filePath = path.join(getNotesDir(), `${sanitizedId}.json`);

  if (!fs.existsSync(filePath)) return null;

  const note = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const newId = require('crypto').randomUUID();
  const newNote = {
    ...note,
    id: newId,
    title: `${note.title} (copy)`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pinned: false,
    favorite: false
  };

  const newPath = path.join(getNotesDir(), `${newId}.json`);
  fs.writeFileSync(newPath, JSON.stringify(newNote, null, 2), 'utf-8');
  return newNote;
});

// Export note
ipcMain.handle('notes:export', async (event, { id, format }) => {
  const sanitizedId = path.basename(id);
  const filePath = path.join(getNotesDir(), `${sanitizedId}.json`);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'Note not found' };
  }

  const note = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  const filters = {
    html: { name: 'HTML', extensions: ['html'] },
    json: { name: 'JSON', extensions: ['json'] },
    md: { name: 'Markdown', extensions: ['md'] },
    txt: { name: 'Plain Text', extensions: ['txt'] }
  };

  const result = await dialog.showSaveDialog({
    defaultPath: `${note.title}.${format}`,
    filters: [filters[format]]
  });

  if (result.canceled) {
    return { success: false, canceled: true };
  }

  let exportContent;
  if (format === 'json') {
    exportContent = JSON.stringify(note, null, 2);
  } else if (format === 'html') {
    exportContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${note.title}</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; }
  </style>
</head>
<body>
  <h1>${note.title}</h1>
  ${note.content}
</body>
</html>`;
  } else if (format === 'md' || format === 'txt') {
    // Basic HTML to text conversion
    exportContent = `# ${note.title}\n\n${note.content.replace(/<[^>]*>/g, '').trim()}`;
  }

  fs.writeFileSync(result.filePath, exportContent, 'utf-8');
  return { success: true, path: result.filePath };
});

// Import note
ipcMain.handle('notes:import', async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: 'Supported Files', extensions: ['json', 'html', 'md', 'txt'] }
    ],
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled) return [];

  const imported = [];
  for (const filePath of result.filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    const content = fs.readFileSync(filePath, 'utf-8');
    const baseName = path.basename(filePath, ext);

    let noteContent = '';
    let title = baseName;

    if (ext === '.json') {
      try {
        const json = JSON.parse(content);
        title = json.title || baseName;
        noteContent = json.content || '';
      } catch {
        noteContent = `<pre>${content}</pre>`;
      }
    } else if (ext === '.html') {
      const titleMatch = content.match(/<title>([^<]*)<\/title>/i);
      if (titleMatch) title = titleMatch[1];
      const bodyMatch = content.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      noteContent = bodyMatch ? bodyMatch[1] : content;
    } else {
      noteContent = `<p>${content.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
    }

    const newId = require('crypto').randomUUID();
    const note = {
      id: newId,
      title,
      content: noteContent,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(
      path.join(getNotesDir(), `${newId}.json`),
      JSON.stringify(note, null, 2),
      'utf-8'
    );
    imported.push(note);
  }

  return imported;
});

// Save image
ipcMain.handle('images:save', async (event, { data, filename }) => {
  const imagesDir = getImagesDir();
  const ext = path.extname(filename) || '.png';
  const id = require('crypto').randomUUID();
  const imagePath = path.join(imagesDir, `${id}${ext}`);

  // data is base64
  const buffer = Buffer.from(data, 'base64');
  fs.writeFileSync(imagePath, buffer);

  return `sapphire://images/${id}${ext}`;
});

// Get image
ipcMain.handle('images:get', async (event, filename) => {
  const sanitizedFilename = path.basename(filename);
  const imagePath = path.join(getImagesDir(), sanitizedFilename);

  if (fs.existsSync(imagePath)) {
    const data = fs.readFileSync(imagePath);
    return data.toString('base64');
  }
  return null;
});

// Get notes directory path
ipcMain.handle('notes:getPath', async () => getDataDir());

// Open folder in finder
ipcMain.handle('shell:openPath', async (event, folderPath) => {
  shell.openPath(folderPath);
});

// Get all backlinks for a note
ipcMain.handle('notes:getBacklinks', async (event, noteId) => {
  const notesDir = getNotesDir();
  const files = fs.readdirSync(notesDir).filter(f => f.endsWith('.json'));
  const backlinks = [];

  for (const file of files) {
    const filePath = path.join(notesDir, file);
    const note = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (note.links && note.links.includes(noteId)) {
      backlinks.push({
        id: note.id,
        title: note.title
      });
    }
  }

  return backlinks;
});

// Search notes
ipcMain.handle('notes:search', async (event, query) => {
  const notesDir = getNotesDir();
  const files = fs.readdirSync(notesDir).filter(f => f.endsWith('.json'));
  const results = [];
  const lowerQuery = query.toLowerCase();

  for (const file of files) {
    const filePath = path.join(notesDir, file);
    const note = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const plainText = (note.content || '').replace(/<[^>]*>/g, '').toLowerCase();
    const titleLower = (note.title || '').toLowerCase();

    if (titleLower.includes(lowerQuery) || plainText.includes(lowerQuery)) {
      // Find snippet
      let snippet = '';
      const idx = plainText.indexOf(lowerQuery);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(plainText.length, idx + query.length + 40);
        snippet = (start > 0 ? '...' : '') + plainText.substring(start, end) + (end < plainText.length ? '...' : '');
      }

      results.push({
        id: note.id,
        title: note.title,
        snippet,
        matchInTitle: titleLower.includes(lowerQuery)
      });
    }
  }

  return results;
});

// ============================================
// AI IPC HANDLERS
// ============================================

// Check Ollama status
ipcMain.handle('ai:status', async () => {
  return await checkOllamaStatus();
});

// Get available models
ipcMain.handle('ai:models', async () => {
  return await getOllamaModels();
});

// Store active generation for cancellation
let activeAbortController = null;

// Generate completion (streaming)
ipcMain.handle('ai:generate', async (event, { model, prompt, systemPrompt }) => {
  activeAbortController = new AbortController();

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        system: systemPrompt,
        stream: true
      }),
      signal: activeAbortController.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.response) {
            fullResponse += json.response;
            // Send chunk to renderer
            event.sender.send('ai:chunk', { chunk: json.response, full: fullResponse });
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    activeAbortController = null;
    event.sender.send('ai:complete', { response: fullResponse });
    return { success: true, response: fullResponse };
  } catch (error) {
    activeAbortController = null;
    if (error.name === 'AbortError') {
      return { success: false, cancelled: true };
    }
    event.sender.send('ai:error', { error: error.message });
    return { success: false, error: error.message };
  }
});

// Chat with context (streaming)
ipcMain.handle('ai:chat', async (event, { model, messages }) => {
  activeAbortController = new AbortController();

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true
      }),
      signal: activeAbortController.signal
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            fullResponse += json.message.content;
            event.sender.send('ai:chunk', { chunk: json.message.content, full: fullResponse });
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    activeAbortController = null;
    event.sender.send('ai:complete', { response: fullResponse });
    return { success: true, response: fullResponse };
  } catch (error) {
    activeAbortController = null;
    if (error.name === 'AbortError') {
      return { success: false, cancelled: true };
    }
    event.sender.send('ai:error', { error: error.message });
    return { success: false, error: error.message };
  }
});

// Cancel active generation
ipcMain.handle('ai:cancel', async () => {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
    return { success: true };
  }
  return { success: false };
});

// Quick AI actions (streaming for better UX)
ipcMain.handle('ai:action', async (event, { model, action, text }) => {
  const prompts = {
    summarize: {
      system: 'You are a helpful assistant that creates concise summaries. Respond only with the summary, no preamble.',
      prompt: `Summarize the following text in 2-3 sentences:\n\n${text}`
    },
    expand: {
      system: 'You are a helpful writing assistant. Expand on the given text while maintaining its tone and style. Respond only with the expanded text.',
      prompt: `Expand the following text with more detail and depth:\n\n${text}`
    },
    rewrite: {
      system: 'You are a helpful writing assistant. Rewrite the given text to improve clarity and flow. Respond only with the rewritten text.',
      prompt: `Rewrite the following text to be clearer and more engaging:\n\n${text}`
    },
    simplify: {
      system: 'You are a helpful writing assistant. Simplify the given text using plain language. Respond only with the simplified text.',
      prompt: `Simplify the following text for easier understanding:\n\n${text}`
    },
    professional: {
      system: 'You are a professional writing assistant. Rewrite in a formal, professional tone. Respond only with the rewritten text.',
      prompt: `Rewrite the following in a professional tone:\n\n${text}`
    },
    casual: {
      system: 'You are a friendly writing assistant. Rewrite in a casual, conversational tone. Respond only with the rewritten text.',
      prompt: `Rewrite the following in a casual, friendly tone:\n\n${text}`
    },
    bullets: {
      system: 'You are a helpful assistant. Convert text to bullet points. Respond only with the bullet points.',
      prompt: `Convert the following text into clear bullet points:\n\n${text}`
    },
    fix_grammar: {
      system: 'You are a grammar expert. Fix grammar and spelling errors. Respond only with the corrected text.',
      prompt: `Fix any grammar and spelling errors in the following text:\n\n${text}`
    },
    translate_spanish: {
      system: 'You are a translator. Translate to Spanish. Respond only with the translation.',
      prompt: `Translate the following to Spanish:\n\n${text}`
    },
    translate_french: {
      system: 'You are a translator. Translate to French. Respond only with the translation.',
      prompt: `Translate the following to French:\n\n${text}`
    },
    translate_german: {
      system: 'You are a translator. Translate to German. Respond only with the translation.',
      prompt: `Translate the following to German:\n\n${text}`
    },
    translate_chinese: {
      system: 'You are a translator. Translate to Simplified Chinese. Respond only with the translation.',
      prompt: `Translate the following to Simplified Chinese:\n\n${text}`
    },
    translate_japanese: {
      system: 'You are a translator. Translate to Japanese. Respond only with the translation.',
      prompt: `Translate the following to Japanese:\n\n${text}`
    },
    explain: {
      system: 'You are a helpful teacher. Explain concepts clearly. Respond with a clear explanation.',
      prompt: `Explain the following in simple terms:\n\n${text}`
    },
    continue: {
      system: 'You are a creative writing assistant. Continue the text naturally. Respond only with the continuation.',
      prompt: `Continue writing from where this text leaves off:\n\n${text}`
    }
  };

  const config = prompts[action];
  if (!config) {
    return { success: false, error: 'Unknown action' };
  }

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: config.prompt,
        system: config.system,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.response) {
            fullResponse += json.response;
            event.sender.send('ai:chunk', { chunk: json.response, full: fullResponse });
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }

    event.sender.send('ai:complete', { response: fullResponse });
    return { success: true, response: fullResponse };
  } catch (error) {
    event.sender.send('ai:error', { error: error.message });
    return { success: false, error: error.message };
  }
});

// Generate tags for note
ipcMain.handle('ai:suggest-tags', async (event, { model, title, content }) => {
  const settings = loadSettings();
  const useModel = model || settings.aiModel || 'gemma3:latest';
  const plainText = (content || '').replace(/<[^>]*>/g, '').trim();

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: useModel,
        prompt: `Based on this note, suggest 3-5 relevant single-word tags. Return only the tags as a comma-separated list, nothing else.\n\nTitle: ${title || 'Untitled'}\n\nContent: ${plainText.substring(0, 1000)}`,
        system: 'You are a helpful assistant that suggests relevant tags for notes. Respond only with comma-separated single-word tags.',
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const data = await response.json();
    const tags = data.response.split(',').map(t => t.trim().toLowerCase()).filter(t => t && t.length < 20);
    return { success: true, tags };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Generate title for note
ipcMain.handle('ai:suggest-title', async (event, { model, content }) => {
  const settings = loadSettings();
  const useModel = model || settings.aiModel || 'gemma3:latest';
  const plainText = (content || '').replace(/<[^>]*>/g, '').trim();

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: useModel,
        prompt: `Based on this note content, suggest a short, descriptive title (max 6 words). Return only the title, nothing else.\n\n${plainText.substring(0, 500)}`,
        system: 'You are a helpful assistant. Respond only with a short title.',
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }

    const data = await response.json();
    return { success: true, title: data.response.trim().replace(/^["']|["']$/g, '') };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

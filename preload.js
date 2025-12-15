const { contextBridge, ipcRenderer } = require('electron');

// Secure bridge - only expose specific, validated methods to renderer
contextBridge.exposeInMainWorld('api', {
  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings)
  },

  // Tags
  tags: {
    get: () => ipcRenderer.invoke('tags:get'),
    save: (tags) => ipcRenderer.invoke('tags:save', tags)
  },

  // Templates
  templates: {
    get: () => ipcRenderer.invoke('templates:get'),
    save: (templates) => ipcRenderer.invoke('templates:save', templates)
  },

  // Note operations
  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    get: (id) => ipcRenderer.invoke('notes:get', id),
    save: (note) => ipcRenderer.invoke('notes:save', note),
    delete: (id) => ipcRenderer.invoke('notes:delete', id),
    permanentDelete: (id) => ipcRenderer.invoke('notes:permanentDelete', id),
    restore: (id) => ipcRenderer.invoke('notes:restore', id),
    duplicate: (id) => ipcRenderer.invoke('notes:duplicate', id),
    export: (id, format) => ipcRenderer.invoke('notes:export', { id, format }),
    import: () => ipcRenderer.invoke('notes:import'),
    getPath: () => ipcRenderer.invoke('notes:getPath'),
    getBacklinks: (id) => ipcRenderer.invoke('notes:getBacklinks', id),
    search: (query) => ipcRenderer.invoke('notes:search', query)
  },

  // Trash
  trash: {
    list: () => ipcRenderer.invoke('trash:list'),
    empty: () => ipcRenderer.invoke('trash:empty')
  },

  // History
  history: {
    list: (noteId) => ipcRenderer.invoke('history:list', noteId),
    get: (noteId, file) => ipcRenderer.invoke('history:get', { noteId, file }),
    restore: (noteId, file) => ipcRenderer.invoke('history:restore', { noteId, file })
  },

  // Images
  images: {
    save: (data, filename) => ipcRenderer.invoke('images:save', { data, filename }),
    get: (filename) => ipcRenderer.invoke('images:get', filename)
  },

  // Shell
  shell: {
    openPath: (path) => ipcRenderer.invoke('shell:openPath', path)
  },

  // AI (Ollama)
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    models: () => ipcRenderer.invoke('ai:models'),
    generate: (params) => ipcRenderer.invoke('ai:generate', params),
    chat: (params) => ipcRenderer.invoke('ai:chat', params),
    cancel: () => ipcRenderer.invoke('ai:cancel'),
    action: (params) => ipcRenderer.invoke('ai:action', params),
    suggestTags: (content) => ipcRenderer.invoke('ai:suggest-tags', { content }),
    suggestTitle: (content) => ipcRenderer.invoke('ai:suggest-title', { content }),
    onChunk: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('ai:chunk', handler);
      return () => ipcRenderer.removeListener('ai:chunk', handler);
    },
    onComplete: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('ai:complete', handler);
      return () => ipcRenderer.removeListener('ai:complete', handler);
    },
    onError: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('ai:error', handler);
      return () => ipcRenderer.removeListener('ai:error', handler);
    }
  }
});

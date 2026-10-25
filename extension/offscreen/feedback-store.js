// A bounded snapshot in extension-owned IndexedDB. Never storage.sync.
(function (root) {
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('control-x-personal-feedback', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('memory');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = null; reject(request.error); };
    });
    return database;
  }
  async function load() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('memory', 'readonly');
      const request = tx.objectStore('memory').get('state');
      request.onsuccess = () => resolve(request.result || { revision: 0, examples: [], undo: null });
      request.onerror = () => reject(request.error);
    });
  }
  async function save(state) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('memory', 'readwrite');
      tx.objectStore('memory').put(state, 'state');
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Feedback could not be saved'));
    });
  }
  root.control.feedbackStore = { load, save };
})(globalThis);

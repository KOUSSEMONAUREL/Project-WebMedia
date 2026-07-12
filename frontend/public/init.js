(() => {
  // Enregistrement SW conditionnel au consentement utilisateur
  if ('serviceWorker' in navigator) {
    const consent = localStorage.getItem('webmedia_storage_consent');
    if (consent === 'full') {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => { });
      });
    }
  }
  const favKey = 'webmedia_favorites';
  const wlKey = 'webmedia_watchlist';
  if (localStorage.getItem(favKey) || localStorage.getItem(wlKey)) {
    const request = indexedDB.open('webmedia', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('favorites')) db.createObjectStore('favorites', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('watchlist')) db.createObjectStore('watchlist', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'mediaId' });
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(['favorites', 'watchlist'], 'readwrite');
      try {
        const favRaw = localStorage.getItem(favKey);
        if (favRaw) {
          const ids = JSON.parse(favRaw);
          const store = tx.objectStore('favorites');
          ids.forEach((id) => store.put({ id, type: '', title: '', slug: '', addedAt: Date.now() }));
          localStorage.removeItem(favKey);
        }
        const wlRaw = localStorage.getItem(wlKey);
        if (wlRaw) {
          const ids = JSON.parse(wlRaw);
          const store = tx.objectStore('watchlist');
          ids.forEach((id) => store.put({ id, type: '', title: '', slug: '', addedAt: Date.now() }));
          localStorage.removeItem(wlKey);
        }
        tx.oncomplete = () => db.close();
      } catch {
        tx.abort();
      }
    };
  }
})();
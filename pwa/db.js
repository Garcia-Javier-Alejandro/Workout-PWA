// IndexedDB persistence layer.
//
// Two object stores:
//  - "kv": small key/value store. Holds the single active session under the
//    key "active" (or nothing when there is no active session).
//  - "sessions": completed sessions kept locally. Each record carries a
//    `synced` flag. Records with synced=false are the sync queue for D1.
//
// The active session is stored in IndexedDB (not just localStorage) so that a
// complete session can be recorded offline and the whole structured state
// survives Firefox closing, phone reboots, and any amount of time passing.

const DB_NAME = "workout-pwa";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) {
        db.createObjectStore("kv");
      }
      if (!db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("synced", "synced", { unique: false });
        store.createIndex("completed_at", "completed_at", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const DB = {
  async getActiveSession() {
    const db = await openDB();
    const result = await reqToPromise(tx(db, "kv", "readonly").get("active"));
    db.close();
    return result || null;
  },

  async setActiveSession(session) {
    const db = await openDB();
    await reqToPromise(tx(db, "kv", "readwrite").put(session, "active"));
    db.close();
  },

  async clearActiveSession() {
    const db = await openDB();
    await reqToPromise(tx(db, "kv", "readwrite").delete("active"));
    db.close();
  },

  async saveCompletedSession(session) {
    const db = await openDB();
    await reqToPromise(tx(db, "sessions", "readwrite").put(session));
    db.close();
  },

  async getAllCompletedSessions() {
    const db = await openDB();
    const result = await reqToPromise(tx(db, "sessions", "readonly").getAll());
    db.close();
    return result || [];
  },

  async getUnsyncedSessions() {
    const all = await this.getAllCompletedSessions();
    return all.filter((s) => !s.synced);
  },

  async markSynced(sessionId) {
    const db = await openDB();
    const store = tx(db, "sessions", "readwrite");
    const session = await reqToPromise(store.get(sessionId));
    if (session) {
      session.synced = true;
      await reqToPromise(store.put(session));
    }
    db.close();
  },
};

window.DB = DB;

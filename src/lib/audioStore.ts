/**
 * Biblioteca de áudio do usuário.
 * Arquivos de mídia não cabem no localStorage (limite de ~5 MB e só texto),
 * então os binários ficam no IndexedDB. Continua 100% local, sem API.
 */

const DB_NAME = "trilha-audio";
const STORE = "tracks";

export interface StoredTrack {
  id: string;
  name: string;
  size: number;
  addedAt: number;
  blob: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB indisponível"));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = action(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("Falha na transação"));
        };
      }),
  );
}

export const listStoredTracks = async (): Promise<StoredTrack[]> => {
  const all = await run<StoredTrack[]>("readonly", (s) => s.getAll() as IDBRequest<StoredTrack[]>);
  return all.sort((a, b) => a.addedAt - b.addedAt);
};

export const saveTrack = async (file: File): Promise<StoredTrack> => {
  const track: StoredTrack = {
    id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name.replace(/\.[^.]+$/, ""),
    size: file.size,
    addedAt: Date.now(),
    blob: file,
  };
  await run("readwrite", (s) => s.put(track));
  return track;
};

export const removeTrack = async (id: string): Promise<void> => {
  await run("readwrite", (s) => s.delete(id));
};

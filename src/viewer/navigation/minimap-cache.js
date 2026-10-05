const DATABASE_NAME = "pdf-viewer-minimap-cache";
const DATABASE_VERSION = 1;
const STORE_NAME = "thumbnail-sets";
const MAX_CACHE_ENTRIES = 16;

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionFinished(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("IndexedDB is unavailable"));
  }

  databasePromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      store.createIndex("accessedAt", "accessedAt");
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });

  return databasePromise;
}

export function createThumbnailCacheKey(fingerprint, rotation, renderWidth) {
  return `${fingerprint}:${rotation}:${renderWidth}:strip-v1`;
}

export async function readThumbnailCache(key, expectedPageCount) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const record = await requestResult(transaction.objectStore(STORE_NAME).get(key));
  await transactionFinished(transaction);

  if (!record || record.pageCount !== expectedPageCount || !record.blob) {
    return null;
  }

  const touchTransaction = database.transaction(STORE_NAME, "readwrite");
  touchTransaction.objectStore(STORE_NAME).put({ ...record, accessedAt: Date.now() });
  void transactionFinished(touchTransaction).catch(() => {});
  return record.blob;
}

export async function writeThumbnailCache(key, blob, pageCount) {
  const database = await openDatabase();
  const writeTransaction = database.transaction(STORE_NAME, "readwrite");
  writeTransaction.objectStore(STORE_NAME).put({
    key,
    pageCount,
    blob,
    accessedAt: Date.now(),
  });
  await transactionFinished(writeTransaction);

  const trimTransaction = database.transaction(STORE_NAME, "readwrite");
  const store = trimTransaction.objectStore(STORE_NAME);
  let entriesToRemove = (await requestResult(store.count())) - MAX_CACHE_ENTRIES;
  if (entriesToRemove <= 0) {
    await transactionFinished(trimTransaction);
    return;
  }

  const cursorRequest = store.index("accessedAt").openKeyCursor();
  await new Promise((resolve, reject) => {
    cursorRequest.addEventListener("success", () => {
      const cursor = cursorRequest.result;
      if (!cursor || entriesToRemove <= 0) {
        resolve();
        return;
      }

      store.delete(cursor.primaryKey);
      entriesToRemove -= 1;
      cursor.continue();
    });
    cursorRequest.addEventListener("error", () => reject(cursorRequest.error), { once: true });
  });
  await transactionFinished(trimTransaction);
}

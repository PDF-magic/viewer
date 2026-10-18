// Keep PDF tab identities across unpacked-extension reloads, including file:// PDFs.
// Only URLs and reading positions are saved; PDF bytes never enter extension storage.
(() => {
  const STORAGE_KEY = "pdf-viewer-open-tabs-v1";
  const VIEWERS = ["src/viewer.html", "viewer.html"].map((path) => chrome.runtime.getURL(path));
  let registryPromise;
  let writes = Promise.resolve();
  let recovering = false;
  const replacements = new Map();

  function validSource(value) {
    try {
      const url = new URL(value);
      return ["https:", "http:", "file:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function viewerSource(value) {
    try {
      const url = new URL(value);
      if (!VIEWERS.some((viewer) => url.origin + url.pathname === viewer)) return null;
      return validSource(url.searchParams.get("url"));
    } catch {
      return null;
    }
  }

  function tabSource(value) {
    const explicit = viewerSource(value);
    if (explicit) return explicit;
    const source = validSource(value);
    if (!source) return null;
    return /\.pdf$/i.test(new URL(source).pathname) ? source : null;
  }

  function sameDocument(a, b) {
    try {
      const first = new URL(a);
      const second = new URL(b);
      first.hash = "";
      second.hash = "";
      return first.href === second.href;
    } catch {
      return false;
    }
  }

  function resumeUrl(record) {
    const source = new URL(record.source);
    if (record.mode === "viewer") {
      const viewer = VIEWERS[record.viewerIndex === 1 ? 1 : 0];
      const target = new URL(viewer);
      target.searchParams.set("url", source.href);
      if (record.page > 1) target.hash = "page=" + record.page;
      return target.href;
    }
    if (record.page > 1) source.hash = "page=" + record.page;
    return source.href;
  }

  async function registry() {
    registryPromise ||= chrome.storage.local.get(STORAGE_KEY).then((data) => {
      const saved = data[STORAGE_KEY];
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    }).catch(() => ({}));
    return registryPromise;
  }

  function persist(entries) {
    const snapshot = Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, { ...value }]));
    writes = writes.catch(() => {}).then(() => chrome.storage.local.set({ [STORAGE_KEY]: snapshot }));
    return writes;
  }

  async function track(tab, source, page, preferredMode) {
    if (!Number.isInteger(tab?.id) || tab.id < 0 || tab.incognito) return;
    const safeSource = validSource(source);
    if (!safeSource) return;
    const entries = await registry();
    const old = entries[tab.id];
    const mode = preferredMode || (viewerSource(tab.url) ? "viewer" : "source");
    const activeViewerIndex = VIEWERS.findIndex((viewer) => tab.url?.startsWith(viewer));
    entries[tab.id] = {
      source: safeSource,
      mode,
      viewerIndex: activeViewerIndex === 1 ? 1 : 0,
      page: Number.isSafeInteger(page) && page > 0 ? page : (sameDocument(old?.source, safeSource) ? old.page : 1) || 1,
      windowId: tab.windowId,
      index: tab.index,
      pinned: Boolean(tab.pinned),
      active: Boolean(tab.active),
    };
    await persist(entries);
  }

  async function forget(tabId) {
    const entries = await registry();
    if (entries[tabId]) {
      delete entries[tabId];
      await persist(entries);
    }
  }

  // Only the extension's own top-level viewer can register a PDF. This also
  // covers MIME-handler PDFs whose browser tab displays the original file URL.
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!["pdf-viewer:opened", "pdf-viewer:page"].includes(message?.type)) return;
    if (!VIEWERS.some((viewer) => sender.url?.startsWith(viewer))) return;
    const tab = sender.tab;
    if (!tab || !Number.isInteger(tab.id) || tab.incognito) return;
    const source = validSource(message.sourceUrl);
    if (!source) return;
    const currentViewerSource = viewerSource(tab.url);
    if (!sameDocument(currentViewerSource || tab.url, source) &&
      !VIEWERS.some((viewer) => tab.url?.startsWith(viewer))) return;
    void track(tab, source, message.page, message.mimeHandlerActive ? "source" : "viewer")
      .then(() => respond({ ok: true }))
      .catch(() => respond({ ok: false }));
    return true;
  });

  chrome.tabs.onUpdated.addListener((tabId, changes, tab) => {
    if (!changes.url || tab?.incognito) return;
    const source = tabSource(changes.url);
    if (source) {
      void track({ ...tab, id: tabId }, source);
    } else if (/^(https?:|file:|about:|chrome:)/.test(changes.url) &&
      !changes.url.startsWith("chrome-error:")) {
      void forget(tabId);
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    // A reload may destroy extension-owned tabs just as the old worker exits.
    // Defer normal close cleanup so an interrupted worker preserves recovery data.
    if (!recovering) setTimeout(() => { if (!recovering) void forget(tabId); }, 2000);
  });

  async function fileAccessAllowed() {
    if (!chrome.extension?.isAllowedFileSchemeAccess) return false;
    try { return await chrome.extension.isAllowedFileSchemeAccess(); }
    catch { return false; }
  }

  async function recover(onlyMissing = false) {
    recovering = true;
    try {
      const entries = await registry();
      const before = Object.entries(entries)
        .filter(([, record]) => validSource(record?.source))
        .sort((a, b) => (a[1].windowId - b[1].windowId) || (a[1].index - b[1].index));
      const existing = new Map((await chrome.tabs.query({})).map((tab) => [tab.id, tab]));
      const mayOpenFiles = await fileAccessAllowed();

      for (const [oldId, record] of before) {
        if (new URL(record.source).protocol === "file:" && !mayOpenFiles) continue;
        const tab = existing.get(Number(oldId)) || existing.get(replacements.get(oldId));
        const target = resumeUrl(record);
        if (tab) {
          // Never take over a tab that navigated to a different page.
          if (!sameDocument(viewerSource(tab.url) || tab.url, record.source)) {
            await forget(oldId);
            continue;
          }
          if (onlyMissing) continue;
          try {
            if (tab.url === target) await chrome.tabs.reload(tab.id);
            else await chrome.tabs.update(tab.id, { url: target });
          } catch { /* Keep existing tab when Chrome refuses a reload. */ }
          continue;
        }

        // Chrome may have closed an extension-owned tab. Recreate only the
        // exact registered document, in its original window and order.
        let created;
        try {
          created = await chrome.tabs.create({
            url: target, windowId: record.windowId, index: record.index,
            pinned: record.pinned, active: Boolean(record.active),
          });
        } catch {
          try { created = await chrome.tabs.create({ url: target, active: Boolean(record.active) }); }
          catch { continue; }
        }
        replacements.set(oldId, created.id);
        existing.set(created.id, created);
        entries[created.id] = { ...record, windowId: created.windowId, index: created.index };
        delete entries[oldId];
        await persist(entries);
      }
    } finally {
      recovering = false;
    }
  }

  chrome.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "update") {
      // Unpacked extension Reload is an update. A second pass covers tabs
      // removed just after the new worker starts without recreating duplicates.
      void recover().then(() => new Promise((resolve) => setTimeout(resolve, 1200)))
        .then(() => recover(true)).catch((error) => console.warn("PDF tab recovery failed", error));
    }
  });
})();
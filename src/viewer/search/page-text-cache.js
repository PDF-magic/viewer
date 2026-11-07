// Budget includes UTF-16 strings, geometry, and estimated object overhead.
// Oversized pages remain searchable but are not retained between queries.
export class PageTextCache {
  constructor(maxBytes = 4 * 1024 * 1024) {
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.bytes = 0;
  }

  get(pageNumber) {
    const entry = this.entries.get(pageNumber);
    if (!entry) return undefined;
    this.entries.delete(pageNumber);
    this.entries.set(pageNumber, entry);
    return entry.items;
  }

  set(pageNumber, items) {
    const previous = this.entries.get(pageNumber);
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(pageNumber);
    }
    const bytes = 128 + items.reduce((total, item) => total + 256 + 2 * item.str.length, 0);
    if (bytes > this.maxBytes) return;
    this.entries.set(pageNumber, { items, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      this.bytes -= this.entries.get(oldest).bytes;
      this.entries.delete(oldest);
    }
  }
}

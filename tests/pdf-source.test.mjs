import assert from 'node:assert/strict';
import test from 'node:test';

test('MIME-handler consumers share one stream fetch and receive independent byte copies', async () => {
  const originalWindow = globalThis.window;
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  let streamInfoCalls = 0;
  let fetchCalls = 0;

  globalThis.window = { location: { search: '' } };
  globalThis.chrome = {
    mimeHandler: {
      async getStreamInfo() {
        streamInfoCalls += 1;
        return {
          originalUrl: 'https://example.com/document.pdf',
          streamUrl: 'blob:pdf-stream',
        };
      },
    },
  };
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      async arrayBuffer() {
        return Uint8Array.from([1, 2, 3]).buffer;
      },
    };
  };

  try {
    const { resolvePdfSource } = await import(`../src/viewer/pdf-source.js?test=${Date.now()}`);
    const [viewerSource, minimapSource] = await Promise.all([
      resolvePdfSource(),
      resolvePdfSource(),
    ]);

    assert.equal(streamInfoCalls, 1);
    assert.equal(fetchCalls, 1);
    assert.notEqual(viewerSource.data.buffer, minimapSource.data.buffer);
    assert.deepEqual([...viewerSource.data], [1, 2, 3]);
    assert.deepEqual([...minimapSource.data], [1, 2, 3]);
    assert.equal(viewerSource.mimeHandlerActive, true);
  } finally {
    globalThis.window = originalWindow;
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

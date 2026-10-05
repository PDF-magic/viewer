const params = new URLSearchParams(window.location.search);
const explicitSource = params.get("url");

let sourcePromise;

async function loadPdfSource() {
  if (chrome.mimeHandler?.getStreamInfo) {
    try {
      const streamInfo = await chrome.mimeHandler.getStreamInfo();
      const response = await fetch(streamInfo.streamUrl);
      if (!response.ok) {
        throw new Error(`Could not read PDF stream (${response.status}).`);
      }

      return {
        originalUrl: new URL(streamInfo.originalUrl),
        data: await response.arrayBuffer(),
        mimeHandlerActive: true,
      };
    } catch (error) {
      if (!explicitSource) {
        throw error;
      }
    }
  }

  if (!explicitSource) {
    throw new Error("No PDF URL or MIME-handler stream was provided.");
  }

  const originalUrl = new URL(explicitSource);
  const requestUrl = new URL(originalUrl.href);
  requestUrl.hash = "";

  return {
    originalUrl,
    url: requestUrl.href,
    mimeHandlerActive: false,
  };
}

export async function resolvePdfSource() {
  sourcePromise ||= loadPdfSource();
  const resolvedSource = await sourcePromise;

  return {
    ...resolvedSource,
    data: resolvedSource.data ? new Uint8Array(resolvedSource.data.slice(0)) : undefined,
  };
}

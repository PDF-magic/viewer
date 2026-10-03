(() => {
  const clipboard = navigator.clipboard;
  const nativeWriteText = clipboard?.writeText?.bind(clipboard);

  function legacyWriteText(value) {
    const textarea = document.createElement("textarea");
    const activeElement = document.activeElement;

    textarea.value = String(value);
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.append(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    const copied = document.execCommand("copy");
    textarea.remove();
    activeElement?.focus?.({ preventScroll: true });

    if (!copied) {
      throw new Error("Legacy clipboard copy failed.");
    }
  }

  async function writeText(value) {
    const text = String(value);

    if (nativeWriteText) {
      try {
        await nativeWriteText(text);
        return;
      } catch {
        // Embedded extension pages can be denied clipboard-write by the host page's
        // Permissions Policy. The extension's clipboardWrite permission still
        // allows the legacy copy command below.
      }
    }

    legacyWriteText(text);
  }

  if (!clipboard) {
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
    } catch {
      // Existing copy handlers will surface their normal failure state.
    }
    return;
  }

  try {
    Object.defineProperty(clipboard, "writeText", {
      configurable: true,
      value: writeText,
    });
  } catch {
    try {
      clipboard.writeText = writeText;
    } catch {
      // Existing copy handlers will surface their normal failure state.
    }
  }
})();

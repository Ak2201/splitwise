/**
 * Turning generated content into files and clipboard contents.
 * Kept in one place so every export path revokes its object URLs.
 */

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function downloadCsv(filename, csv) {
  downloadText(filename, csv, 'text/csv;charset=utf-8');
}

export function downloadJson(filename, data) {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json');
}

/**
 * Copy to the clipboard, falling back for browsers (and insecure origins)
 * where the async clipboard API is unavailable. Returns whether it worked so
 * the caller can show the text for manual copying instead of lying about it.
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Offer the OS share sheet when there is one; returns false if unavailable. */
export async function shareText(title, text) {
  if (!navigator.share) return false;
  try {
    await navigator.share({ title, text });
    return true;
  } catch (error) {
    // AbortError just means the user dismissed the sheet; not a failure.
    return error?.name === 'AbortError';
  }
}

/** Read a user-picked file as text. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    }, { once: true });
    input.click();
  });
}

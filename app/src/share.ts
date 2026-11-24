// Getting a file off the phone: the share sheet (Bluetooth to the PC, AirDrop, Files, a messenger) or a plain download.
import { isIOS } from './platform';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function canShareFile(file: File): boolean {
  try {
    return !!navigator.canShare && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export type SendResult = 'shared' | 'downloaded' | 'cancel';

/**
 * Send a file with the phone's share sheet (Bluetooth / AirDrop / Files / messenger); falls back to a download
 * (PC browser, old phones). 'cancel' = the user closed the share sheet.
 */
export async function sendFile(blob: Blob, name: string): Promise<SendResult> {
  // bare MIME type: Chrome on Android refuses to share "text/csv;charset=utf-8" (only exact allowed types such as text/csv).
  // Note: it never shares .json (not on its list), so marks files fall back to a download there.
  const file = new File([blob], name, { type: (blob.type || 'application/octet-stream').split(';')[0].trim() });
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancel';
      // share refused: fall back to a download
    }
  }
  download(blob, name);
  return 'downloaded';
}

/** Keep a file on this phone: a download (Downloads folder); on iPhone the share sheet (Save to Files), downloads are unreliable there. */
export async function saveFile(blob: Blob, name: string): Promise<SendResult> {
  if (isIOS()) return sendFile(blob, name);
  download(blob, name);
  return 'downloaded';
}

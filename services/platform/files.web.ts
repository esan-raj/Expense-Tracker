export async function saveAndShare(filename: string, content: string, mimeType: string): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('Downloads are only available in the browser.');
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function pickTextFile(mimeTypes: string[]): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = mimeTypes.join(',');
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file.text().then(resolve).catch(reject);
    };
    input.click();
  });
}

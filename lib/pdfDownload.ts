export function getPdfFileName(pdfUrl: string) {
  try {
    const url = new URL(pdfUrl, "https://local.invalid");
    const fileName = url.pathname.split("/").filter(Boolean).at(-1);

    if (!fileName || !fileName.toLowerCase().endsWith(".pdf")) {
      return null;
    }

    return decodeURIComponent(fileName);
  } catch {
    return null;
  }
}

export function getPdfDownloadUrl(pdfUrl: string) {
  const fileName = getPdfFileName(pdfUrl);
  return fileName ? `/api/download?file=${encodeURIComponent(fileName)}` : pdfUrl;
}

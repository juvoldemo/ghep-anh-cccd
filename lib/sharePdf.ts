export async function sharePdfFile(downloadUrl: string, fileName: string, title: string) {
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error("Cannot load PDF for sharing.");

  const blob = await response.blob();
  const file = new File([blob], fileName, { type: "application/pdf" });
  const shareData: ShareData = { title, files: [file] };

  if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
    await navigator.share(shareData);
    return "shared";
  }

  window.location.href = downloadUrl;
  return "opened";
}

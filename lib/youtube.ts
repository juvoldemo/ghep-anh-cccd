const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export function extractYouTubeId(url: string) {
  const value = url.trim();
  if (!value) return null;
  if (YOUTUBE_ID_PATTERN.test(value)) return value;

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, "");

    if (host === "youtube.com" || host === "m.youtube.com") {
      const watchId = parsed.searchParams.get("v");
      if (watchId && YOUTUBE_ID_PATTERN.test(watchId)) return watchId;

      const [, type, id] = parsed.pathname.split("/");
      if ((type === "shorts" || type === "embed") && id && YOUTUBE_ID_PATTERN.test(id)) {
        return id;
      }
    }

    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      if (id && YOUTUBE_ID_PATTERN.test(id)) return id;
    }
  } catch {
    return null;
  }

  return null;
}

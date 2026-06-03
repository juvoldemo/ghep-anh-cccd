"use client";

type YoutubeGuideViewerProps = {
  title: string;
  description?: string;
  youtubeId: string;
  youtubeUrl?: string;
};

export function YoutubeGuideViewer({ title, description, youtubeId, youtubeUrl }: YoutubeGuideViewerProps) {
  const watchUrl = youtubeUrl || `https://www.youtube.com/watch?v=${youtubeId}`;

  const copyLink = async () => {
    await navigator.clipboard.writeText(watchUrl);
  };

  return (
    <section className="youtubeGuide">
      <div className="video-wrapper">
        <iframe
          src={`https://www.youtube.com/embed/${youtubeId}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      {description ? <p className="summary">{description}</p> : null}
      <div className="youtubeActions">
        <a className="downloadButton compactButton" href={watchUrl} target="_blank" rel="noreferrer">
          Mở trên YouTube
        </a>
        <button className="secondaryButton compactButton" type="button" onClick={() => void copyLink()}>
          Sao chép link
        </button>
      </div>
    </section>
  );
}

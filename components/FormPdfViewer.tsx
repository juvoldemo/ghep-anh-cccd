"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type FormPdfViewerProps = {
  pdfUrl: string;
  title: string;
};

export function FormPdfViewer({ pdfUrl, title }: FormPdfViewerProps) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState("Dang tai PDF...");
  const [renderTick, setRenderTick] = useState(0);
  const [shareStatus, setShareStatus] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setStatus("Dang tai PDF...");
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
      const loaded = await pdfjs.getDocument({ url: pdfUrl }).promise;
      if (cancelled) return;
      setPdf(loaded);
      setPage(1);
      setPageCount(loaded.numPages);
      setStatus("");
    }

    void loadPdf().catch(() => {
      if (!cancelled) setStatus("Khong the tai PDF.");
    });

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  useEffect(() => {
    const onResize = () => setRenderTick((value) => value + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;

    async function renderPage() {
      setStatus("Dang hien thi trang...");
      const activePdf = pdf;
      const pdfPage = await activePdf.getPage(page);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap || cancelled) return;

      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const availableWidth = Math.max(1, wrap.clientWidth - 2);
      const displayScale = availableWidth / baseViewport.width;
      const qualityScale = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
      const viewport = pdfPage.getViewport({ scale: displayScale * qualityScale });
      const displayWidth = Math.floor(baseViewport.width * displayScale);
      const displayHeight = Math.floor(baseViewport.height * displayScale);

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is not supported.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: context, canvas, viewport }).promise;
      if (!cancelled) setStatus("");
    }

    void renderPage().catch(() => {
      if (!cancelled) setStatus("Khong the hien thi PDF.");
    });

    return () => {
      cancelled = true;
    };
  }, [pdf, page, renderTick]);

  const prevPage = () => setPage((current) => Math.max(1, current - 1));
  const nextPage = () => setPage((current) => Math.min(pageCount || current, current + 1));

  const sharePdf = async () => {
    const url = new URL(pdfUrl, window.location.origin).toString();
    setShareStatus("");

    try {
      if (navigator.share) {
        await navigator.share({
          title,
          text: title,
          url
        });
        return;
      }

      await navigator.clipboard.writeText(url);
      setShareStatus("Da copy link chia se");
      window.setTimeout(() => setShareStatus(""), 1800);
    } catch {
      setShareStatus("");
    }
  };

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/forms");
  };

  return (
    <>
      <div className="formPdfToolbar">
        <span>{page} / {pageCount || "..."}</span>
        <div className="formPdfControls">
          <button className="secondaryButton iconOnlyButton" type="button" onClick={prevPage} disabled={page <= 1} aria-label="Trang trước">
            <span className="buttonIcon previousIcon" aria-hidden="true" />
          </button>
          <button className="secondaryButton iconOnlyButton" type="button" onClick={nextPage} disabled={!pageCount || page >= pageCount} aria-label="Trang sau">
            <span className="buttonIcon nextIcon" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div ref={wrapRef} className="formPdfFrame">
        <canvas ref={canvasRef} className="formPdfCanvas" />
        {status ? <div className="slideStatus">{status}</div> : null}
      </div>
      <div className="actionRow">
        <button className="secondaryButton iconOnlyButton actionIconButton" type="button" onClick={() => void sharePdf()} aria-label="Chia sẻ">
          <span className="buttonIcon shareIcon" aria-hidden="true" />
        </button>
        <a className="downloadButton iconOnlyButton actionIconButton" href={pdfUrl} download aria-label="Tải về">
          <span className="buttonIcon downloadArrowIcon" aria-hidden="true" />
        </a>
      </div>
      <button className="secondaryButton formBackButton" type="button" onClick={goBack}>
        Quay lại trang trước
      </button>
      {shareStatus ? <div className="success">{shareStatus}</div> : null}
    </>
  );
}

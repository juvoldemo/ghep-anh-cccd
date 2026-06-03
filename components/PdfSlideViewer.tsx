"use client";

import { useEffect, useRef, useState } from "react";
import { getPdfDownloadUrl, getPdfFileName } from "@/lib/pdfDownload";

type PdfSlideViewerProps = {
  pdfUrl: string;
  title: string;
  initialPageCount?: number;
};

export function PdfSlideViewer({ pdfUrl, title, initialPageCount = 0 }: PdfSlideViewerProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(initialPageCount);
  const [status, setStatus] = useState("Đang tải PDF...");
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [renderTick, setRenderTick] = useState(0);
  const downloadUrl = getPdfDownloadUrl(pdfUrl);
  const pdfFileName = getPdfFileName(pdfUrl) ?? "download.pdf";

  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setStatus("Đang tải PDF...");
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
      const loaded = await pdfjs.getDocument({ url: pdfUrl }).promise;
      if (cancelled) return;
      setPdf(loaded);
      setPageCount(loaded.numPages);
      setPage(1);
      setStatus("");
    }

    void loadPdf().catch(() => {
      if (!cancelled) setStatus("Không thể tải PDF.");
    });

    return () => {
      cancelled = true;
    };
  }, [pdfUrl]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      window.setTimeout(() => setRenderTick((value) => value + 1), 80);
    };
    const onResize = () => setRenderTick((value) => value + 1);

    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;
    let cancelled = false;

    async function renderPage() {
      setStatus("Đang render trang...");
      const activePdf = pdf;
      const pdfPage = await activePdf.getPage(page);
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;

      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const shellWidth = isFullscreen ? window.innerWidth : Math.min(window.innerWidth - 44, 430 - 44);
      const shellHeight = isFullscreen ? window.innerHeight - 32 : window.innerHeight * 0.72;
      const displayScale = Math.min(shellWidth / baseViewport.width, shellHeight / baseViewport.height, 2.2);
      const displayWidth = Math.max(1, Math.floor(baseViewport.width * displayScale));
      const displayHeight = Math.max(1, Math.floor(baseViewport.height * displayScale));
      const qualityScale = Math.min(Math.max(window.devicePixelRatio || 1, 2.75), isFullscreen ? 3.25 : 3.5);
      const viewport = pdfPage.getViewport({ scale: displayScale * qualityScale });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      const context = canvas.getContext("2d");
      if (!context) throw new Error("Trình duyệt không hỗ trợ Canvas.");
      context.clearRect(0, 0, canvas.width, canvas.height);
      await pdfPage.render({ canvasContext: context, canvas, viewport }).promise;
      if (!cancelled) setStatus("");
    }

    void renderPage().catch(() => {
      if (!cancelled) setStatus("Không thể render trang PDF.");
    });

    return () => {
      cancelled = true;
    };
  }, [pdf, page, isFullscreen, renderTick]);

  const prevPage = () => setPage((current) => Math.max(1, current - 1));
  const nextPage = () => setPage((current) => Math.min(pageCount || current, current + 1));

  const openFullscreen = async () => {
    const wrap = wrapRef.current;
    if (wrap?.requestFullscreen) await wrap.requestFullscreen();
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="pdfSlideViewer">
      <div className="slideMeta">
        <strong>{title}</strong>
        <span>Trang {page} / {pageCount || "..."}</span>
      </div>

      <div
        ref={wrapRef}
        className="slideCanvasWrap"
        onTouchStart={(event) => {
          event.currentTarget.dataset.startX = String(event.touches[0]?.clientX ?? 0);
        }}
        onTouchEnd={(event) => {
          const startX = Number(event.currentTarget.dataset.startX ?? 0);
          const endX = event.changedTouches[0]?.clientX ?? startX;
          const delta = endX - startX;
          if (Math.abs(delta) < 42) return;
          if (delta > 0) prevPage();
          else nextPage();
        }}
      >
        <canvas ref={canvasRef} className="pdfSlideCanvas" onClick={openFullscreen} />
        {status ? <div className="slideStatus">{status}</div> : null}
      </div>

      <div className="slideControls">
        <button className="secondaryButton compactButton" type="button" onClick={prevPage} disabled={page <= 1}>
          Trước
        </button>
        <button className="secondaryButton compactButton" type="button" onClick={nextPage} disabled={!pageCount || page >= pageCount}>
          Sau
        </button>
      </div>

      <div className="slideActions">
        <a className="downloadButton compactButton" href={downloadUrl} download={pdfFileName}>
          Tải PDF gốc
        </a>
        <button className="secondaryButton compactButton" type="button" onClick={copyLink}>
          {copied ? "Đã copy" : "Copy link"}
        </button>
        <button className="secondaryButton compactButton" type="button" onClick={openFullscreen}>
          Toàn màn hình
        </button>
      </div>
    </section>
  );
}

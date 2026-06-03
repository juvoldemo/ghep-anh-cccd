import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalShell } from "@/components/PortalShell";
import { PdfSlideViewer } from "@/components/PdfSlideViewer";
import { getGuides } from "@/lib/content";

type GuideDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function GuideDetailPage({ params }: GuideDetailProps) {
  const { id } = await params;
  const guides = await getGuides();
  const guide = guides.find((item) => item.id === id && item.isActive !== false);

  if (!guide) notFound();

  return (
    <PortalShell title="Hướng dẫn" showBack>
      <section className="guideDetailHeader">
        <h2 className="sectionTitle">{guide.title || "Hướng dẫn chưa có tiêu đề"}</h2>
        {guide.description || guide.summary ? <p className="summary">{guide.description || guide.summary}</p> : null}
        <Link className="guideBackLink" href="/guides">
          Quay lại danh sách hướng dẫn
        </Link>
      </section>

      {guide.pdfUrl ? (
        <PdfSlideViewer pdfUrl={guide.pdfUrl} title={guide.title || "Hướng dẫn"} initialPageCount={guide.pageCount} />
      ) : (
        <div className="stack">
          {(guide.steps ?? []).map((step, index) => (
            <article className="guideStep" key={`${step}-${index}`}>
              <span className="stepNumber">{index + 1}</span>
              <div>
                <strong>Bước {index + 1}: {step}</strong>
                <p>{guide.checklist?.[index]}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </PortalShell>
  );
}

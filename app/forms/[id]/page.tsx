import { notFound } from "next/navigation";
import { PortalShell } from "@/components/PortalShell";
import { getForms } from "@/lib/content";

type FormDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function FormDetailPage({ params }: FormDetailProps) {
  const { id } = await params;
  const data = await getForms();
  const item = data.folders.flatMap((folder) => folder.items).find((form) => form.id === id);

  if (!item) notFound();

  const zaloUrl = `https://zalo.me/share?u=${encodeURIComponent(item.file)}`;

  return (
    <PortalShell title="Xem mẫu biểu" showBack>
      <section className="pdfViewer">
        <p className="pdfMeta">
          <span className="listText">
            <strong>{item.title}</strong>
            <small>{item.size ?? "512 KB"}</small>
          </span>
        </p>
        <div className="pdfToolbar" aria-hidden="true">
          <span>1 / 3</span>
          <span />
          <span className="toolbarButton">-</span>
          <span className="toolbarButton">⌕</span>
          <span className="toolbarButton">↻</span>
          <span className="toolbarButton">▱</span>
        </div>
        <iframe className="pdfPreview" src={item.file} title={item.title} />
        <div className="actionRow">
          <a className="secondaryButton" href={zaloUrl} target="_blank" rel="noreferrer">
            Chia sẻ qua Zalo
          </a>
          <a className="downloadButton" href={item.file} download>
            Tải về
          </a>
        </div>
      </section>
    </PortalShell>
  );
}

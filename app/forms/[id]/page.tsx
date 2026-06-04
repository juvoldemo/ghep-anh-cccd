import { notFound } from "next/navigation";
import { FormPdfViewer } from "@/components/FormPdfViewer";
import { PortalShell } from "@/components/PortalShell";
import { getForms } from "@/lib/content";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type FormDetailProps = {
  params: Promise<{ id: string }>;
};

export default async function FormDetailPage({ params }: FormDetailProps) {
  const { id } = await params;
  const data = await getForms();
  const item = data.folders.flatMap((folder) => folder.items).find((form) => form.id === id);

  if (!item) notFound();

  return (
    <PortalShell title="Xem mẫu biểu" showBack>
      <section className="pdfViewer">
        <p className="pdfMeta">
          <span className="listText">
            <strong>{item.title}</strong>
            <small>{item.size ?? "512 KB"}</small>
          </span>
        </p>
        <FormPdfViewer pdfUrl={item.file} title={item.title} />
      </section>
    </PortalShell>
  );
}

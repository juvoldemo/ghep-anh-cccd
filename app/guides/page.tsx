import Link from "next/link";
import { PortalShell } from "@/components/PortalShell";
import { getGuides } from "@/lib/content";

export default async function GuidesPage() {
  const guides = (await getGuides())
    .filter((guide) => guide.isActive !== false)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

  return (
    <PortalShell title="Hướng dẫn" showBack>
      <h2 className="sectionTitle">Danh sách hướng dẫn</h2>
      <div className="stack">
        {guides.map((guide) => (
          <Link className="listItem" href={`/guides/${guide.id}`} key={guide.id}>
            <span className="featureIcon bookGlyph" />
            <span className="listText">
              <strong>{guide.title || "Hướng dẫn chưa có tiêu đề"}</strong>
              <small>
                {guide.category}
                {guide.pageCount ? ` • ${guide.pageCount} trang` : ""}
              </small>
              {guide.description || guide.summary ? <small>{guide.description || guide.summary}</small> : null}
            </span>
          </Link>
        ))}
      </div>
    </PortalShell>
  );
}

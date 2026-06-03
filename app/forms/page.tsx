import Link from "next/link";
import { PortalShell } from "@/components/PortalShell";
import { getForms } from "@/lib/content";

type FormsPageProps = {
  searchParams?: Promise<{ folder?: string }>;
};

export default async function FormsPage({ searchParams }: FormsPageProps) {
  const data = await getForms();
  const params = await searchParams;
  const activeFolder = params?.folder ? data.folders.find((folder) => folder.id === params.folder) : null;

  return (
    <PortalShell title="Mẫu biểu" showBack>
      {activeFolder ? (
        <>
          <Link className="subHeader" href="/forms">
            {activeFolder.title}
          </Link>
          <div className="stack">
            {activeFolder.items.map((item) => (
              <Link className="listItem fileRow" href={`/forms/${item.id}`} key={item.id}>
                <span className="fileBadge">PDF</span>
                <span className="listText">
                  <strong>{item.title}</strong>
                  <small>{item.size ?? "512 KB"}</small>
                </span>
                <span className="downloadGlyph" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </>
      ) : (
        <>
          <h2 className="sectionTitle">Chọn danh mục</h2>
          <div className="stack">
            {data.folders.map((folder) => (
              <Link className="listItem" href={`/forms?folder=${folder.id}`} key={folder.id}>
                <span className="featureIcon folderGlyph" />
                <span className="listText">
                  <strong>{folder.title}</strong>
                  <small>{folder.items.length} mẫu biểu</small>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </PortalShell>
  );
}

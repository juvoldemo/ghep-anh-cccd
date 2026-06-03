import Link from "next/link";
import type { ReactNode } from "react";

type PortalShellProps = {
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  showBack?: boolean;
};

const logoSub = "BẢO VIỆT NHÂN THỌ";
const defaultEyebrow = "CÙNG HỖ TRỢ NGHIỆP VỤ";

function BaoVietLogo() {
  return (
    <span className="bvLogo" aria-label="BAOVIET Life">
      <span className="bvLogoMain">BAOVIET</span>
      <span className="bvLogoOrb" aria-hidden="true" />
      <span className="bvLogoLife">Life</span>
      <span className="bvLogoSub">{logoSub}</span>
    </span>
  );
}

export function PortalShell({ title, eyebrow = defaultEyebrow, children, showBack }: PortalShellProps) {
  return (
    <main className="page">
      <div className="phoneShell">
        <header className={title ? "bvHeader compactHeader" : "bvHeader homeHeader"}>
          {title ? (
            <>
              <Link className="headerIcon backIcon" href="/" aria-label={showBack ? "Trang chủ" : "Trang trước"} />
              <h1 className="headerTitle">{title}</h1>
              <span className="headerSpacer" aria-hidden="true" />
            </>
          ) : (
            <>
              <Link className="brandLink" href="/">
                <BaoVietLogo />
              </Link>
              <p className="headerEyebrow">{eyebrow}</p>
              <span className="headerIcon bellIcon" aria-hidden="true" />
            </>
          )}
        </header>
        <div className="shellContent">{children}</div>
        <footer className="bvFooter">
          <BaoVietLogo />
        </footer>
      </div>
    </main>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="emptyState">{children}</div>;
}

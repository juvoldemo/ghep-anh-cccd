"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type PortalShellProps = {
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  showBack?: boolean;
};

type ShellSettings = {
  bannerImage?: string;
  bottomImage?: string;
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
  const [settings, setSettings] = useState<ShellSettings>({});

  useEffect(() => {
    fetch("/api/content?key=settings")
      .then((response) => response.json())
      .then((data: ShellSettings) => setSettings(data))
      .catch(() => undefined);
  }, []);

  const bannerStyle = settings.bannerImage ? { backgroundImage: `url("${settings.bannerImage}")` } : undefined;
  const bottomStyle = settings.bottomImage ? { backgroundImage: `url("${settings.bottomImage}")` } : undefined;

  return (
    <main className="page">
      <div className="phoneShell">
        <header className={title ? "bvHeader compactHeader customMediaBand" : "bvHeader homeHeader customMediaBand"} style={bannerStyle}>
          {title ? (
            <>
              <Link className="headerIcon backIcon" href="/" aria-label={showBack ? "Trang chủ" : "Trang trước"} />
              <h1 className="headerTitle">{title}</h1>
              <span className="headerSpacer" aria-hidden="true" />
            </>
          ) : (
            <span className="mediaPlaceholder" aria-hidden="true" />
          )}
        </header>
        <div className="shellContent">{children}</div>
        <footer className="bvFooter customMediaBand" style={bottomStyle}>
          <span className="mediaPlaceholder" aria-hidden="true" />
        </footer>
      </div>
    </main>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="emptyState">{children}</div>;
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

type PortalShellProps = {
  title?: string;
  children: ReactNode;
  showBack?: boolean;
};

type ShellSettings = {
  bannerImage?: string;
  bottomImage?: string;
};

export function PortalShell({ title, children, showBack }: PortalShellProps) {
  const [settings, setSettings] = useState<ShellSettings>({});
  const isHome = !title;

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
        <header className={isHome ? "bvHeader homeHeader customMediaBand" : "bvHeader compactHeader"} style={isHome ? bannerStyle : undefined}>
          {!isHome ? (
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
        {isHome ? (
          <footer className="bvFooter customMediaBand" style={bottomStyle}>
            <span className="mediaPlaceholder" aria-hidden="true" />
          </footer>
        ) : null}
      </div>
    </main>
  );
}

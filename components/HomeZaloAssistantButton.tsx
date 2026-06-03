"use client";

import { useState } from "react";

const ZALO_ASSISTANT_URL = "https://zalo.me/0877590890";

export function HomeZaloAssistantButton() {
  const [isRedirecting, setIsRedirecting] = useState(false);

  const showRedirectNotice = () => {
    setIsRedirecting(true);
    window.setTimeout(() => setIsRedirecting(false), 2200);
  };

  return (
    <div className="homeZaloAssistant">
      <a
        className="homeZaloAssistantLink"
        href={ZALO_ASSISTANT_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Chat với Trợ lý AI"
        aria-label="Chat với Trợ lý AI qua Zalo"
        data-tooltip="Chat với Trợ lý AI"
        onClick={showRedirectNotice}
      >
        <img className="homeLeadIcon" src="/icons/home-globe-transparent.png" alt="" aria-hidden="true" />
      </a>
      {isRedirecting ? <span className="zaloRedirectNotice">Đang chuyển đến Zalo...</span> : null}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import type { FaqItem } from "@/lib/content";

function renderAnswer(answer: string) {
  return <p className="accordionPanel">{answer}</p>;
}

export default function FaqPage() {
  const [items, setItems] = useState<FaqItem[]>([]);
  const [openId, setOpenId] = useState<string | null>("sai-ngay-sinh");

  useEffect(() => {
    fetch("/api/content?key=faq")
      .then((response) => response.json())
      .then((data) => setItems(data))
      .catch(() => setItems([]));
  }, []);

  return (
    <PortalShell title="Câu hỏi thường gặp" showBack>
      <div className="accordion">
        {items.map((item) => {
          const isOpen = item.id === openId;
          return (
            <section className="accordionItem" key={item.id}>
              <button className="accordionButton" type="button" onClick={() => setOpenId(isOpen ? null : item.id)}>
                <span>{item.question}</span>
                <span>{isOpen ? "⌃" : "⌄"}</span>
              </button>
              {isOpen ? renderAnswer(item.answer) : null}
            </section>
          );
        })}
      </div>
    </PortalShell>
  );
}

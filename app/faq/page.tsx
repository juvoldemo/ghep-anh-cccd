"use client";

import { useEffect, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import type { FaqItem } from "@/lib/content";

function renderAnswer(answer: string) {
  const [intro, ...bullets] = answer.split("\n").filter(Boolean);

  if (!bullets.length) return <p className="accordionPanel">{answer}</p>;

  return (
    <div className="accordionPanel">
      {intro}
      <ul>
        {bullets.map((line) => (
          <li key={line}>{line.replace(/^- /, "")}</li>
        ))}
      </ul>
    </div>
  );
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

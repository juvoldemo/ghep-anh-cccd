import Link from "next/link";
import { PortalShell } from "@/components/PortalShell";

const features = [
  {
    href: "/forms",
    iconClass: "folderGlyph",
    title: "1. Mẫu biểu",
    text: "Kho mẫu biểu nghiệp vụ"
  },
  {
    href: "/merge-id",
    iconClass: "idGlyph",
    tone: "gold",
    title: "2. Ghép ảnh giấy tờ",
    text: "Ghép ảnh giấy tờ tùy thân"
  },
  {
    href: "/guides",
    iconClass: "bookGlyph",
    title: "3. Hướng dẫn",
    text: "Hướng dẫn nghiệp vụ"
  },
  {
    href: "/faq",
    iconClass: "faqGlyph",
    title: "4. Câu hỏi thường gặp",
    text: "Giải đáp các thắc mắc"
  },
  {
    href: "/admin",
    iconClass: "gearGlyph",
    tone: "muted",
    title: "Admin",
    text: "Quản trị hệ thống"
  }
];

export default function HomePage() {
  return (
    <PortalShell>
      <section className="homeLead">
        <h1 className="title">Chọn chức năng</h1>
      </section>

      <nav className="featureGrid compact" aria-label="Chức năng chính">
        {features.map((feature) => (
          <Link className="featureCard" href={feature.href} key={feature.href}>
            <span className={`featureIcon ${feature.iconClass} ${feature.tone ?? ""}`} />
            <span className="featureText">
              <strong>{feature.title}</strong>
              <span>{feature.text}</span>
            </span>
          </Link>
        ))}
      </nav>
    </PortalShell>
  );
}

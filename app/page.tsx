import Link from "next/link";
import { PortalShell } from "@/components/PortalShell";

const features = [
  {
    href: "/forms",
    iconSrc: "/icons/mau-bieu.png",
    title: "Mẫu biểu",
    text: "Kho mẫu biểu nghiệp vụ"
  },
  {
    href: "/merge-id",
    iconSrc: "/icons/ghep-anh-giay-to.png",
    title: "Ghép ảnh giấy tờ",
    text: "Ghép ảnh giấy tờ tùy thân"
  },
  {
    href: "/guides",
    iconSrc: "/icons/huong-dan.png",
    title: "Hướng dẫn",
    text: "Hướng dẫn nghiệp vụ"
  },
  {
    href: "/faq",
    iconSrc: "/icons/faq.png",
    title: "Câu hỏi thường gặp",
    text: "Giải đáp các thắc mắc"
  },
  {
    href: "/admin",
    iconSrc: "/icons/admin.png",
    title: "Admin",
    text: "Quản trị hệ thống"
  }
];

export default function HomePage() {
  return (
    <PortalShell>
      <section className="homeLead">
        <img className="homeLeadIcon" src="/icons/home-globe.png" alt="" aria-hidden="true" />
      </section>

      <nav className="featureGrid compact" aria-label="Chức năng chính">
        {features.map((feature) => (
          <Link className="featureCard" href={feature.href} key={feature.href}>
            <span className="featureIcon">
              <img src={feature.iconSrc} alt="" />
            </span>
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

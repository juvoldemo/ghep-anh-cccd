"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { PortalShell } from "@/components/PortalShell";
import type { FaqItem, FormFolder, FormItem, FormsData, Guide, MergeSettings } from "@/lib/content";
import { extractYouTubeId } from "@/lib/youtube";

type AdminSection = "dashboard" | "forms" | "guides" | "faq" | "settings" | "mybvlife";
type ContentKey = Exclude<AdminSection, "dashboard" | "mybvlife">;

const emptyForms: FormsData = { folders: [] };
const emptySettings: MergeSettings = { mergeNote: "", defaultFormat: "jpeg" };

const adminItems: Array<{ section: Exclude<AdminSection, "dashboard">; icon: string; title: string; desc: string }> = [
  { section: "forms", icon: "folderGlyph", title: "1. Quản lý mẫu biểu", desc: "Thêm, sửa, xóa mẫu biểu PDF" },
  { section: "guides", icon: "bookGlyph", title: "2. Quản lý hướng dẫn", desc: "Nhập tiêu đề và upload PDF" },
  { section: "faq", icon: "faqGlyph", title: "3. Quản lý FAQ", desc: "Quản lý câu hỏi thường gặp" },
  { section: "settings", icon: "gearGlyph muted", title: "4. Cài đặt hệ thống", desc: "Cấu hình chung, ghép ảnh" },
  { section: "mybvlife", icon: "idGlyph", title: "5. Khôi phục MyBVLife", desc: "Cấu hình, rate limit và log đã che số CCCD" }
];

function makeId(value: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || `item-${Date.now()}`
  );
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function newFormItem(): FormItem {
  return { id: `mau-${Date.now()}`, title: "Mẫu mới.pdf", file: "/pdfs/mau-moi.pdf", size: "512 KB" };
}

function newGuide(order: number): Guide {
  return {
    id: `huong-dan-${Date.now()}`,
    category: "Hướng dẫn",
    title: "",
    description: "",
    summary: "",
    type: "pdf",
    pdfUrl: "",
    pageCount: 0,
    youtubeUrl: "",
    youtubeId: "",
    isActive: true,
    order,
    createdAt: today()
  };
}

async function getPdfPageCount(fileUrl: string) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ url: fileUrl }).promise;
  return pdf.numPages;
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [adminPass, setAdminPass] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [section, setSection] = useState<AdminSection>("dashboard");
  const [forms, setForms] = useState<FormsData>(emptyForms);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [faq, setFaq] = useState<FaqItem[]>([]);
  const [settings, setSettings] = useState<MergeSettings>(emptySettings);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const jsonHeaders = useMemo(() => ({ "Content-Type": "application/json", "x-admin-pass": adminPass }), [adminPass]);

  const loadContent = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [nextForms, nextGuides, nextFaq, nextSettings] = await Promise.all([
        fetch("/api/content?key=forms").then((response) => response.json()),
        fetch("/api/content?key=guides").then((response) => response.json()),
        fetch("/api/content?key=faq").then((response) => response.json()),
        fetch("/api/content?key=settings").then((response) => response.json())
      ]);
      setForms(nextForms);
      setGuides(nextGuides);
      setFaq(nextFaq);
      setSettings(nextSettings);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedPass = localStorage.getItem("adminPass");
      if (savedPass) {
        setAdminPass(savedPass);
        setLoggedIn(true);
      }
    }
  }, []);

  useEffect(() => {
    if (loggedIn) void loadContent();
  }, [loggedIn]);

  const login = async () => {
    setMessage("");
    const response = await fetch("/api/content", { method: "POST", headers: { "x-admin-pass": password } });
    if (!response.ok) {
      setMessage("Mật khẩu không đúng.");
      return;
    }
    localStorage.setItem("adminPass", password);
    setAdminPass(password);
    setLoggedIn(true);
    setPassword("");
  };

  const logout = () => {
    localStorage.removeItem("adminPass");
    setLoggedIn(false);
    setAdminPass("");
    setSection("dashboard");
    setMessage("");
  };

  const save = async (key: ContentKey) => {
    if (!adminPass) {
      setMessage("Vui lòng đăng nhập lại để lưu thay đổi.");
      return;
    }
    if (key === "guides") {
      const invalidYoutubeGuide = guides.find((guide) => guide.type === "youtube" && (!guide.youtubeUrl || !extractYouTubeId(guide.youtubeUrl)));
      if (invalidYoutubeGuide) {
        setMessage(`Link YouTube không hợp lệ: ${invalidYoutubeGuide.title || "Hướng dẫn chưa có tiêu đề"}`);
        return;
      }
    }
    const value = key === "forms" ? forms : key === "guides" ? guides : key === "faq" ? faq : settings;
    const response = await fetch(`/api/content?key=${key}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(value)
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(result?.error || "Khong the luu. Vui long kiem tra cau hinh luu tru tren Vercel.");
      return;
    }
    setMessage(response.ok ? "Đã lưu thay đổi." : "Không thể lưu. Vui lòng kiểm tra mật khẩu admin.");
  };

  if (!loggedIn) {
    return (
      <PortalShell title="Admin" showBack>
        <section className="adminLogin">
          <h2 className="sectionTitle">Đăng nhập quản trị</h2>
          <label className="field">
            Mật khẩu
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void login()}
              placeholder="Nhập mật khẩu admin"
            />
          </label>
          <button className="primaryButton" type="button" onClick={login}>
            Đăng nhập
          </button>
          {message ? <div className="error">{message}</div> : null}
        </section>
      </PortalShell>
    );
  }

  return (
    <PortalShell title={section === "dashboard" ? "Admin" : "Quản trị"} showBack>
      <section className="adminProfile">
        <span className="avatar" aria-hidden="true" />
        <span className="adminText">
          <strong>Nguyễn Văn A</strong>
          <span>Quản trị viên</span>
        </span>
        <button className="secondaryButton" type="button" onClick={logout}>
          Đăng xuất
        </button>
      </section>

      {section !== "dashboard" ? (
        <button className="adminBackButton" type="button" onClick={() => setSection("dashboard")}>
          Quay lại quản lý nội dung
        </button>
      ) : null}

      {loading ? <div className="fileStatus">Đang tải nội dung...</div> : null}

      {section === "dashboard" ? (
        <>
          <h2 className="adminSectionTitle">Quản lý nội dung</h2>
          <div className="stack">
            {adminItems.map((item) => (
              <button className="listItem" type="button" key={item.section} onClick={() => setSection(item.section)}>
                <span className={`adminIcon ${item.icon}`} />
                <span className="listText">
                  <strong>{item.title}</strong>
                  <small>{item.desc}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {section === "forms" ? <FormsEditor forms={forms} setForms={setForms} adminPass={adminPass} /> : null}
      {section === "guides" ? <GuidesEditor guides={guides} setGuides={setGuides} adminPass={adminPass} /> : null}
      {section === "faq" ? <FaqEditor faq={faq} setFaq={setFaq} /> : null}
      {section === "settings" ? <SettingsEditor settings={settings} setSettings={setSettings} adminPass={adminPass} /> : null}
      {section === "mybvlife" ? <MyBVLifeAdminEditor /> : null}

      {section !== "dashboard" && section !== "mybvlife" ? (
        <button className="primaryButton stickySave" type="button" onClick={() => save(section)}>
          Lưu thay đổi
        </button>
      ) : null}
      {message && section !== "dashboard" ? <div className="success">{message}</div> : null}
    </PortalShell>
  );
}

function FormsEditor({ forms, setForms, adminPass }: { forms: FormsData; setForms: (value: FormsData) => void; adminPass: string }) {
  const [uploadingId, setUploadingId] = useState("");

  const updateFolder = (folderIndex: number, folder: FormFolder) => {
    setForms({ folders: forms.folders.map((item, index) => (index === folderIndex ? folder : item)) });
  };

  const updateFolderTitle = (folderIndex: number, title: string) => {
    const folder = forms.folders[folderIndex];
    updateFolder(folderIndex, { ...folder, title, id: makeId(title) });
  };

  const uploadPdf = async (folderIndex: number, itemIndex: number, file?: File | null) => {
    if (!file) return;
    const item = forms.folders[folderIndex].items[itemIndex];
    setUploadingId(item.id);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/forms/upload", {
        method: "POST",
        headers: { "x-admin-pass": adminPass },
        body: formData
      });
      const result = (await response.json()) as { file?: string; size?: string };
      if (!response.ok || !result.file) throw new Error("Không thể upload PDF.");

      const folder = forms.folders[folderIndex];
      const newItems = folder.items.map((entry, index) => {
        if (index === itemIndex) {
          return {
            ...entry,
            title: file.name.endsWith(".pdf") ? file.name : `${file.name}.pdf`,
            file: result.file!,
            size: result.size || "512 KB"
          };
        }
        return entry;
      });
      updateFolder(folderIndex, { ...folder, items: newItems });
    } finally {
      setUploadingId("");
    }
  };

  return (
    <section className="adminEditor">
      <h2 className="sectionTitle">Quản lý mẫu biểu</h2>
      <button className="secondaryButton compactButton" type="button" onClick={() => setForms({ folders: [...forms.folders, { id: "phat-hanh-hop-dong", title: "Phát hành hợp đồng", items: [newFormItem()] }] })}>
        Thêm danh mục
      </button>
      {forms.folders.map((folder, folderIndex) => (
        <div className="editorGroup" key={folder.id}>
          <label className="field">
            Tên danh mục
            <select
              value={folder.title}
              onChange={(event) => updateFolderTitle(folderIndex, event.target.value)}
            >
              <option value="">Chọn danh mục</option>
              <option value="Phát hành hợp đồng">Phát hành hợp đồng</option>
              <option value="Quản lý hợp đồng">Quản lý hợp đồng</option>
              <option value="Bổ sung sức khỏe">Bổ sung sức khỏe</option>
            </select>
          </label>
          {folder.items.map((item, itemIndex) => (
            <div className="editorMiniCard" key={item.id}>
              <input value={item.title} onChange={(event) => updateFolder(folderIndex, { ...folder, items: folder.items.map((entry, index) => (index === itemIndex ? { ...entry, title: event.target.value, id: makeId(event.target.value) } : entry)) })} placeholder="Tên file" />
              <label className="secondaryButton compactButton uploadPdfButton">
                {uploadingId === item.id ? "Đang upload..." : item.file ? "Upload lại PDF" : "Upload PDF"}
                <input className="fileInput" type="file" accept="application/pdf,.pdf" onChange={(event: ChangeEvent<HTMLInputElement>) => uploadPdf(folderIndex, itemIndex, event.target.files?.[0])} />
              </label>
              {item.file ? (
                <>
                  <div className="fileStatus">Đã upload: {item.size || "512 KB"}</div>
                  <input value={item.file} onChange={(event) => updateFolder(folderIndex, { ...folder, items: folder.items.map((entry, index) => (index === itemIndex ? { ...entry, file: event.target.value } : entry)) })} placeholder="/pdfs/mau.pdf" />
                </>
              ) : (
                <>
                  <div className="fileStatus">Chưa có PDF</div>
                  <input value={item.file} onChange={(event) => updateFolder(folderIndex, { ...folder, items: folder.items.map((entry, index) => (index === itemIndex ? { ...entry, file: event.target.value } : entry)) })} placeholder="/pdfs/mau.pdf" />
                </>
              )}
              <button className="secondaryButton compactButton" type="button" onClick={() => updateFolder(folderIndex, { ...folder, items: folder.items.filter((_, index) => index !== itemIndex) })}>
                Xóa mẫu
              </button>
            </div>
          ))}
          <div className="adminActionRow">
            <button className="secondaryButton compactButton" type="button" onClick={() => updateFolder(folderIndex, { ...folder, items: [...folder.items, newFormItem()] })}>
              Thêm mẫu
            </button>
            <button className="secondaryButton compactButton" type="button" onClick={() => setForms({ folders: forms.folders.filter((_, index) => index !== folderIndex) })}>
              Xóa danh mục
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

function GuidesEditor({ guides, setGuides, adminPass }: { guides: Guide[]; setGuides: (value: Guide[]) => void; adminPass: string }) {
  const [uploadingId, setUploadingId] = useState("");
  const [collapsedGuides, setCollapsedGuides] = useState<Record<string, boolean>>({});

  const updateGuide = (index: number, guide: Guide) => {
    setGuides(guides.map((item, i) => (i === index ? guide : item)));
  };

  const setGuideType = (index: number, guide: Guide, type: "pdf" | "youtube") => {
    updateGuide(index, {
      ...guide,
      type,
      pdfUrl: type === "pdf" ? guide.pdfUrl : "",
      pageCount: type === "pdf" ? guide.pageCount : 0,
      youtubeUrl: type === "youtube" ? guide.youtubeUrl : "",
      youtubeId: type === "youtube" ? guide.youtubeId : ""
    });
  };

  const updateYoutubeUrl = (index: number, guide: Guide, youtubeUrl: string) => {
    const youtubeId = extractYouTubeId(youtubeUrl);
    updateGuide(index, {
      ...guide,
      type: "youtube",
      youtubeUrl,
      youtubeId: youtubeId ?? "",
      pdfUrl: "",
      pageCount: 0
    });
  };

  const uploadPdf = async (index: number, file?: File | null) => {
    if (!file) return;
    const guide = guides[index];
    setUploadingId(guide.id);
    try {
      const localUrl = URL.createObjectURL(file);
      const pageCount = await getPdfPageCount(localUrl);
      URL.revokeObjectURL(localUrl);

      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/guides/upload", {
        method: "POST",
        headers: { "x-admin-pass": adminPass },
        body: formData
      });
      const result = (await response.json()) as { pdfUrl?: string };
      if (!response.ok || !result.pdfUrl) throw new Error("Khong the upload PDF.");

      updateGuide(index, {
        ...guide,
        title: guide.title || file.name.replace(/\.pdf$/i, ""),
        category: guide.category || "Huong dan",
        type: "pdf",
        pdfUrl: result.pdfUrl,
        pageCount,
        youtubeUrl: "",
        youtubeId: "",
        isActive: guide.isActive !== false,
        order: guide.order ?? index + 1,
        createdAt: guide.createdAt || today()
      });
    } finally {
      setUploadingId("");
    }
  };

  return (
    <section className="adminEditor">
      <h2 className="sectionTitle">Quan ly huong dan</h2>
      <button className="secondaryButton compactButton" type="button" onClick={() => setGuides([...guides, newGuide((guides.length || 0) + 1)])}>
        Them huong dan
      </button>

      {guides
        .slice()
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
        .map((guide) => {
          const index = guides.findIndex((item) => item.id === guide.id);
          const guideType = guide.type ?? (guide.youtubeId ? "youtube" : "pdf");
          const isActive = guide.isActive !== false;
          const isCollapsed = collapsedGuides[guide.id] ?? false;
          const guideMeta = `${guideType === "youtube" ? "YouTube" : `${guide.pageCount || 0} trang`}${isActive ? "" : " · Dang an"}`;
          const youtubeInvalid = guideType === "youtube" && Boolean(guide.youtubeUrl) && !guide.youtubeId;
          const canPreview = guideType === "youtube" ? Boolean(guide.youtubeId) : Boolean(guide.pdfUrl);

          return (
            <div className="editorGroup guideSimpleEditor" key={guide.id}>
              <div className="guideAdminHeader">
                <strong>{guide.title || "Huong dan moi"}</strong>
                <span>{guideMeta}</span>
              </div>

              {!isCollapsed ? (
                <>
                  <label className="field compactField">
                    Danh muc
                    <input value={guide.category} onChange={(event) => updateGuide(index, { ...guide, category: event.target.value })} placeholder="Huong dan" />
                  </label>

                  <label className="field compactField">
                    Tieu de
                    <input value={guide.title} onChange={(event) => updateGuide(index, { ...guide, title: event.target.value, order: guide.order ?? index + 1 })} placeholder="Tieu de bai huong dan" />
                  </label>

                  <label className="field compactField">
                    Mo ta ngan
                    <textarea value={guide.description || guide.summary || ""} onChange={(event) => updateGuide(index, { ...guide, description: event.target.value, summary: event.target.value })} placeholder="Mo ta ngan" />
                  </label>

                  <label className="field compactField">
                    Loai huong dan
                    <select value={guideType} onChange={(event) => setGuideType(index, guide, event.target.value as "pdf" | "youtube")}>
                      <option value="pdf">PDF</option>
                      <option value="youtube">Video YouTube</option>
                    </select>
                  </label>

                  <div className="miniGrid guideStatusGrid">
                    <label className="field compactField">
                      Trang thai
                      <select value={isActive ? "active" : "hidden"} onChange={(event) => updateGuide(index, { ...guide, isActive: event.target.value === "active" })}>
                        <option value="active">Hien thi</option>
                        <option value="hidden">An</option>
                      </select>
                    </label>
                    <label className="field compactField">
                      Thu tu
                      <input type="number" min="1" value={guide.order ?? index + 1} onChange={(event) => updateGuide(index, { ...guide, order: Number(event.target.value) || index + 1 })} />
                    </label>
                  </div>

                  {guideType === "pdf" ? (
                    <>
                      <label className="secondaryButton compactButton uploadPdfButton">
                        {uploadingId === guide.id ? "Dang upload..." : guide.pdfUrl ? "Upload lai PDF" : "Upload PDF"}
                        <input className="fileInput" type="file" accept="application/pdf,.pdf" onChange={(event: ChangeEvent<HTMLInputElement>) => uploadPdf(index, event.target.files?.[0])} />
                      </label>
                      {guide.pdfUrl ? <div className="fileStatus">Da upload PDF: {guide.pageCount || 0} trang</div> : <div className="fileStatus">Chua co PDF</div>}
                    </>
                  ) : (
                    <>
                      <label className="field compactField">
                        Link YouTube
                        <input value={guide.youtubeUrl || ""} onChange={(event) => updateYoutubeUrl(index, guide, event.target.value)} placeholder="https://www.youtube.com/watch?v=VIDEO_ID" />
                      </label>
                      {youtubeInvalid ? <div className="error">Link YouTube khong hop le. Ho tro watch, youtu.be, shorts va embed.</div> : null}
                      {guide.youtubeId ? <div className="fileStatus">YouTube ID: {guide.youtubeId}</div> : null}
                    </>
                  )}
                </>
              ) : null}

              <div className="adminActionRow guideActionRow">
                {canPreview ? (
                  <Link className="secondaryButton compactButton" href={`/guides/${guide.id}`} target="_blank">
                    Xem thu
                  </Link>
                ) : (
                  <span />
                )}
                <button className="secondaryButton compactButton" type="button" onClick={() => setCollapsedGuides((current) => ({ ...current, [guide.id]: !isCollapsed }))}>
                  {isCollapsed ? "Hien chi tiet" : "An chi tiet"}
                </button>
                <button className="secondaryButton compactButton" type="button" onClick={() => setGuides(guides.filter((_, i) => i !== index))}>
                  Xoa
                </button>
              </div>
            </div>
          );
        })}
    </section>
  );
}

function FaqEditor({ faq, setFaq }: { faq: FaqItem[]; setFaq: Dispatch<SetStateAction<FaqItem[]>> }) {
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});

  const addFaq = () => {
    const id = `faq-${Date.now()}`;
    setFaq((current) => [...current, { id, question: "Câu hỏi mới", answer: "" }]);
    setOpenItems((current) => ({ ...current, [id]: true }));
  };

  const toggleFaq = (id: string) => {
    setOpenItems((current) => ({ ...current, [id]: !(current[id] ?? true) }));
  };

  return (
    <section className="adminEditor">
      <h2 className="sectionTitle">Quản lý FAQ</h2>
      <button className="secondaryButton compactButton" type="button" onClick={addFaq}>
        Thêm câu hỏi
      </button>
      {faq.map((item, index) => {
        const isOpen = openItems[item.id] ?? true;
        return (
          <div className="editorGroup faqEditorItem" key={item.id}>
            <div className="faqEditorHeader">
              <input value={item.question} onChange={(event) => setFaq((current) => current.map((entry, i) => (i === index ? { ...entry, question: event.target.value } : entry)))} placeholder="Câu hỏi" />
              <button className="secondaryButton iconButton" type="button" onClick={() => toggleFaq(item.id)} aria-label={isOpen ? "Ẩn câu trả lời" : "Hiện câu trả lời"}>
                {isOpen ? "Ẩn" : "Hiện"}
              </button>
            </div>
            {isOpen ? (
              <>
                <textarea value={item.answer} onChange={(event) => setFaq((current) => current.map((entry, i) => (i === index ? { ...entry, answer: event.target.value } : entry)))} placeholder="Câu trả lời" />
                <button className="secondaryButton compactButton" type="button" onClick={() => setFaq((current) => current.filter((_, i) => i !== index))}>
                  Xóa câu hỏi
                </button>
              </>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function MyBVLifeAdminEditor() {
  return (
    <section className="adminEditor">
      <h2 className="sectionTitle">Khôi phục MyBVLife</h2>
      <div className="editorGroup">
        <strong>Cấu hình mặc định</strong>
        <div className="fileStatus">Trạng thái: bật</div>
        <div className="fileStatus">Giới hạn: 10 request/phút/IP</div>
        <div className="fileStatus">Log: chỉ lưu CCCD dạng che số trong bộ nhớ backend</div>
      </div>
      <div className="warning">
        Phần cấu hình nâng cao đang đặt trong backend/app/mybvlife_recovery/config.py. Backend có endpoint xem/xóa log đã che số:
        /api/mybvlife/admin/logs.
      </div>
    </section>
  );
}

function SettingsEditor({ settings, setSettings, adminPass }: { settings: MergeSettings; setSettings: (value: MergeSettings) => void; adminPass: string }) {
  const [uploadingSlot, setUploadingSlot] = useState("");

  const uploadThemeImage = async (slot: "bannerImage" | "bottomImage", file?: File | null) => {
    if (!file) return;
    setUploadingSlot(slot);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("slot", slot === "bannerImage" ? "banner" : "bottom");

      const response = await fetch("/api/theme/upload", {
        method: "POST",
        headers: { "x-admin-pass": adminPass },
        body: formData
      });
      const result = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "Khong the upload anh.");
      setSettings({ ...settings, [slot]: result.url });
    } finally {
      setUploadingSlot("");
    }
  };
  return (
    <section className="adminEditor">
      <h2 className="sectionTitle">Cài đặt hệ thống</h2>
      <label className="field">
        Ghi chú màn ghép ảnh
        <textarea value={settings.mergeNote} onChange={(event) => setSettings({ ...settings, mergeNote: event.target.value })} />
      </label>
      <div className="editorGroup">
        <strong>Ảnh banner</strong>
        {settings.bannerImage ? <img className="themePreview" src={settings.bannerImage} alt="Ảnh banner hiện tại" /> : <div className="fileStatus">Chưa có ảnh banner</div>}
        <label className="secondaryButton compactButton uploadPdfButton">
          {uploadingSlot === "bannerImage" ? "Đang upload..." : "Upload ảnh banner"}
          <input className="fileInput" type="file" accept="image/*" onChange={(event: ChangeEvent<HTMLInputElement>) => uploadThemeImage("bannerImage", event.target.files?.[0])} />
        </label>
        <input value={settings.bannerImage || ""} onChange={(event) => setSettings({ ...settings, bannerImage: event.target.value })} placeholder="/uploads/theme/banner.jpg" />
        {settings.bannerImage ? (
          <button className="secondaryButton compactButton" type="button" onClick={() => setSettings({ ...settings, bannerImage: "" })}>
            Xóa ảnh banner
          </button>
        ) : null}
      </div>
      <div className="editorGroup">
        <strong>Ảnh bottom</strong>
        {settings.bottomImage ? <img className="themePreview" src={settings.bottomImage} alt="Ảnh bottom hiện tại" /> : <div className="fileStatus">Chưa có ảnh bottom</div>}
        <label className="secondaryButton compactButton uploadPdfButton">
          {uploadingSlot === "bottomImage" ? "Đang upload..." : "Upload ảnh bottom"}
          <input className="fileInput" type="file" accept="image/*" onChange={(event: ChangeEvent<HTMLInputElement>) => uploadThemeImage("bottomImage", event.target.files?.[0])} />
        </label>
        <input value={settings.bottomImage || ""} onChange={(event) => setSettings({ ...settings, bottomImage: event.target.value })} placeholder="/uploads/theme/bottom.jpg" />
        {settings.bottomImage ? (
          <button className="secondaryButton compactButton" type="button" onClick={() => setSettings({ ...settings, bottomImage: "" })}>
            Xóa ảnh bottom
          </button>
        ) : null}
      </div>
      <label className="field">
        Định dạng mặc định
        <select value={settings.defaultFormat} onChange={(event) => setSettings({ ...settings, defaultFormat: event.target.value as "jpeg" | "png" })}>
          <option value="jpeg">JPG</option>
          <option value="png">PNG</option>
        </select>
      </label>
    </section>
  );
}

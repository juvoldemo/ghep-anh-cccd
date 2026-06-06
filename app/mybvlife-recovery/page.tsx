"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { confirmMyBVLifeRecovery, ocrCccd, recoverMyBVLife, type RecoveryResult } from "@/lib/mybvlifeApi";

const maxFileSize = 10 * 1024 * 1024;
const acceptedTypes = ["image/jpeg", "image/png"];
type StepKey = "upload" | "ocr" | "review" | "confirm" | "done";

function stripVietnamese(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function matchNameCase(source: string, replacement: string) {
  if (source === source.toLocaleUpperCase("vi-VN")) return replacement.toLocaleUpperCase("vi-VN");
  if (source.charAt(0) === source.charAt(0).toLocaleUpperCase("vi-VN")) return replacement;
  return replacement.toLocaleLowerCase("vi-VN");
}

function normalizeNameInput(value: string) {
  const words = value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length < 3) return words.join(" ");

  const middleNameMap: Record<string, string> = {
    thi: "Thị",
    van: "Văn",
    huu: "Hữu",
    duc: "Đức",
    dinh: "Đình",
    ngoc: "Ngọc",
    quoc: "Quốc"
  };

  return words
    .map((word, index) => {
      const key = stripVietnamese(word).replace(/[^a-z]/g, "");
      if (index > 0 && index < words.length - 1 && middleNameMap[key]) {
        return matchNameCase(word, middleNameMap[key]);
      }
      return word;
    })
    .join(" ");
}

function looksLikeBadOcrName(value: string) {
  const normalized = stripVietnamese(value);
  const firstWord = normalized.split(/\s+/)[0] || "";
  return (
    ["thi", "van", "huu", "duc", "dinh", "ngoc", "quoc"].includes(firstWord) ||
    ["ngay", "thong tin", "cccd", "cmnd", "gioi tinh", "can cuoc"].some((keyword) => normalized.includes(keyword))
  );
}

function getRecoveryTitle(result: RecoveryResult, stage: "validate" | "confirm" | null) {
  if (stage === "confirm" && result.response_status === 200) return "Đã gửi SMS khôi phục";
  if (stage === "validate" && result.response_status === 220) return "Thông tin phù hợp";
  if (result.response_status === 412) return "Không tìm thấy thông tin phù hợp";
  return "Có lỗi xảy ra";
}

function getRawObj(result: RecoveryResult | null) {
  const raw = result?.raw as { obj?: { userCode?: string; msgSuccess?: string; confirm?: boolean } } | undefined;
  return raw?.obj || null;
}

export default function MyBVLifeRecoveryPage() {
  const [file, setFile] = useState<File | null>(null);
  const [fullName, setFullName] = useState("");
  const [identityNo, setIdentityNo] = useState("");
  const [oldIdentityNo, setOldIdentityNo] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [ocrLoading, setOcrLoading] = useState(false);
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [resultStage, setResultStage] = useState<"validate" | "confirm" | null>(null);
  const [recoveryIdentityNo, setRecoveryIdentityNo] = useState("");
  const [recoveryIdentityLabel, setRecoveryIdentityLabel] = useState("");
  const [ocrDone, setOcrDone] = useState(false);
  const [expandedStep, setExpandedStep] = useState<StepKey>("upload");

  const normalizedFullName = normalizeNameInput(fullName);
  const badOcrName = looksLikeBadOcrName(normalizedFullName);
  const canConfirmSms = Boolean(result && resultStage === "validate" && result.response_status === 220);
  const isFinished = Boolean(result && resultStage === "confirm");
  const showUploadStep = !file && !ocrDone && !result;
  const showOcrStep = Boolean(file && !ocrDone && !result);
  const showReviewStep = Boolean(ocrDone && !canConfirmSms && resultStage !== "confirm");
  const activeStep: StepKey = isFinished ? "done" : canConfirmSms ? "confirm" : showReviewStep ? "review" : showOcrStep ? "ocr" : "upload";
  const availableSteps = {
    upload: true,
    ocr: Boolean(file || ocrDone || result),
    review: Boolean(ocrDone || result),
    confirm: Boolean(canConfirmSms || isFinished)
  };
  const canRecover = useMemo(
    () => !badOcrName && normalizedFullName.split(" ").length >= 2 && !/\d/.test(normalizedFullName) && /^\d{12}$/.test(identityNo.trim()),
    [badOcrName, normalizedFullName, identityNo]
  );

  const resetRecoveryState = () => {
    setError("");
    setWarnings([]);
    setResult(null);
    setResultStage(null);
    setRecoveryIdentityNo("");
    setRecoveryIdentityLabel("");
  };

  useEffect(() => {
    setExpandedStep(activeStep);
  }, [activeStep]);

  const acceptImageFile = (nextFile: File | null) => {
    resetRecoveryState();
    setOcrDone(false);
    setFullName("");
    setIdentityNo("");
    setOldIdentityNo("");
    setFile(null);

    if (!nextFile) return;
    if (!acceptedTypes.includes(nextFile.type)) {
      setError("Vui lòng chọn file JPG, JPEG hoặc PNG.");
      return;
    }
    if (nextFile.size > maxFileSize) {
      setError("Dung lượng ảnh tối đa 10MB.");
      return;
    }

    setFile(nextFile);
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    acceptImageFile(event.target.files?.[0] || null);
  };

  useEffect(() => {
    const pasteImage = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      const pastedFile = imageItem?.getAsFile();
      if (!pastedFile) return;

      event.preventDefault();
      const extension = pastedFile.type === "image/png" ? "png" : "jpg";
      acceptImageFile(new File([pastedFile], `ket-qua-quet-qr-zalo.${extension}`, { type: pastedFile.type }));
    };

    window.addEventListener("paste", pasteImage);
    return () => window.removeEventListener("paste", pasteImage);
  }, []);

  const runOcr = async () => {
    if (!file) {
      setError("Vui lòng tải hoặc dán kết quả quét QR từ Zalo.");
      return;
    }

    setOcrLoading(true);
    resetRecoveryState();
    try {
      const response = await ocrCccd(file);
      const ocrFullName = normalizeNameInput(response.data.fullName || "");
      const hasBadName = looksLikeBadOcrName(ocrFullName);
      setFullName(hasBadName ? "" : ocrFullName);
      setIdentityNo(response.data.cccd || "");
      setOldIdentityNo(response.data.cmnd || "");
      setWarnings(hasBadName ? [...(response.warnings || []), "Họ tên OCR có dấu hiệu đọc nhầm, vui lòng nhập lại đúng họ tên."] : response.warnings || []);

      const hasAnyData = Boolean(response.data.fullName || response.data.cccd || response.data.cmnd);
      setOcrDone(response.ok || hasAnyData);
      if (!response.ok) {
        setError(response.message || "Không đọc được thông tin CCCD. Vui lòng thử ảnh rõ hơn.");
      }
    } catch (err) {
      setOcrDone(false);
      setError(err instanceof Error ? err.message : "Không thể OCR ảnh. Vui lòng thử lại.");
    } finally {
      setOcrLoading(false);
    }
  };

  const submitRecovery = async () => {
    if (!canRecover) return;

    setRecoverLoading(true);
    setError("");
    setResult(null);
    setResultStage(null);
    setRecoveryIdentityNo("");
    setRecoveryIdentityLabel("");
    try {
      const fixedFullName = normalizeNameInput(fullName);
      setFullName(fixedFullName);
      const cccdNo = identityNo.trim();
      const cmndNo = oldIdentityNo.trim();
      let data = await recoverMyBVLife(fixedFullName, cccdNo);
      let matchedIdentity = cccdNo;
      let matchedLabel = "Số CCCD/GTTT";

      if (data.response_status === 412 && cmndNo) {
        data = await recoverMyBVLife(fixedFullName, cmndNo);
        matchedIdentity = cmndNo;
        matchedLabel = "Số CMND";
      }

      setResult(data);
      setResultStage("validate");
      setRecoveryIdentityNo(matchedIdentity);
      setRecoveryIdentityLabel(matchedLabel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra, vui lòng thử lại sau.");
    } finally {
      setRecoverLoading(false);
    }
  };

  const confirmRecovery = async () => {
    if (!result || result.response_status !== 220) return;

    setConfirmLoading(true);
    setError("");
    try {
      const fixedFullName = normalizeNameInput(fullName);
      setFullName(fixedFullName);
      const data = await confirmMyBVLifeRecovery(fixedFullName, recoveryIdentityNo || identityNo.trim());
      setResult(data);
      setResultStage("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra, vui lòng thử lại sau.");
    } finally {
      setConfirmLoading(false);
    }
  };

  return (
    <PortalShell title="Khôi phục MyBVLife" showBack>
      <section className="recoveryIntro">
        <h2>Khôi phục tài khoản MyBVLife</h2>
        <p>Tải hoặc dán kết quả quét QR từ Zalo để hệ thống hỗ trợ điền số CCCD, số CMND và họ tên.</p>
      </section>

      {availableSteps.upload ? (
      <section className={`recoveryCard ${expandedStep === "upload" ? "isOpen" : "isCollapsed"}`}>
        <button className="recoveryStep stepToggle" type="button" onClick={() => setExpandedStep(expandedStep === "upload" ? activeStep : "upload")}>
          <span>1</span>
          <strong>Upload kết quả quét QR từ Zalo</strong>
        </button>
        {expandedStep === "upload" ? (
        <label className="recoveryUpload">
          <input className="fileInput" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={chooseFile} />
          <span>Chọn ảnh hoặc Ctrl+V để dán kết quả quét QR từ Zalo</span>
          <small>JPG, JPEG, PNG tối đa 10MB</small>
        </label>
        ) : null}
      </section>
      ) : null}

      {availableSteps.ocr ? (
      <section className={`recoveryCard ${expandedStep === "ocr" ? "isOpen" : "isCollapsed"}`}>
        <button className="recoveryStep stepToggle" type="button" onClick={() => setExpandedStep(expandedStep === "ocr" ? activeStep : "ocr")}>
          <span>2</span>
          <strong>OCR thông tin</strong>
        </button>
        {expandedStep === "ocr" ? (
        <>
        <div className="compactFile">
          <strong>Đã nhận file</strong>
          <span>{file?.name}</span>
        </div>
        <button className="primaryButton" type="button" onClick={runOcr} disabled={!file || ocrLoading}>
          {ocrLoading ? "Đang đọc thông tin..." : "OCR thông tin"}
        </button>
        <p className="recoveryNote">Bước này chỉ đọc thông tin, không gửi yêu cầu khôi phục.</p>
        </>
        ) : null}
      </section>
      ) : null}

      {availableSteps.review ? (
        <section className={`recoveryCard ${expandedStep === "review" ? "isOpen" : "isCollapsed"}`}>
          <button className="recoveryStep stepToggle" type="button" onClick={() => setExpandedStep(expandedStep === "review" ? activeStep : "review")}>
            <span>3</span>
            <strong>Kiểm tra thông tin</strong>
          </button>
          {expandedStep === "review" ? (
          <>
          {warnings.length ? <div className="warning">{warnings.join(" ")}</div> : null}
          {badOcrName ? <div className="warning">Họ tên OCR có dấu hiệu đọc nhầm, vui lòng nhập lại đúng họ tên.</div> : null}
          <label className="field">
            Họ và tên
            <input value={fullName} onBlur={() => setFullName(normalizeNameInput(fullName))} onChange={(event) => setFullName(event.target.value)} placeholder="Nhập họ và tên" />
          </label>
          <label className="field">
            Số CCCD/GTTT
            <input value={identityNo} inputMode="numeric" onChange={(event) => setIdentityNo(event.target.value.replace(/\D/g, ""))} placeholder="12 chữ số" />
          </label>
          <label className="field">
            Số CMND
            <input value={oldIdentityNo} inputMode="numeric" onChange={(event) => setOldIdentityNo(event.target.value.replace(/\D/g, ""))} placeholder="9 hoặc 12 chữ số" />
          </label>
          <button className="goldButton" type="button" onClick={submitRecovery} disabled={!canRecover || recoverLoading}>
            {recoverLoading ? "Đang gửi..." : "Gửi yêu cầu khôi phục"}
          </button>
          </>
          ) : null}
        </section>
      ) : null}

      {result && availableSteps.confirm ? (
        <section className={`recoveryCard ${expandedStep === "confirm" || expandedStep === "done" ? "isOpen" : "isCollapsed"}`}>
          <button className="recoveryStep stepToggle" type="button" onClick={() => setExpandedStep(expandedStep === "confirm" || expandedStep === "done" ? activeStep : "confirm")}>
            <span>4</span>
            <strong>Xác nhận gửi SMS</strong>
          </button>
          {expandedStep === "confirm" || expandedStep === "done" ? (
          <>
          <div className="success resultAlert">
            <strong>Thông tin phù hợp</strong>
            <span>{getRawObj(result)?.msgSuccess || result.message}</span>
          </div>
          <div className="confirmSummary">
            <span>Số tài khoản</span>
            <strong>{getRawObj(result)?.userCode || "Đã tìm thấy"}</strong>
            <span>Họ và tên</span>
            <strong>{normalizedFullName}</strong>
            <span>Giấy tờ dùng để khôi phục</span>
            <strong>{recoveryIdentityLabel ? `${recoveryIdentityLabel}: ${recoveryIdentityNo}` : identityNo}</strong>
            {oldIdentityNo ? (
              <>
                <span>Số CMND</span>
                <strong>{oldIdentityNo}</strong>
              </>
            ) : null}
          </div>
          <button className="goldButton" type="button" onClick={confirmRecovery} disabled={confirmLoading}>
            {confirmLoading ? "Đang gửi SMS..." : "Xác nhận gửi SMS"}
          </button>
          </>
          ) : null}
        </section>
      ) : null}

      {result && !(resultStage === "validate" && result.response_status === 220) ? (
        <div className={result.success ? "success resultAlert" : result.response_status === 412 ? "warning resultAlert" : "error resultAlert"}>
          <strong>{getRecoveryTitle(result, resultStage)}</strong>
          <span>{result.message}</span>
        </div>
      ) : null}
      {error ? <div className="error">{error}</div> : null}
    </PortalShell>
  );
}

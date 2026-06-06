# Cổng nghiệp vụ BAOVIET Life

Cổng hỗ trợ nghiệp vụ BVNT theo hướng mobile-first. Ứng dụng giữ nguyên chức năng ghép ảnh giấy tờ tùy thân hiện có, đồng thời bổ sung mẫu biểu, hướng dẫn, câu hỏi thường gặp và màn hình quản trị đơn giản dùng dữ liệu JSON cục bộ.

## Công nghệ

- Next.js App Router
- React
- TypeScript
- CSS global mobile-first
- Nội dung JSON cục bộ trong `data/`
- File PDF tĩnh trong `public/pdfs/`

## Tuyến trang

- `/` - màn hình chọn chức năng
- `/forms` - folder mẫu biểu và danh sách PDF
- `/forms/[id]` - xem trước PDF, tải về và chia sẻ Zalo
- `/merge-id` - công cụ ghép 3 ảnh giấy tờ, crop/xoay/xuất ảnh
- `/guides` - danh mục hướng dẫn
- `/guides/[id]` - từng bước xử lý và danh sách kiểm tra
- `/faq` - câu hỏi thường gặp dạng accordion
- `/mybvlife-recovery` - OCR ảnh CCCD mặt trước và gửi yêu cầu khôi phục MyBVLife sau khi người dùng xác nhận
- `/admin` - quản trị nội dung đơn giản

## Chạy trên máy

### Backend MyBVLife Recovery

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

OCR ưu tiên PaddleOCR, sau đó EasyOCR nếu môi trường có cài một trong hai thư viện này. Nếu chưa cài OCR engine, endpoint OCR vẫn trả cảnh báo để người dùng nhập thủ công thay vì tự gửi yêu cầu khôi phục.

### Frontend

```bash
npm install
npm run dev
```

Mở:

```text
http://localhost:3000
```

Frontend mặc định gọi backend tại `http://localhost:8000`. Có thể đổi bằng biến môi trường:

```text
NEXT_PUBLIC_MYBVLIFE_API_BASE=http://localhost:8000
```

## Quản trị

API quản trị kiểm tra biến môi trường:

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

Nếu chưa cấu hình biến môi trường, tài khoản mặc định khi chạy trên máy là `admin` / `admin123`.

Quản trị có thể chỉnh:

- folder mẫu biểu, tiêu đề PDF, đường dẫn PDF và upload PDF
- danh mục, tiêu đề, tóm tắt, các bước và checklist của hướng dẫn
- câu hỏi, câu trả lời và thứ tự câu hỏi thường gặp
- ghi chú và định dạng mặc định của chức năng ghép ảnh
- mục Khôi phục MyBVLife: cấu hình mặc định đang nằm trong `backend/app/mybvlife_recovery/config.py`, log chỉ lưu CCCD dạng che số trong bộ nhớ backend và có thể xem/xóa qua `/api/mybvlife/admin/logs`

## Lưu ý bảo mật MyBVLife

- Công cụ chỉ dùng nội bộ và chỉ xử lý dữ liệu khi được phép.
- Người dùng phải kiểm tra thông tin OCR trước khi gửi yêu cầu khôi phục.
- Ảnh CCCD chỉ lưu tạm trong `tmp_uploads/` khi OCR và được xóa ngay sau khi xử lý.
- Backend không log CCCD đầy đủ; khi cần log chỉ dùng dạng che số, ví dụ `0560******06`.
- Không dùng để gửi hàng loạt hoặc spam API MyBVLife.

## File nội dung

```text
data/forms.json
data/guides.json
data/faq.json
data/settings.json
```

File PDF được phục vụ từ:

```text
public/pdfs
```

Phần quản trị hiện tại ghi trực tiếp vào file, phù hợp khi chạy trên máy hoặc mô hình lưu bằng file đơn giản. Trên Vercel, file tải lên hoặc JSON chỉnh trong lúc chạy có thể không tồn tại bền vững giữa các lần triển khai/serverless instance. Khi cần chạy production có quản trị lâu dài, nên chuyển phần lưu trữ sang Vercel Blob, KV, Supabase hoặc một dịch vụ lưu trữ phù hợp.

## Kiểm tra build

```bash
npm run build
```

Ứng dụng có thể triển khai lên Vercel như một dự án Next.js tiêu chuẩn.

## Cấu hình AI Vision OCR

Tạo file `.env` ở root project hoặc trong thư mục `backend/`:

```text
AI_API_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your_api_key_here
AI_MODEL=gpt-4o-mini
```

Nếu dùng API bên thứ ba tương thích OpenAI:

```text
AI_API_BASE_URL=https://your-third-party-api.com/v1
AI_API_KEY=your-third-party-key
AI_MODEL=your-vision-model
```

Backend gọi trực tiếp `{AI_API_BASE_URL}/chat/completions`; API key chỉ nằm ở backend và không được đưa lên frontend. File `.env` đã nằm trong `.gitignore`.

OCR CCCD dùng endpoint backend:

```text
POST /api/ocr-cccd
multipart/form-data field: file
```

Luồng sử dụng: chạy backend, chạy frontend, upload hoặc dán ảnh kết quả quét QR từ Zalo, bấm `OCR thông tin`, kiểm tra dữ liệu rồi mới bấm `Gửi yêu cầu khôi phục`.

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
- `/admin` - quản trị nội dung đơn giản

## Chạy trên máy

```bash
npm install
npm run dev
```

Mở:

```text
http://localhost:3000
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

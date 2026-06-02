# Ghép ảnh giấy tờ tùy thân

Ứng dụng Next.js xử lý và ghép 3 ảnh giấy tờ tùy thân trực tiếp trên trình duyệt. Ảnh không được upload lên server.

## Công nghệ

- Next.js App Router
- React
- TypeScript
- Canvas API trên trình duyệt
- CSS global mobile-first

## Chạy local

```bash
npm install
npm run dev
```

Mở:

```text
http://localhost:3000
```

## Cách dùng

1. Chọn ảnh mặt trước CCCD.
2. Chọn ảnh mặt sau CCCD.
3. Chọn ảnh thông tin Zalo.
4. Chọn định dạng JPG hoặc PNG.
5. Bấm **Tạo ảnh hoàn chỉnh**.
6. Bấm **Tải ảnh về**.

Ứng dụng chỉ hiển thị trạng thái đã chọn ảnh, không hiển thị preview ảnh gốc.

## Bảo mật

- Không OCR.
- Không lưu dữ liệu.
- Không gửi ảnh lên server.
- Toàn bộ xử lý ảnh chạy cục bộ bằng Canvas API trên trình duyệt.

## Deploy lên Vercel bằng GitHub

1. Tạo repository GitHub mới.
2. Commit toàn bộ project và push lên GitHub:

```bash
git init
git add .
git commit -m "Convert to Next.js image composer"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

3. Vào https://vercel.com và đăng nhập bằng GitHub.
4. Chọn **Add New Project**.
5. Import repository vừa push.
6. Framework Preset chọn **Next.js**.
7. Build Command để mặc định:

```text
npm run build
```

8. Output Directory để mặc định.
9. Bấm **Deploy**.

Sau khi deploy xong, Vercel sẽ cung cấp URL public để sử dụng.

# LuyệnĐề – Hệ thống thi trắc nghiệm (Cloudflare Workers + D1)

Giáo viên đăng ký, tạo đề, gửi link `/#/e/<mã>` cho học sinh. Học sinh nhập tên, làm bài có đồng hồ,
được chấm **ở server** (đáp án đúng không bao giờ gửi xuống trình duyệt trước khi nộp), giáo viên xem bảng điểm và tải CSV.

## 1. Cài đặt (làm 1 lần)
```bash
npm i -g wrangler          # hoặc dùng npx wrangler
wrangler login
wrangler d1 create luyende # copy database_id in ra, dán vào wrangler.toml
wrangler d1 execute luyende --remote --file=schema.sql
wrangler secret put JWT_SECRET   # nhập một chuỗi ngẫu nhiên dài (vd: openssl rand -hex 32)
wrangler deploy
```
Xong sẽ có địa chỉ `https://luyende.<tài-khoản>.workers.dev`.

## 2. Đẩy lên GitHub + tự động deploy
```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/<user>/luyende.git && git push -u origin main
```
Cloudflare Dashboard → Workers & Pages → chọn Worker `luyende` → Settings → Builds → Connect to Git → chọn repo.
Từ giờ mỗi lần `git push`, Cloudflare tự deploy. (Nhớ vẫn phải đặt secret `JWT_SECRET` trong Settings → Variables and Secrets.)

## 3. Chạy thử trên máy
```bash
echo 'JWT_SECRET=dev-secret' > .dev.vars
wrangler d1 execute luyende --local --file=schema.sql
wrangler dev
```

## Gợi ý mở rộng
- Giới hạn tần suất nộp bài (Cloudflare Rate Limiting / Turnstile chống spam).
- Mỗi học sinh chỉ nộp 1 lần (thêm mã học sinh), hạn chót mở/đóng đề.
- Câu tự luận, ảnh trong câu hỏi (R2), nhập đề từ Word.

## Nhập đề từ Word & câu Đúng/Sai
Trong màn hình soạn đề: chọn file `.docx` (có file mẫu `public/de-mau.docx`) hoặc dán văn bản.
```
Câu 1: Thủ đô của Việt Nam là gì?
A. Huế
B. Hà Nội            ← gạch chân/in đậm (hoặc gõ *B.) hoặc dùng dòng “Đáp án: B”
C. Đà Nẵng
D. Cần Thơ
Giải thích: ...

Câu 2: Xét các phát biểu sau:
a) ...               ← chữ thường a) b) c) d) = câu Đúng/Sai
b) ...
c) ...
d) ...
Đáp án: a-Đ, b-S, c-Đ, d-S      (hoặc “ĐSĐS”, hoặc gạch chân ý đúng, hoặc thêm (Đ)/(S) cuối ý)
```
Lưu ý: gõ “Câu 1:”, “A.” bằng tay (không dùng đánh số tự động của Word); ảnh/công thức trong file chưa được nhập.
Hệ thống báo những câu chưa nhận diện được đáp án để bạn kiểm tra lại.

**Cách tính điểm câu Đúng/Sai (4 ý):** đúng 1 ý = 0,1; 2 ý = 0,25; 3 ý = 0,5; 4 ý = 1 (mỗi câu có trọng số bằng nhau, điểm tổng quy về thang 10).
Muốn đổi thang điểm, sửa mảng `TFP` trong `src/worker.js`.

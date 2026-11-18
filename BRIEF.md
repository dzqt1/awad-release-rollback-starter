## Brief 1: Packaging (v1)

**Việc cần làm:** Đóng gói linkbox thành image, hành vi giữ nguyên. Sửa Dockerfile,
.dockerignore, src/config.js, env/ và phần start/shutdown của src/server.js.

**Yêu cầu:**
- Base image ghim phiên bản, image <= 300 MB, chạy bằng user non-root.
- Không có secret trong config hoặc history của image; không có .git, env/, tools/, log trong image.
- APP_ENV, BASE_URL, DB_PATH, ADMIN_TOKEN đọc từ môi trường; /version báo APP_VERSION build-arg.
- HEALTHCHECK báo healthy; docker stop <= 8 s, request đang chạy được hoàn tất (Node là PID 1, xử lý SIGTERM).
- APP_ENV=production mà thiếu token hoặc token là dev-secret thì thoát với lỗi, nêu tên biến, không in giá trị.
- Khởi động container không chạy migration.

**Giới hạn:**
- KHÔNG sửa bất cứ thứ gì trong tools/ và test/app.test.js.
- Giữ nguyên chữ ký createApp(db, config) và lệnh node src/migrate.js.
- Không đổi hành vi API. Không đụng migrations/ và không thêm tính năng.

**Xong khi:** `npm run check -- image --new=linkbox:v1` đạt 15/15 (I1–I15),
`npm test` xanh, `git diff starter -- tools/` rỗng, fingerprint đúng 4b56096c90ea819d.

**Cách làm việc:** Nếu một check đỏ, giải thích nguyên nhân và đề xuất sửa trong code/Dockerfile.
Không sửa check. Cuối cùng liệt kê từng file đã thay đổi.

## Brief 2: Change (v2): links can expire, behind a flag

**Việc cần làm:** Cài đặt đúng docs/CHANGE.md (đính kèm, đọc kỹ trước khi viết code).
Chỉ sửa src/, migrations/002_*.up.sql, migrations/002_*.down.sql và file test MỚI.

**Schema (migration 002):**
- Thêm cột nullable links.expires_at và bảng/cột lưu flag. Chỉ "expand": không đổi tên,
  không xóa, không đổi kiểu bất cứ thứ gì v1 đang đọc hay ghi.
- Hàng cũ có expires_at NULL và không bao giờ hết hạn.
- File .down.sql phải chạy được trên SQLite của image (kiểm tra phiên bản SQLite có hỗ trợ
  DROP COLUMN không; nếu không thì dùng cách tạo lại bảng).
- Không sửa migration 001.

**Flag `expiry`:**
- Lưu trong database, mặc định tắt. Không dùng biến môi trường.
- Mọi instance thấy thay đổi trong 2 giây mà không restart (không cache lâu hơn 1 giây).
- PUT /admin/flags/expiry với header x-admin-token và body {"enabled": true|false}:
  200 kèm trạng thái mới; 401 khi token sai hoặc thiếu. Body sai kiểu (enabled không phải boolean) thì 400.
- GET /version thêm trường flags: {"version":"2.0.0","env":"...","flags":{"expiry":false}}.

**Flag TẮT (phải giống v1):**
- Bỏ qua expiresInSeconds trong body.
- MỌI response đều có "expiresAt": null, kể cả với link đã có expires_at từ lúc flag bật.
- GET /r/:code luôn redirect (302) và đếm hit, kể cả link đã hết hạn.

**Flag BẬT:**
- POST /links có expiresInSeconds hợp lệ: 201, expiresAt là chuỗi ISO 8601.
- Không có expiresInSeconds: 201, expiresAt null.
- expiresInSeconds không phải số nguyên dương (số thực, 0, âm, chuỗi, null, quá lớn
  làm ngày bị overflow): 400, tuyệt đối không được 500.
- GET /r/:code chưa hết hạn: 302 và đếm hit. Đã hết hạn: 410 với {"error":"expired"} và KHÔNG đếm hit.
  Việc kiểm tra hết hạn và đếm hit nằm trong một câu lệnh SQL, không tách hai bước.
- GET /links/:code và GET /links: 200 kèm expiresAt, hết hạn hay chưa.

**Khởi động:** v2 kiểm tra schema khi start; thiếu cột expires_at thì thoát với lỗi rõ ràng,
không để lỗi xảy ra lúc phục vụ request. Khởi động vẫn KHÔNG chạy migration (I15).

**Tương thích v1:** Kiểm tra mọi câu SQL của v1 vẫn chạy đúng trên schema 002
(nhất là SELECT * và INSERT không liệt kê cột). Mọi trường v1 trả về vẫn còn nguyên.

**Giới hạn:**
- KHÔNG sửa bất cứ thứ gì trong tools/ và test/app.test.js. Được ĐỌC tools/check.js để biết
  check mong đợi định dạng nào, nhưng không được sửa.
- Không sửa Dockerfile, .dockerignore, env/, deploy/. Nếu cần sửa Dockerfile
  (ví dụ để copy migration mới) thì báo lại trước, không tự sửa.
- Không làm hỏng phần v1: I1–I15 phải còn xanh.
- Test mới viết ở file riêng, ví dụ test/expiry.test.js.

**Xong khi:**
- `npm test` xanh (gồm test mới và test của client cũ).
- `npm run check -- change` xanh (T3, F1–F7).
- `npm run check -- compat` xanh (C1–C4).
- Build với --build-arg APP_VERSION=2.0.0, rồi `npm run check -- image --new=linkbox:v2` vẫn 15/15.
- `git diff starter -- tools/` rỗng và fingerprint là 4b56096c90ea819d.

**Cách làm việc:**
- Trước khi code, liệt kê những chỗ spec còn mơ hồ và cách bạn định xử lý.
- Nếu một check đỏ, giải thích nguyên nhân và sửa code, không sửa check.
- Cuối cùng liệt kê từng file đã thay đổi và trả lời ba câu để tôi viết RELEASE.md:
  (1) link hết hạn trong lúc v1 phục vụ thì chuyện gì xảy ra (v1 xử lý ra sao)?
  (2) link do v1 tạo khi flag đang bật có expires_at không?
  (3) sau khi rollback về v1, flag nằm ở trạng thái nào và ai phải tắt nó?

## Brief 3: Release and rollback scripts

**Việc cần làm:** Viết deploy/release.js (npm run release -- <tag>) và deploy/rollback.js (npm run rollback).

**release.js phải:**
- Đưa image vào slot đang rảnh, giữ slot cũ chạy sau khi xong.
- Chờ Docker báo healthy rồi mới đổi trọng số đầu tiên (không dùng timer).
- Chuyển traffic theo nấc: ít nhất 2 nấc dưới 100%, nấc đầu <= 25% và >= 10 giây.
- Trong lúc chờ, đọc GET :8081/state, tính errors/requests của slot canary, và tự quay lại
  nếu tỉ lệ lỗi vượt ngưỡng sau một số request tối thiểu. KHÔNG dùng /health để quyết định.
- Ngưỡng và số request tối thiểu đặt thành hằng số có tên, kèm comment lý do.

**rollback.js phải:** một lệnh, chuyển 100% sang slot kia, rồi xác nhận bằng GET :8081/state
trước khi in "done".

**Giới hạn:**
- KHÔNG sửa tools/, test/app.test.js, src/, migrations/ hay Dockerfile.
- Chỉ dùng Node chuẩn, không thêm dependency, không dùng shell script.

**Xong khi:** chạy đủ chuỗi lệnh trong README bước 6 dưới load,
rồi `npm run check -- log` đạt L0–L9, đặc biệt L3 = 0 lỗi ngoài canary xấu,
L7 bản v3-bad <= 25% traffic, L8 <= 5 phút, và release-log.txt cho thấy gate tự dừng.

**Cách làm việc:** Nếu có request lỗi, phân tích log trước khi đề xuất sửa. Không sửa tools/.
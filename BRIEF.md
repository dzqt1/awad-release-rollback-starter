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
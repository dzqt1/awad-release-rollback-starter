# RELEASE.md: phát hành linkbox v1 → v2 (link có thể hết hạn)

Những chỗ phụ thuộc vào code của bạn được đánh dấu **[ĐIỀN]**. Đối chiếu từng chỗ với repository trước khi commit.

## 1. Phát hành cái gì

| Mục | Giá trị |
|---|---|
| Phiên bản | `v1` (`1.0.0`, đã đóng gói, hành vi giống `starter`), `v2` (`2.0.0`, link có thể hết hạn, sau flag `expiry`) |
| Schema | `001` (trước) → `002` (sau): thêm cột nullable `links.expires_at` và chỗ lưu flag (`migrations/002_*.up.sql` / `.down.sql`) |
| Loại migration | **Chỉ expand.** Không đổi tên, không xóa, không đổi kiểu thứ gì v1 đọc hoặc ghi, nên v1 và v2 chạy cùng lúc trên `002` được |
| Slot | `blue` và `green`, mỗi slot một image, dùng chung một volume (`/data/app.db`). Release đưa image vào slot đang không nhận traffic; slot cũ vẫn chạy sau đó |
| Deploy và release | Deploy v2 là đưa code lên máy chủ. Bật flag `expiry` mới là thứ đổi hành vi. Hai việc tách biệt, mỗi việc có cách undo riêng |

Image được build trước khi chạy tải: `docker build --build-arg APP_VERSION=1.0.0 -t linkbox:v1 .` (tag `v1`) và `docker build --build-arg APP_VERSION=2.0.0 -t linkbox:v2 .` (tag `v2`).

## 2. Kế hoạch, mỗi bước một dòng

`blue` và `green` không gắn cố định với phiên bản nào: script release dùng slot đang rảnh. Cột "đang phục vụ" là tỉ lệ traffic đi qua router (`:8080`).

| # | Bước | Lệnh | Schema sau bước | Đang phục vụ | Cách undo | Phiên bản chạy được trên schema này |
|---|---|---|---|---|---|---|
| 0 | Khởi đầu sạch (chỉ khi chạy thử) | `docker compose down -v` rồi `docker compose up -d --build router` | không có (volume trống) | không có, chỉ router | `docker compose down -v` | chưa có |
| 1 | Migrate lên 001 bằng image v1 | `npm run migrate:image -- v1` | 001 | không có | `npm run migrate:image -- v1 down`, hoặc `docker compose down -v` trên volume trống | chỉ v1. v2 từ chối khởi động (nó kiểm tra schema lúc start) |
| 2 | Đưa v1 vào một slot | `BLUE_TAG=v1 docker compose up -d --no-deps blue` (chờ healthy) | 001 | v1, 100% | `docker compose stop blue` | v1 |
| 3 | Migrate lên 002 (expand) **trước** mọi code v2 | `npm run migrate:image -- v2` | **002** | v1, 100% (vẫn chạy trên schema mới) | `npm run migrate:image -- v2 down` (xem mục 5: chỉ an toàn khi chưa có link nào có `expires_at`, và không bao giờ khi v2 đang phục vụ) | **v1 và v2** |
| 4 | Release v2 dạng canary | `npm run release -- v2` | 002 | v1 và v2 song song theo từng nấc, kết thúc ở v2 100%. v1 vẫn chạy ở 0% | tự động khi cổng chặn (mục 3); nếu không thì `npm run rollback` | v1 và v2 |
| 5 | Bật flag (quyết định release, không phải deploy) | `curl -X PUT http://localhost:8080/admin/flags/expiry -H "x-admin-token: $ADMIN_TOKEN" -H "content-type: application/json" -d '{"enabled":true}'`, rồi chờ ≥ 10 giây | 002 (chỉ dòng flag đổi) | v2, 100%, expiry đang hoạt động | cùng lệnh `PUT` với `{"enabled":false}`; mọi instance thấy trong 2 giây | v1 và v2 (v1 bỏ qua flag) |
| 6 | Rollback về v1, đi qua migration | `npm run rollback` (xác nhận trọng số bằng `GET :8081/state`) | 002 (rollback không đụng schema) | v1, 100% | `npm run release -- v2` | v1 và v2 |
| 7 | Release v2 lần nữa | `npm run release -- v2` | 002 | v2, 100% | `npm run rollback` | v1 và v2 |
| 8 | Build bản xấu (drill) | `npm run drill:build -- v2` (build `linkbox:v3-bad` từ `linkbox:v2`) | 002 (chưa deploy gì) | không đổi | `docker rmi linkbox:v3-bad` | v3-bad build từ v2 nên cần 002 **[ĐIỀN: xác nhận]** |
| 9 | Release bản xấu | `npm run release -- v3-bad` | 002 | v3-bad chỉ nhận traffic canary; cổng chặn và đưa toàn bộ traffic về slot trước | tự động (cổng). Dự phòng: `npm run rollback` | v3-bad, v2 và v1 trên 002 |

Output của mọi lệnh trên được giữ bằng `... 2>&1 | tee -a release-log.txt`.

Lưu ý về bước 9: sau bước 7, slot rảnh là slot của v1, nên v3-bad thay chỗ v1. Sau bước này v1 không còn chạy, và đường quay lại là về v2.

**Thứ tự quan trọng.** Migrate (3) → deploy (4) → flag (5). Migration đi trước vì v2 cần `expires_at`; thiếu nó v2 lỗi lúc start, không bao giờ healthy, và release không chuyển traffic nào. Flag đi cuối vì khi tắt, v2 hành xử y hệt v1, nhờ đó canary mới có ý nghĩa.

**Điểm không thể quay lại.** Không có trong kế hoạch này. Thay đổi schema duy nhất là expand, v1 chạy được trên nó (check C1–C2), và `npm run rollback` chỉ chuyển traffic, không đổi schema. Điểm không thể quay lại sẽ xuất hiện trong hai trường hợp, không trường hợp nào nằm trong lần release này:

- bước **contract** (xóa hoặc đổi tên thứ v1 đang dùng): sau đó v1 không chạy được nữa;
- chạy **down migration** khi đã có link có `expires_at`: mất dữ liệu hết hạn (mục 5).

## 3. Cổng của canary

`deploy/release.js` chờ Docker báo container mới là `healthy` rồi mới chuyển traffic. Sau đó nó chuyển theo từng nấc **[ĐIỀN: khớp với script, ví dụ 10% trong ≥ 10 giây → 50% → 100%]**. Ở mỗi nấc, nó đọc `GET :8081/state` và so `errors` với `requests` của riêng slot canary.

| Hằng số | Giá trị | Lý do |
|---|---|---|
| Nấc 1 | **[ĐIỀN: ≤ 25%]** trong ≥ 10 giây | Tỉ lệ nhỏ giới hạn thiệt hại: với khoảng 40 request/giây, 10% là khoảng 4 request/giây, nên canary nhận khoảng 40 request trong 10 giây |
| Số request tối thiểu trước khi phán xét | **[ĐIỀN: ví dụ 10]** | Dưới mức này một lỗi lẻ đã thành tỉ lệ rất lớn và cổng sẽ chặn vì nhiễu |
| Ngưỡng lỗi | **[ĐIỀN: ví dụ 5% số request canary]** | Mức bình thường là 0 lỗi, nên tỉ lệ lỗi thật là tín hiệu. Bản xấu của drill lỗi khoảng 30% lượt đọc link, vượt xa ngưỡng, nên bị chặn ngay ở nấc đầu sau vài request. Ngưỡng quá thấp (0%) thì một lỗi lẻ cũng chặn; quá cao (30% trở lên) thì để bản xấu lọt |
| Hành động khi chặn | đưa toàn bộ traffic về slot trước, thoát với mã khác 0 | Không cần người can thiệp: bản xấu bị chặn trong vài giây |

**Ngưỡng này bỏ sót gì.**

- **Lỗi dưới ngưỡng.** Bug làm 2% request lỗi vẫn qua cổng 5%. Khi traffic thấp, một nấc có thể kết thúc trước khi đủ số request tối thiểu.
- **Câu trả lời sai nhưng không phải lỗi.** Cổng đọc thứ `/state` đếm là `errors`. Sai status, thiếu trường (script tải gọi là `contract`), hay mất link có thể qua cổng nếu `/state` không đếm chúng. **[ĐIỀN: kiểm tra `errors` đếm gì trong `tools/router`]**
- **Flag.** Canary chạy khi `expiry` tắt, v2 hành xử như v1 nên code hết hạn (`410`, kiểm tra `expiresInSeconds`) không được thử. Bug ở đó chỉ lộ ra sau bước 5, lúc không còn cổng nào theo dõi.
- **Độ trễ và tài nguyên.** Bản chậm nhưng đúng vẫn qua.
- **Lỗi chậm.** Lỗi xuất hiện sau khi nấc kết thúc, hoặc chỉ sau 100%, không bị thấy.
- **`/health` không phải tín hiệu.** Nó vẫn xanh trong bản xấu, nên cổng không dùng nó.

## 4. Rollback

`npm run rollback` là một lệnh. Nó chuyển 100% sang slot kia (slot này vẫn chạy vì script release không bao giờ dừng slot cũ), và chỉ in "done" sau khi `GET :8081/state` cho thấy trọng số mới. Nó không đổi schema và không đổi flag.

Khi v2 hoạt động sai có hai cách về trạng thái tốt, theo thứ tự:

1. **Flag trước** (nếu vấn đề nằm ở hành vi hết hạn): `PUT ... {"enabled":false}`, chờ hơn 2 giây. Không restart, không cần image mới.
2. **Rồi đến traffic:** `npm run rollback`.

## 5. Rollback không hoàn tác được gì

1. **Link hết hạn trong lúc v1 phục vụ.** v1 không biết expiry: nó trả `302` và tăng `hits`, dù `expires_at` đã ở quá khứ. Những lượt redirect đó đã được phục vụ và những hit đó đã được đếm; không thể rút lại. Dòng dữ liệu không bị xóa, nên khi v2 phục vụ lại với flag bật, link đó lại trả `410`. Trong thời gian rollback, link đã hết hạn vẫn "sống" với client của nó.
2. **Link do v1 tạo sau khi flag đã bật.** v1 bỏ qua `expiresInSeconds` và ghi `expires_at = NULL`. Link không bao giờ hết hạn, dù client có yêu cầu hạn, và vẫn như vậy sau khi v2 quay lại. Không có gì tự sửa; muốn có hạn phải `UPDATE` `expires_at` thủ công.
3. **Flag.** Nó nằm trong database nên giữ nguyên giá trị khi rollback, thường vẫn là `true` nếu đã bật. v1 không có endpoint nào để đổi nó. Hệ quả:
   - v1 bỏ qua flag nên vô hại khi v1 phục vụ;
   - khi v2 quay lại, expiry **đã bật sẵn**: hành vi đổi mà không ai quyết định. Đây đúng là chuyện xảy ra trong lượt chạy tải (bật flag ở bước 5, rollback ở bước 6, release v2 lại ở bước 7);
   - để tắt, gửi `PUT /admin/flags/expiry {"enabled":false}` **trước** rollback khi v2 còn phục vụ, hoặc gửi tới một instance v2 còn chạy (slot vừa rollback khỏi vẫn chạy). Người chạy rollback chịu trách nhiệm bước này.
4. **Schema.** Giữ nguyên ở `002`. Đây là chủ ý: v1 chạy được trên nó. Down migration là lệnh riêng (`npm run migrate:image -- v2 down`). Không chạy khi v2 đang chạy (v2 sẽ lỗi vì thiếu `expires_at`), và không chạy khi đã có link có `expires_at`, vì cột và giá trị của nó mất.
5. **Hit và dữ liệu do v2 ghi.** Mọi thứ v2 đã ghi khi phục vụ (link, số hit, thời điểm hết hạn) vẫn nằm trong database dùng chung và v1 đọc được sau rollback. Hit không bao giờ được hoàn lại.

**Bước nào không có đường quay lại?** Không có (mục 2). Rollback an toàn ở mọi dòng của bảng, vì migration chỉ expand và slot cũ vẫn chạy.

## 6. Bằng chứng từ lượt chạy tải

**[ĐIỀN sau khi chạy, từ `load-log.txt`, `release-log.txt`, `check-log.txt`]**

| Cái gì | Xem ở đâu |
|---|---|
| Mark migration trước request v2 đầu tiên (L5) | dòng **[ĐIỀN]** của `load-log.txt` |
| Release v2, không có request lỗi (L3, L4) | **[ĐIỀN]** |
| v1 một mình ≥ 10 giây sau khi v2 lên 100% (L6) | **[ĐIỀN]** |
| Cổng tự chặn `v3-bad`, đỉnh ≤ 25% (L7) | dòng **[ĐIỀN]** của `release-log.txt` |
| Time to rollback (L8) | **[ĐIỀN]** giây |
| Số request lỗi trong canary xấu, và nguyên nhân | **[ĐIỀN]** |

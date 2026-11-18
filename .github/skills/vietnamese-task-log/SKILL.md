---
name: vietnamese-task-log
description: Ghi một mục nhật ký tiếng Việt vào AI-LOG.md sau mỗi tác vụ hoàn thành.
---

# Vietnamese task log

Sau mỗi tác vụ hoàn thành, ghi thêm đúng một mục vào `AI-LOG.md`. Nội dung log
phải bằng tiếng Việt, giữ nguyên các placeholder trong mẫu, và không điền hoặc
diễn giải các dòng `Kept`, `Changed`, `Rejected`.

Quy tắc:

- Dùng ngày hiện tại theo định dạng `YYYY-MM-DD`.
- Tóm tắt công việc ở tiêu đề.
- Chọn công cụ thực tế đã dùng cho trường `Tool`; ghi `none` nếu không dùng công cụ.
- Viết yêu cầu người dùng thành một câu ở trường `Asked for`.
- Giữ nguyên ba dòng `Kept`, `Changed`, `Rejected` như trong mẫu.
- Chỉ thêm log sau khi tác vụ đã hoàn thành; không sửa các mục log cũ.

Mẫu bắt buộc:

```text
## <YYYY-MM-DD> — <what you were working on>
Tool: <Claude Code / Copilot / Cursor / something else / none>
Asked for: <the task you gave it, in one sentence>
Kept: <what you took as it came>
Changed: <what you rewrote, and why>
Rejected: <what you threw away, and why>
```
# StegoLab — TODO

## 1. Shell giao diện và điều hướng
- [x] Website mở tại `/`, responsive và không yêu cầu đăng nhập.
- [x] Giao diện tiếng Việt, hỗ trợ sáng/tối, focus state rõ, reduced motion và bố cục dùng được trên desktop/mobile.
- [x] Có header/wordmark StegoLab, mô tả đúng steganography khác watermark bản quyền, điều hướng tới Nhúng tin, Giải mã, Raw LSB, Phân tích và Cách hoạt động.
- [x] Có trạng thái trống, trạng thái lỗi và trạng thái thành công có hướng dẫn tiếp theo; không gửi ảnh, tin nhắn hoặc mật khẩu ra ngoài trình duyệt.

## 2. Nhúng tin LSB
- [x] Người dùng chọn hoặc kéo-thả ảnh; báo lỗi khi chưa chọn, ảnh không đọc được, ảnh trên 25 megapixel; cảnh báo JPG/JPEG có thể làm mất bit cuối; ảnh trong suốt được composite nền trắng.
- [x] Người dùng nhập tin nhắn UTF-8 gồm tiếng Việt và emoji; báo lỗi khi rỗng hoặc quá dung lượng `(rộng × cao × 3) ÷ 8` byte.
- [x] Chế độ Chuẩn tạo `[CS][độ dài payload 4 byte big-endian][UTF-8]`, ghi tuần tự từ slot 0, MSB trước và cho phép đọc chéo theo định dạng cachesleuth.com.
- [x] Chế độ Nâng cao tạo header `[STG1][cờ mã hóa][độ dài payload]`; nếu có mật khẩu dùng PBKDF2-SHA256 150.000 vòng, AES-256-GCM, salt 16 byte, IV 12 byte và tag xác thực; nếu không có mật khẩu dùng UTF-8 thô.
- [x] Chế độ Nâng cao rải các bit payload ở vị trí khác nhau từ slot 72, seed bằng 4 byte đầu SHA-256(password + `|stg`), theo Fisher-Yates thưa; header vẫn tuần tự.
- [x] Luôn xuất ảnh PNG và cung cấp nút tải xuống với tên file phù hợp.
- [x] Hiển thị dung lượng đã dùng/tối đa, PSNR, MSE, số pixel bị đổi, ảnh stego, ảnh khác biệt khuếch đại ×12 và mặt phẳng LSB RGB.

## 3. Giải mã
- [x] Tải ảnh đã nhúng lên; đọc trực tiếp pixel và tự nhận diện `STG1` hoặc `CS`, không dùng bộ nhớ lưu sẵn.
- [x] Chuẩn giải mã length big-endian và UTF-8; Nâng cao chọn lại slot theo mật khẩu, giải AES-GCM khi có cờ mã hóa và báo lỗi gọn khi thiếu/sai mật khẩu hoặc auth thất bại.
- [x] Ảnh chưa nhúng hoặc header không hợp lệ hiển thị thông báo “không tìm thấy tin nhắn”/hướng dẫn rõ ràng, không crash.

## 4. Raw LSB
- [x] Đọc thẳng bit cuối các kênh R/G/B, bỏ qua alpha, theo slot và hiển thị byte dạng hex cùng ký tự có thể đọc.
- [x] Có giới hạn hiển thị hợp lý cho ảnh lớn nhưng vẫn cho biết số byte/bit đã quét; giải thích đây là công cụ kiểm chứng khách quan.

## 5. Phân tích chi-square
- [x] Cho phép nạp ảnh và tính histogram các cặp `(2k, 2k+1)` trên kênh màu.
- [x] Hiển thị statistic, p-value, số mẫu và diễn giải p-value cao có thể đáng ngờ khi nhúng nhiều, không khẳng định tuyệt đối.
- [x] Cho phép xem/so sánh ảnh cover và ảnh stego nếu người dùng cung cấp hai ảnh; nêu rõ ảnh ngoài hoặc ảnh JPEG có thể cho kết quả khác.

## 6. Cách hoạt động và giới hạn
- [x] Giải thích LSB, ví dụ 150 → 151, công thức dung lượng, thứ tự slot/kênh và MSB-first.
- [x] Giải thích PBKDF2-SHA256, AES-256-GCM, salt/IV/tag, rải bit và lý do chế độ Nâng cao chỉ web này đọc được.
- [x] Giải thích PSNR/MSE, ngưỡng khoảng 40 dB, chi-square và p-value.
- [x] Nêu rõ JPEG/nén qua Messenger/Zalo/Facebook có thể làm mất tin; khuyến nghị PNG và gửi dưới dạng file.
- [x] Nêu rõ đây không phải watermark bản quyền; trình bày fragile watermark, DCT và C2PA như hướng phát triển.

## 7. Chạy được và bàn giao Manus
- [x] `GET /manus-routes.json` trả JSON route `{path:"/",title:"StegoLab — Giấu tin trong ảnh"}`; server chạy trên port 3000.
- [x] JavaScript/HTML/CSS có diagnostics và không còn lỗi actionable sau sửa.
- [x] Checkpoint được commit lên canonical `main`; không tự bật auto-publish.

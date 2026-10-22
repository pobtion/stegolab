# Kế hoạch triển khai StegoLab

## Phạm vi và cách triển khai

StegoLab là web tĩnh chạy hoàn toàn trong trình duyệt, không server, không API ngoài và không database. Dự án sẽ dùng HTML, CSS và JavaScript thuần trong một cấu trúc nhỏ, phục vụ qua một HTTP server port 3000 để Preview và xuất bản static. Canvas chịu trách nhiệm đọc/ghi pixel; Web Crypto chịu trách nhiệm PBKDF2-SHA256, AES-256-GCM và SHA-256. Ảnh, tin nhắn và mật khẩu chỉ tồn tại trong bộ nhớ trình duyệt của người dùng.

Sản phẩm có một route `/` và bốn khu vực chức năng chính trong cùng một ứng dụng: Nhúng tin, Giải mã, Raw LSB, Phân tích; phần Cách hoạt động được mở từ tab/section nội dung. UI responsive, tiếng Việt, có sáng/tối, kéo-thả ảnh, trạng thái lỗi rõ ràng và không yêu cầu đăng nhập.

## Thiết kế

### Ba hướng thẩm mỹ được cân nhắc

- **Phòng thí nghiệm tín hiệu (xác suất 0.06):** giao diện dark-first với lưới kỹ thuật, xanh cyan và lime như màn hình đo tín hiệu.
- **Tạp chí công nghệ tối giản (xác suất 0.04):** nền sáng, typography lớn, các khối nội dung phẳng và nhấn màu đỏ cam.
- **Hộp công cụ thủ công số (xác suất 0.08):** nền giấy, nét viền đậm, màu mực và các panel giống sổ tay kỹ thuật.

### Hướng được chọn: Phòng thí nghiệm tín hiệu

- **Design Movement:** Swiss International Typographic Style pha giao diện terminal/observability hiện đại.
- **Core Principles:** chính xác trước trang trí; mật độ thông tin có thứ bậc; thao tác luôn có phản hồi; minh bạch về giới hạn của steganography.
- **Color Philosophy:** nền xanh-đen tạo cảm giác xử lý cục bộ và an toàn; cyan là tín hiệu đang hoạt động; lime là dữ liệu hợp lệ; amber/coral chỉ dùng cho cảnh báo và giới hạn.
- **Layout Paradigm:** bố cục editorial lệch trục: hero có nhãn chỉ mục và đường baseline, nội dung chia thành cột công cụ chính + rail thông tin, tránh một card trung tâm đơn điệu.
- **Signature Elements:** đường kẻ đo tín hiệu dạng grid; chip trạng thái có chấm sáng; motif pixel 3×3 xuất hiện ở logo, empty state và preview.
- **Interaction Philosophy:** chọn ảnh và nhúng là các thao tác trực tiếp, ít bước; mỗi trạng thái đều có lời giải thích ngắn; lỗi chỉ ra cách sửa tiếp theo.
- **Animation:** chuyển tab bằng fade/slide rất ngắn; progress khi xử lý mã hóa; hover chỉ dịch nhẹ hoặc đổi border, không dùng animation gây nhiễu khi người dùng đang phân tích dữ liệu.
- **Typography System:** Space Grotesk cho tiêu đề và nhãn lớn; IBM Plex Mono cho thông số, header, byte/hex và nhãn kỹ thuật; body dùng Inter system fallback để đọc tiếng Việt tốt.
- **Brand Essence:** phòng thí nghiệm nhỏ để nhìn thấy và kiểm chứng những gì đang ẩn trong một bức ảnh — chính xác, kín đáo, dễ trình bày. Tính cách: điềm tĩnh, kỹ thuật, trung thực.
- **Brand Voice:** headline nói thẳng và có ngữ cảnh; CTA ngắn, mang tính thao tác. Ví dụ: “Giấu một tín hiệu trong ảnh.” và “Đọc từ pixel, không đọc từ bộ nhớ.”
- **Wordmark & Logo:** wordmark STEGO / LAB với dấu gạch chia đôi và biểu tượng 3 pixel xếp lệch như xung tín hiệu; logo không dựa vào icon stock.
- **Signature Brand Color:** cyan điện `#61e7e1`, dùng làm màu nhận diện trên nền xanh-đen.

## Kiến trúc tệp

- `index.html`: shell semantic, header, navigation, các panel chức năng và nội dung Cách hoạt động.
- `styles.css`: design tokens, dark/light theme, responsive layout, panel, bảng số liệu, canvas previews, focus states và reduced-motion.
- `app.js`: state UI, Canvas/image pipeline, định dạng CS/STG1, AES/PBKDF2, phân tán bit, PSNR/MSE, diff/LSB views, raw decoder, chi-square analysis và event wiring.
- `public/manus-routes.json`: manifest route tĩnh duy nhất `/` cho WebDev.
- `app.config.ts`: metadata logo dự án bằng literal HTTPS URL khi có asset phù hợp.
- `plan.md`: kế hoạch và quyết định thiết kế này.
- `TODO.md`: các outcome và acceptance clauses được theo dõi trong quá trình triển khai.

## Luồng kỹ thuật chính

1. Đọc file ảnh qua `Image()` + Canvas; giới hạn 25 megapixel; composite alpha lên nền trắng; tạo bản cover bất biến trong bộ nhớ.
2. Với Chuẩn, mã hóa header `CS` + length 4 byte big-endian + UTF-8 rồi ghi MSB-first tuần tự từ slot 0.
3. Với Nâng cao, tạo payload thô hoặc payload `salt(16) + iv(12) + AES-GCM(ciphertext+tag)`, header `STG1` 9 byte, rồi chọn slot duy nhất từ slot 72 bằng seed 4 byte đầu SHA-256(password + `|stg`) và Fisher-Yates thưa; header luôn tuần tự.
4. Sau khi ghi, xuất PNG; tính pixel changed, MSE/PSNR; render ảnh stego, ảnh difference phóng đại và LSB plane.
5. Giải mã đọc header pixel thật, tự nhận CS/STG1; chế độ nâng cao kiểm tra flag, mật khẩu và authentication tag; mọi lỗi hiển thị gọn.
6. Raw LSB đọc chuỗi byte/hex từ slot theo thứ tự tuần tự để kiểm chứng; Phân tích đếm histogram cặp chẵn/lẻ, tính statistic chi-square và p-value, diễn giải cẩn trọng rằng đây là tín hiệu đáng ngờ chứ không phải bằng chứng tuyệt đối.

## Quy trình build và bàn giao

- Đăng ký diagnostics host-managed cho JavaScript và HTML/CSS trước khi viết mã.
- Chạy server static port 3000, kiểm tra `/` và `/manus-routes.json` trả đúng nội dung.
- Chạy kiểm tra cú pháp JavaScript, kiểm tra route manifest và smoke test các hàm mã hóa/giải mã bằng Node-compatible stubs hoặc browser Preview khi cần.
- Dùng Preview để rà soát giao diện desktop/mobile và các trạng thái quan trọng; sửa các lỗi xác nhận được.
- Commit lên canonical `main` để tạo checkpoint Manus; không bật auto-publish và không tự xuất bản công khai nếu chưa được yêu cầu.

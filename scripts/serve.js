/**
 * 로컬 미리보기용 정적 파일 서버 (GitHub Pages와 동일하게 동작 확인용).
 * 실제 배포는 GitHub Pages가 담당한다. `npm run preview`로 실행.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const port = Number(process.env.PORT || 8811);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

http
  .createServer((req, res) => {
    let filePath = decodeURIComponent(req.url.split("?")[0]);
    if (filePath === "/") filePath = "/index.html";
    const full = path.join(root, filePath);
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found: " + filePath);
        return;
      }
      const ext = path.extname(full);
      res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(port, () => console.log(`preview server: http://localhost:${port}`));

/* Local dev server: static files + the /api/chat function, mirroring Vercel.
   Not used in production — .vercelignore excludes it. */
const http = require("http");
const fs = require("fs");
const path = require("path");

try {
  const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
  const m = env.match(/OPENROUTER_API_KEY=(\S+)/);
  if (m) process.env.OPENROUTER_API_KEY = m[1];
} catch {}

const handler = require("./api/chat.js");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };

http.createServer((req, res) => {
  if (req.url.startsWith("/api/chat")) {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }
      res.status = c => ((res.statusCode = c), res);
      res.json = o => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
      handler(req, res);
    });
    return;
  }
  let f = req.url.split("?")[0];
  if (f === "/") f = "/index.html";
  fs.readFile(path.join(__dirname, f), (e, data) => {
    if (e) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("Content-Type", MIME[path.extname(f)] || "application/octet-stream");
    res.end(data);
  });
}).listen(8502, () => console.log("DealAmigo dev server on http://localhost:8502"));

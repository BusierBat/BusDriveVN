const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

// Chi can xet file ma trinh duyet dang chay (code + shell). Bo generated/ va asset qua lon.
const BUILD_SCAN_PATHS = ['index.html', 'style.css', 'js'];

function computeBuildId() {
  let max = 0;
  const scan = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      let entries = [];
      try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
      for (const e of entries) scan(path.join(p, e.name));
    } else if (/\.(js|mjs|html|css)$/.test(p)) {
      if (st.mtimeMs > max) max = st.mtimeMs;
    }
  };
  for (const rel of BUILD_SCAN_PATHS) scan(path.join(ROOT, rel));
  return Math.floor(max);
}

const VERSIONED_RE = /^\/v\d+(\/.*)?$/;

const server = http.createServer((req, res) => {
  // Bo ?query va #hash di truoc khi map len dia. Neu khong thi /?v=1 -> "khong tim thay file".
  const urlPath = decodeURIComponent(req.url.split('?')[0].split('#')[0]);

  const versioned = urlPath.match(VERSIONED_RE);
  if (!versioned) {
    // / -> /v<buildId>/  (buildId = mtime moi nhat cua code).
    // Moi lan sua code la buildId doi -> URL doi -> cache key doi -> trinh duyet PHAI
    // tai lai. Can thiet vi entry cache cu (do python -m http.server tao ra, khong co
    // Cache-Control) van con han su dung tu heuristic cua Last-Modified va Chrome khong
    // bao gio gui request moi cho den khi no het han (may gio sau). Clear-Site-Data khong
    // duoc Chromium nay xu ly da test, nen dung cach nay — chac chan hoat dong.
    const target = '/v' + computeBuildId() + (urlPath === '/' ? '/' : urlPath);
    res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  const rest = versioned[1] || '/';
  const relPath = rest === '/' ? 'index.html' : rest.replace(/^\/+/, '');
  const filePath = path.join(ROOT, relPath);

  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404); res.end('Not Found');
      } else if (err.code === 'EISDIR') {
        // bus.js:474 fetch NGUYEN thu muc `assets/textures/bus/bus_npc/` roi parse cac
        // <a href> tim file .png de biet co skin gi (giong hinh thuc `python -m http.server`
        // van tra). Neu tra 404/500 thi npcSkinPromise bi reject va game rot ve knownSkins
        // co dinh -> khong discover duoc skin moi trong thu muc. Phai tra listing HTML.
        let entries = null;
        try { entries = fs.readdirSync(filePath, { withFileTypes: true }); } catch { entries = null; }
        if (entries === null) { res.writeHead(500); res.end('Server Error'); return; }
        const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const items = entries
          .filter((e) => e.isFile())
          .map((e) => `<li><a href="${esc(encodeURIComponent(e.name))}">${esc(e.name)}</a></li>`)
          .join('\n');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Index of ${esc(relPath)}</title></head><body><h1>Index of ${esc(relPath)}</h1><hr><pre><ul>\n${items}\n</ul></pre><hr></body></html>`);
      } else {
        res.writeHead(500); res.end('Server Error');
      }
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});

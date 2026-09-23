/* REGNVM — a small server that serves the game and keeps the tables.
   No dependencies. Node 18 or newer.

   Run locally:   node server.js        → http://localhost:3000
   On Render:     build command (none), start command: node server.js
*/

const http = require("http");
const fs   = require("fs");
const path = require("path");

const PORT   = process.env.PORT || 3000;
const PAGE   = path.join(__dirname, "regnum.html");
const MAXAGE = 12 * 60 * 60 * 1000;   /* a table left untouched for 12 hours is cleared away */
const MAXDOC = 800 * 1024;            /* a single table's state */
const MAXROOMS = 400;

/* path -> { data, at } */
const store = new Map();

function sweep(){
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > MAXAGE) store.delete(k);
  if (store.size > MAXROOMS) {
    const old = [...store.entries()].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < old.length - MAXROOMS; i++) store.delete(old[i][0]);
  }
}
setInterval(sweep, 10 * 60 * 1000).unref();

function send(res, code, body, type){
  const b = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(b);
}

function readBody(req, limit, cb){
  let n = 0; const chunks = [];
  req.on("data", c => {
    n += c.length;
    if (n > limit) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
    catch (e) { cb(e); }
  });
  req.on("error", e => cb(e));
}

const okPath = p => typeof p === "string" && /^[A-Za-z0-9_\-]+\/[A-Za-z0-9_\-]+$/.test(p) && p.length < 120;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");

  if (req.method === "OPTIONS") return send(res, 204, "");

  /* the game itself */
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return fs.readFile(PAGE, (err, buf) => {
      if (err) return send(res, 500, "regnum.html is missing next to server.js", "text/plain");
      send(res, 200, buf, "text/html; charset=utf-8");
    });
  }

  /* is there a server on this origin? */
  if (url.pathname === "/api/ping") return send(res, 200, { ok: true, rooms: store.size });

  /* read one document */
  if (req.method === "GET" && url.pathname === "/api/doc") {
    const p = url.searchParams.get("path");
    if (!okPath(p)) return send(res, 400, { error: "bad path" });
    const hit = store.get(p);
    return send(res, 200, hit ? { exists: true, data: hit.data } : { exists: false, data: null });
  }

  /* write one document */
  if (req.method === "POST" && url.pathname === "/api/doc") {
    return readBody(req, MAXDOC, (err, body) => {
      if (err) return send(res, 400, { error: "bad body" });
      if (!okPath(body && body.path)) return send(res, 400, { error: "bad path" });
      store.set(body.path, { data: body.data, at: Date.now() });
      send(res, 200, { ok: true });
    });
  }

  /* list the tables */
  if (req.method === "GET" && url.pathname === "/api/list") {
    const prefix = (url.searchParams.get("prefix") || "").replace(/[^A-Za-z0-9_\-]/g, "");
    const limit  = Math.min(parseInt(url.searchParams.get("limit") || "24", 10) || 24, 50);
    const now = Date.now();
    const docs = [];
    for (const [k, v] of store) {
      if (!k.startsWith(prefix + "/")) continue;
      const id = k.slice(prefix.length + 1);
      if (id.charAt(0) === "_") continue;
      if (now - v.at > MAXAGE) continue;
      docs.push({ id, data: v.data, at: v.at });
    }
    docs.sort((a, b) => b.at - a.at);
    return send(res, 200, { docs: docs.slice(0, limit).map(d => ({ id: d.id, data: d.data })) });
  }

  send(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log("REGNVM listening on " + PORT));

// Fire Res is a Myth: guild site server. No dependencies, Node 18+.
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PASSWORD = process.env.ADMIN_PASSWORD;
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const SITE_PASSWORD = process.env.SITE_PASSWORD || "friamwinsagain"; // password to enter the site at all
if (!PASSWORD || PASSWORD.length < 8) { console.error("Set ADMIN_PASSWORD (at least 8 characters)."); process.exit(1); }

fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, "data.json");
let state = { version: 0, data: { members: [], items: [], loot: [] } };
try { state = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) {}

function persist() {
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + ".bak");
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE);
}

const sha = s => crypto.createHash("sha256").update(String(s)).digest();
function authed(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  return !!m && crypto.timingSafeEqual(sha(m[1]), sha(PASSWORD));
}

const siteToken = crypto.createHmac("sha256", SITE_PASSWORD).update("fire-res-site-v1").digest("hex");
function inSite(req) {
  const m = /(?:^|;\s*)fr_site=([0-9a-f]{64})/.exec(req.headers.cookie || "");
  return !!m && crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(siteToken));
}
const fails = new Map(); // ip -> [timestamps]
function ipOf(req) {
  if (TRUST_PROXY && req.headers["x-forwarded-for"]) return req.headers["x-forwarded-for"].split(",")[0].trim();
  return req.socket.remoteAddress;
}
function blocked(ip) {
  const now = Date.now(), list = (fails.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  fails.set(ip, list);
  return list.length >= 10;
}

function send(res, code, body, type = "application/json", extra = {}) {
  res.writeHead(code, {
    ...extra,
    "Content-Type": type + "; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function valid(d) {
  const ok = (a, max) => Array.isArray(a) && a.length <= max && a.every(x => x && typeof x === "object" && !Array.isArray(x));
  return d && ok(d.members, 500) && ok(d.items, 60000) && ok(d.loot, 60000);
}

const INDEX = path.join(__dirname, "public", "index.html");
const GATE = path.join(__dirname, "public", "gate.html");

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/enter" && req.method === "POST") {
      const ip = ipOf(req);
      if (blocked(ip)) return send(res, 429, { error: "too many attempts" });
      let body;
      try { body = JSON.parse(await readBody(req, 10000)); } catch (e) { return send(res, 400, { error: "bad request" }); }
      if (typeof body.password === "string" && crypto.timingSafeEqual(sha(body.password), sha(SITE_PASSWORD))) {
        const secure = req.socket.encrypted || (TRUST_PROXY && req.headers["x-forwarded-proto"] === "https");
        const cookie = `fr_site=${siteToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}${secure ? "; Secure" : ""}`;
        return send(res, 200, { ok: true }, "application/json", { "Set-Cookie": cookie });
      }
      fails.get(ip).push(Date.now());
      return send(res, 401, { error: "wrong password" });
    }
    if (!inSite(req)) {
      if ((url.pathname === "/" || url.pathname === "/index.html") && req.method === "GET") {
        return send(res, 200, fs.readFileSync(GATE, "utf8"), "text/html");
      }
      return send(res, 401, { error: "site" });
    }
    if (url.pathname === "/api/data" && req.method === "GET") {
      if (url.searchParams.get("since") === String(state.version)) return send(res, 200, { unchanged: true });
      return send(res, 200, state);
    }
    if (url.pathname === "/api/login" && req.method === "POST") {
      const ip = ipOf(req);
      if (blocked(ip)) return send(res, 429, { error: "too many attempts" });
      if (authed(req)) return send(res, 200, { ok: true });
      fails.get(ip).push(Date.now());
      return send(res, 401, { error: "wrong password" });
    }
    if (url.pathname === "/api/data" && req.method === "PUT") {
      const ip = ipOf(req);
      if (blocked(ip)) return send(res, 429, { error: "too many attempts" });
      if (!authed(req)) { fails.get(ip).push(Date.now()); return send(res, 401, { error: "not authorised" }); }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: "bad request" }); }
      if (!valid(body.data)) return send(res, 400, { error: "invalid data" });
      if (body.baseVersion !== state.version) return send(res, 409, state);
      state = { version: state.version + 1, data: { members: body.data.members, items: body.data.items, loot: body.data.loot } };
      persist();
      return send(res, 200, { version: state.version });
    }
    if ((url.pathname === "/" || url.pathname === "/index.html") && req.method === "GET") {
      return send(res, 200, fs.readFileSync(INDEX, "utf8"), "text/html");
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: "server error" });
  }
}).listen(PORT, () => console.log("Guild site running on port " + PORT));

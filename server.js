const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = process.cwd();
const CSV_PATH = path.join(ROOT_DIR, "list.csv");
const DATA_DIR = path.join(ROOT_DIR, "data");
const JSON_PATH = path.join(DATA_DIR, "list.json");
const RUNTIME_JSON_PATH = process.env.VERCEL ? path.join("/tmp", "list.json") : JSON_PATH;
const ENV_PATH = path.join(ROOT_DIR, ".env");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const REQUIRED_HEADERS = ["이름", "이메일", "반", "참여날짜", "전화번호"];
const ADMIN_USER = "admin";
const ALLOWED_DATES = new Set(["30일(토)", "31일(일)"]);
const SUPABASE_TABLE = "participants";
const sessions = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    return;
  }

  const envText = fs.readFileSync(ENV_PATH, "utf8");
  envText.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      return;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        value += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  const [headers = [], ...dataRows] = rows;
  const cleanHeaders = headers.map((header) => header.trim());

  return dataRows
    .map((dataRow) => {
      const record = {};
      cleanHeaders.forEach((header, index) => {
        record[header] = (dataRow[index] || "").trim();
      });
      return record;
    })
    .filter((record) => Object.values(record).some((field) => field !== ""));
}

function scoreCsvText(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  return REQUIRED_HEADERS.reduce((score, header) => {
    return score + (firstLine.includes(header) ? 1 : 0);
  }, 0);
}

function readCsvText() {
  const buffer = fs.readFileSync(CSV_PATH);
  const candidates = ["utf-8", "euc-kr", "windows-949"];
  let best = "";
  let bestScore = -1;

  for (const encoding of candidates) {
    const text = new TextDecoder(encoding).decode(buffer);
    const score = scoreCsvText(text);
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }

  return best;
}

function importParticipantsFromCsv() {
  const csv = readCsvText();
  return parseCsv(csv).map((record, index) => ({
    id: index + 1,
    name: record["이름"] || "",
    email: record["이메일"] || "",
    className: record["반"] || "",
    date: record["참여날짜"] || "",
    phone: record["전화번호"] || ""
  }));
}

function saveParticipants(nextParticipants) {
  fs.mkdirSync(path.dirname(RUNTIME_JSON_PATH), { recursive: true });
  fs.writeFileSync(RUNTIME_JSON_PATH, JSON.stringify(nextParticipants, null, 2), "utf8");
}

function loadParticipants() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(RUNTIME_JSON_PATH)) {
    const json = fs.readFileSync(RUNTIME_JSON_PATH, "utf8");
    return JSON.parse(json);
  }

  if (fs.existsSync(JSON_PATH)) {
    const json = fs.readFileSync(JSON_PATH, "utf8");
    return JSON.parse(json);
  }

  const participants = importParticipantsFromCsv();
  saveParticipants(participants);
  return participants;
}

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || "",
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""
  };
}

function isSupabaseEnabled() {
  const config = getSupabaseConfig();
  return Boolean(config.url && config.key);
}

loadEnv();
let participants = isSupabaseEnabled() ? [] : loadParticipants();

function toDbRow(participant, includeId = false) {
  const row = {
    name: participant.name,
    email: participant.email,
    class_name: participant.className,
    date: participant.date,
    phone: participant.phone
  };

  if (includeId) {
    row.id = participant.id;
  }

  return row;
}

function fromDbRow(row) {
  return {
    id: row.id,
    name: row.name || "",
    email: row.email || "",
    className: row.class_name || "",
    date: row.date || "",
    phone: row.phone || ""
  };
}

async function supabaseRequest(pathname, options = {}) {
  const config = getSupabaseConfig();
  const baseUrl = config.url.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, {
    method: options.method || "GET",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getParticipants() {
  if (!isSupabaseEnabled()) {
    return participants;
  }

  const rows = await supabaseRequest(`${SUPABASE_TABLE}?select=*&order=id.asc`);
  return rows.map(fromDbRow);
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

async function searchParticipants(params) {
  const name = normalize(params.get("name"));
  const phone = normalizePhone(params.get("phone"));

  if (!name && !phone) {
    return [];
  }

  const currentParticipants = await getParticipants();
  return currentParticipants.filter((participant) => {
    const nameMatches = !name || normalize(participant.name).includes(name);
    const phoneMatches = !phone || normalizePhone(participant.phone).includes(phone);
    return nameMatches && phoneMatches;
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": MIME_TYPES[".json"] });
  response.end(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function getSummary() {
  return getSummaryFor(participants);
}

function getSummaryFor(currentParticipants) {
  return {
    saturday: currentParticipants.filter((participant) => participant.date === "30일(토)").length,
    sunday: currentParticipants.filter((participant) => participant.date === "31일(일)").length
  };
}

function getNextParticipantId(currentParticipants) {
  return currentParticipants.reduce((maxId, participant) => Math.max(maxId, Number(participant.id) || 0), 0) + 1;
}

async function createParticipant(body) {
  const currentParticipants = await getParticipants();
  const participant = {
    id: getNextParticipantId(currentParticipants),
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim(),
    className: String(body.className || "").trim(),
    date: String(body.date || "").trim(),
    phone: String(body.phone || "").trim()
  };

  if (!participant.name || !participant.phone || !ALLOWED_DATES.has(participant.date)) {
    return null;
  }

  if (isSupabaseEnabled()) {
    const rows = await supabaseRequest(SUPABASE_TABLE, {
      method: "POST",
      body: toDbRow(participant),
      prefer: "return=representation"
    });
    return fromDbRow(rows[0]);
  }

  participants.push(participant);
  saveParticipants(participants);
  return participant;
}

async function sendExcel(response, date) {
  const title = date === "30일(토)" ? "토요일 명단" : "일요일 명단";
  const rows = (await getParticipants()).filter((participant) => participant.date === date);
  const bodyRows = rows
    .map(
      (participant) => `
        <tr>
          <td>${escapeHtml(participant.name)}</td>
          <td>${escapeHtml(participant.phone)}</td>
          <td>${escapeHtml(participant.className)}</td>
          <td>${escapeHtml(participant.date)}</td>
          <td>${escapeHtml(participant.email)}</td>
        </tr>`
    )
    .join("");
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      table { border-collapse: collapse; }
      th, td { border: 1px solid #999; padding: 6px 10px; }
      th { background: #eef2f7; }
    </style>
  </head>
  <body>
    <table>
      <thead>
        <tr>
          <th>이름</th>
          <th>전화번호</th>
          <th>반</th>
          <th>참여날짜</th>
          <th>이메일</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </body>
</html>`;

  response.writeHead(200, {
    "Content-Type": "application/vnd.ms-excel; charset=utf-8",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(title)}.xls"`,
    "Cache-Control": "no-store"
  });
  response.end(`\uFEFF${html}`);
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, cookie) => {
    const separator = cookie.indexOf("=");
    if (separator === -1) {
      return cookies;
    }

    const key = cookie.slice(0, separator).trim();
    const value = cookie.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function isLoggedIn(request) {
  const cookies = parseCookies(request.headers.cookie);
  return Boolean(cookies.admin_session && sessions.has(cookies.admin_session));
}

function requireAdmin(request, response) {
  if (isLoggedIn(request)) {
    return true;
  }

  sendJson(response, 401, { ok: false, message: "관리자 로그인이 필요합니다." });
  return false;
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function setSessionCookie(response, sessionId) {
  response.setHeader(
    "Set-Cookie",
    `admin_session=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=7200`
  );
}

function clearSessionCookie(response) {
  response.setHeader(
    "Set-Cookie",
    "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
  );
}

function createSession() {
  const sessionId = crypto.randomBytes(32).toString("hex");
  sessions.set(sessionId, { createdAt: Date.now() });
  return sessionId;
}

async function updateParticipantDate(id, date) {
  if (isSupabaseEnabled()) {
    const rows = await supabaseRequest(`${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { date },
      prefer: "return=representation"
    });
    return rows[0] ? fromDbRow(rows[0]) : null;
  }

  const participant = participants.find((person) => person.id === id);
  if (!participant) {
    return null;
  }

  participant.date = date;
  saveParticipants(participants);
  return participant;
}

function sendStatic(requestPath, response) {
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
  });
}

async function replaceParticipantsFromCsv() {
  const importedParticipants = importParticipantsFromCsv();

  if (isSupabaseEnabled()) {
    await supabaseRequest(`${SUPABASE_TABLE}?id=gte.0`, {
      method: "DELETE",
      prefer: "return=minimal"
    });

    if (importedParticipants.length > 0) {
      await supabaseRequest(SUPABASE_TABLE, {
        method: "POST",
        body: importedParticipants.map((participant) => toDbRow(participant)),
        prefer: "return=minimal"
      });
    }

    return importedParticipants;
  }

  participants = importedParticipants;
  saveParticipants(participants);
  return participants;
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/admin/me") {
      sendJson(response, 200, { loggedIn: isLoggedIn(request) });
      return;
    }

    if (url.pathname === "/api/admin/login" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        const configuredPassword = process.env.ADMIN_PASSWORD || "";

        if (!configuredPassword) {
          sendJson(response, 500, { ok: false, message: ".env에 관리자 비밀번호가 없습니다." });
          return;
        }

        const userMatches = body.username === ADMIN_USER;
        const passwordMatches = safeCompare(body.password || "", configuredPassword);

        if (!userMatches || !passwordMatches) {
          sendJson(response, 401, { ok: false, message: "아이디 또는 비밀번호가 올바르지 않습니다." });
          return;
        }

        setSessionCookie(response, createSession());
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, 400, { ok: false, message: "요청 형식이 올바르지 않습니다." });
      }
      return;
    }

    if (url.pathname === "/api/admin/logout" && request.method === "POST") {
      const cookies = parseCookies(request.headers.cookie);
      if (cookies.admin_session) {
        sessions.delete(cookies.admin_session);
      }
      clearSessionCookie(response);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/admin/list") {
      if (!requireAdmin(request, response)) {
        return;
      }
      const currentParticipants = await getParticipants();
      sendJson(response, 200, {
        total: currentParticipants.length,
        summary: getSummaryFor(currentParticipants),
        results: currentParticipants
      });
      return;
    }

    if (url.pathname === "/api/admin/participant" && request.method === "POST") {
      if (!requireAdmin(request, response)) {
        return;
      }

      try {
        const body = await readJsonBody(request);
        const participant = await createParticipant(body);
        if (!participant) {
          sendJson(response, 400, {
            ok: false,
            message: "이름, 전화번호, 참여날짜를 확인해 주세요."
          });
          return;
        }

        const currentParticipants = await getParticipants();
        sendJson(response, 201, { ok: true, participant, summary: getSummaryFor(currentParticipants) });
      } catch (error) {
        sendJson(response, 400, { ok: false, message: "요청 형식이 올바르지 않습니다." });
      }
      return;
    }

    if (url.pathname === "/api/admin/export") {
      if (!requireAdmin(request, response)) {
        return;
      }

      const dateKey = url.searchParams.get("date");
      const date = dateKey === "saturday" ? "30일(토)" : dateKey === "sunday" ? "31일(일)" : "";
      if (!date) {
        sendJson(response, 400, { ok: false, message: "다운로드할 날짜가 올바르지 않습니다." });
        return;
      }

      await sendExcel(response, date);
      return;
    }

    if (url.pathname === "/api/admin/date" && request.method === "PATCH") {
      if (!requireAdmin(request, response)) {
        return;
      }

      try {
        const body = await readJsonBody(request);
        const id = Number(body.id);
        const date = String(body.date || "");

        if (!Number.isInteger(id) || !ALLOWED_DATES.has(date)) {
          sendJson(response, 400, { ok: false, message: "수정할 데이터가 올바르지 않습니다." });
          return;
        }

        const participant = await updateParticipantDate(id, date);
        if (!participant) {
          sendJson(response, 404, { ok: false, message: "대상을 찾을 수 없습니다." });
          return;
        }

        sendJson(response, 200, { ok: true, participant });
      } catch (error) {
        sendJson(response, 400, { ok: false, message: "요청 형식이 올바르지 않습니다." });
      }
      return;
    }

    if (url.pathname === "/api/search") {
      const results = await searchParticipants(url.searchParams);
      const currentParticipants = await getParticipants();
      sendJson(response, 200, {
        total: currentParticipants.length,
        count: results.length,
        results
      });
      return;
    }

    if (url.pathname === "/api/reload" && request.method === "POST") {
      if (!requireAdmin(request, response)) {
        return;
      }

      const currentParticipants = await replaceParticipantsFromCsv();
      sendJson(response, 200, { ok: true, total: currentParticipants.length });
      return;
    }

    sendStatic(decodeURIComponent(url.pathname), response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { ok: false, message: "서버 오류가 발생했습니다." });
  }
}

if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`Loaded ${participants.length} participants into ${RUNTIME_JSON_PATH}`);
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = handleRequest;

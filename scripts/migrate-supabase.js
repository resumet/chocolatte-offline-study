const fs = require("fs");
const path = require("path");

const ROOT_DIR = process.cwd();
const ENV_PATH = path.join(ROOT_DIR, ".env");
const JSON_PATH = path.join(ROOT_DIR, "data", "list.json");
const TABLE = "participants";

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    return;
  }

  fs.readFileSync(ENV_PATH, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
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

      process.env[key] = process.env[key] || value;
    });
}

function toDbRow(participant) {
  return {
    name: participant.name || "",
    email: participant.email || "",
    class_name: participant.className || "",
    date: participant.date || "",
    phone: participant.phone || ""
  };
}

async function supabaseRequest(pathname, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${pathname}`, {
    method: options.method || "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function main() {
  loadEnv();

  const participants = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  await supabaseRequest(`${TABLE}?id=gte.0`, {
    method: "DELETE",
    prefer: "return=minimal"
  });

  if (participants.length > 0) {
    await supabaseRequest(TABLE, {
      method: "POST",
      body: participants.map(toDbRow),
      prefer: "return=minimal"
    });
  }

  console.log(`Imported ${participants.length} participants into Supabase.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, "../../attached_assets/nail-salon-leads-all-2026-05-01_1777613043488.csv");
const CAMPAIGN_ID = 4;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function parseCSVLine(line) {
  const cols = [];
  let cur = "", inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === "," && !inQuote) { cols.push(cur); cur = ""; }
    else { cur += ch; }
  }
  cols.push(cur);
  return cols;
}

function parseAddress(raw) {
  if (!raw) return { street: null, city: null, state: null, zip: null };
  const parts = raw.split(", ").map(p => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last === "USA" || last === "Mexico" || /^[A-Z]{2,3}$/.test(last)) parts.pop();
  if (parts.length === 0) return { street: null, city: null, state: null, zip: null };
  const stateZipPart = parts[parts.length - 1] || "";
  const m = stateZipPart.match(/^([A-Z]{2})\s+(\d{4,6}(?:-\d{4})?)$/);
  let state = null, zip = null;
  if (m) { state = m[1]; zip = m[2]; parts.pop(); }
  const city = parts.length > 0 ? parts[parts.length - 1] : null;
  const street = parts.length > 1 ? parts.slice(0, -1).join(", ") : null;
  return { street, city, state, zip };
}

async function main() {
  const raw = readFileSync(CSV_PATH, "utf-8");
  const lines = raw.split("\n");
  const header = lines[0].split(",");
  console.log(`Parsing ${lines.length - 1} lines...`);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    const get = col => { const idx = header.indexOf(col); return idx >= 0 ? (cols[idx] || "").trim() : ""; };
    const name = get("name");
    if (!name) continue;
    const phone = get("phone") || "";
    const spaceIdx = name.indexOf(" ");
    const firstName = spaceIdx === -1 ? name : name.slice(0, spaceIdx);
    const lastName = spaceIdx === -1 ? "" : name.slice(spaceIdx + 1);
    const { street, city, state, zip } = parseAddress(get("address"));
    const leadScore = parseInt(get("lead_score")) || null;
    const tier = get("tier") || null;
    const signalTags = get("signal_tags") || null;
    const lat = get("latitude") || null;
    const lng = get("longitude") || null;
    const placeId = get("place_id") || null;
    const website = get("website") || null;
    rows.push([firstName, lastName, phone, name, street, city, state, zip, website, leadScore, tier, signalTags, lat, lng, placeId, CAMPAIGN_ID]);
  }

  console.log(`Parsed ${rows.length} rows. Inserting in batches of 500...`);

  const client = await pool.connect();
  let inserted = 0;
  const BATCH = 500;

  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const placeholders = [];
      const vals = [];
      let p = 1;
      for (const r of batch) {
        placeholders.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14},$${p+15},'new',NOW())`);
        vals.push(...r);
        p += 16;
      }
      const sql = `INSERT INTO leads (first_name,last_name,phone,business,address,city,state,zip,website,lead_score,tier,signal_tags,latitude,longitude,place_id,campaign_id,status,created_at) VALUES ${placeholders.join(",")} ON CONFLICT DO NOTHING`;
      await client.query(sql, vals);
      inserted += batch.length;
      process.stdout.write(`\r  ${inserted}/${rows.length}`);
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`\nDone! ${inserted} leads imported into campaign ${CAMPAIGN_ID}.`);
}

main().catch(err => { console.error(err); process.exit(1); });

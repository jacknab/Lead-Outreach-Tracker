import { readFileSync } from "fs";
import { resolve } from "path";
import { db, leadsTable, campaignsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const CSV_PATH = resolve(
  __dirname,
  "../../attached_assets/nail-salon-leads-all-2026-05-01_1777613043488.csv"
);

function parseAddress(raw: string): {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  if (!raw) return { address: null, city: null, state: null, zip: null };

  // Remove country suffix (USA, Mexico, etc.)
  const parts = raw.split(", ").map((p) => p.trim());
  const last = parts[parts.length - 1];
  if (last === "USA" || last === "Mexico" || last.match(/^[A-Z]{2,3}$/)) {
    parts.pop();
  }

  if (parts.length === 0) return { address: null, city: null, state: null, zip: null };

  // Last remaining part should be "STATE ZIP" e.g. "CA 90746"
  const stateZipPart = parts[parts.length - 1];
  const stateZipMatch = stateZipPart.match(/^([A-Z]{2,3})\s+(\d{4,6}(-\d{4})?)$/);

  let state: string | null = null;
  let zip: string | null = null;
  let cityIdx = parts.length - 2;

  if (stateZipMatch) {
    state = stateZipMatch[1];
    zip = stateZipMatch[2];
    parts.pop();
  } else {
    // Maybe "B.C." or foreign state format — just keep the last part as city
    cityIdx = parts.length - 1;
  }

  const city = parts.length > 0 ? parts[parts.length - 1] : null;
  const street = parts.length > 1 ? parts.slice(0, -1).join(", ") : null;

  return { address: street, city, state, zip };
}

function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, spaceIdx),
    lastName: trimmed.slice(spaceIdx + 1),
  };
}

async function main() {
  console.log("Reading CSV...");
  const raw = readFileSync(CSV_PATH, "utf-8");
  const lines = raw.split("\n");
  const header = lines[0].split(",");
  console.log(`Total rows: ${lines.length - 1}`);
  console.log("Columns:", header.join(", "));

  // Ensure campaign exists
  const CAMPAIGN_NAME = "Nail Salon Outbound 2026";
  let [campaign] = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.name, CAMPAIGN_NAME));

  if (!campaign) {
    console.log("Creating campaign...");
    [campaign] = await db
      .insert(campaignsTable)
      .values({
        name: CAMPAIGN_NAME,
        description: "Outbound campaign targeting nail salons with no digital presence",
        status: "active",
        script: `Hi, may I speak with the owner or manager of [BUSINESS NAME]?

Hi! My name is [AGENT NAME] and I'm calling from Pearl Digital. We work specifically with nail salons and beauty businesses to help them get more clients through online marketing.

I noticed [BUSINESS NAME] and wanted to reach out personally — we have an opening in your area for our client growth program. We've helped salons like yours add 15 to 30 new clients every single month.

Do you have just 2 minutes to hear how it works?`,
        agentGuide: `• Target: Nail salons with no website or minimal online presence
• Signal tags show their digital gaps — use this to your advantage
• Warm opener: "We noticed your salon doesn't have a website yet..."
• Objection "not interested": "Totally understand — most owners felt the same until they saw results"
• Objection "too busy": "I'll be quick — 90 seconds is all I need"
• HOT: Salon owner, interested in more clients → use [3] Hot Lead
• CALLBACK: Schedule for Tue-Thu 10am-2pm when traffic is lower`,
      })
      .returning();
    console.log(`Campaign created: ID ${campaign.id}`);
  } else {
    console.log(`Using existing campaign: ID ${campaign.id}`);
  }

  const campaignId = campaign.id;

  // Parse CSV rows (skip header)
  const rows: (typeof leadsTable.$inferInsert)[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse — handle quoted fields
    const cols: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        cols.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur);

    const get = (col: string) => {
      const idx = header.indexOf(col);
      return idx >= 0 ? (cols[idx] || "").trim() : "";
    };

    const name = get("name");
    const phone = get("phone");
    const address = get("address");
    const website = get("website");
    const leadScore = parseInt(get("lead_score")) || null;
    const tier = get("tier") || null;
    const signalTags = get("signal_tags") || null;
    const latitude = get("latitude") || null;
    const longitude = get("longitude") || null;
    const placeId = get("place_id") || null;

    if (!name) { skipped++; continue; }

    const { firstName, lastName } = splitName(name);
    const parsed = parseAddress(address);

    rows.push({
      firstName,
      lastName,
      phone: phone || "",
      business: name,
      address: parsed.address,
      city: parsed.city,
      state: parsed.state,
      zip: parsed.zip,
      website: website || null,
      leadScore,
      tier,
      signalTags,
      latitude: latitude as unknown as string,
      longitude: longitude as unknown as string,
      placeId,
      status: "new",
      campaignId,
    });
  }

  console.log(`Parsed ${rows.length} valid rows, ${skipped} skipped.`);
  console.log("Inserting in batches of 500...");

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    await db.insert(leadsTable).values(batch).onConflictDoNothing();
    inserted += batch.length;
    process.stdout.write(`\r  ${inserted} / ${rows.length} inserted`);
  }

  console.log(`\nDone! ${inserted} leads imported into campaign ${campaignId}.`);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});

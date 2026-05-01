import { Router } from "express";
import { db, campaignsTable, leadsTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import { CreateCampaignBody } from "@workspace/api-zod";

const router = Router();

router.get("/campaigns", async (req, res) => {
  const campaigns = await db.select().from(campaignsTable).orderBy(campaignsTable.id);

  const result = await Promise.all(
    campaigns.map(async (c) => {
      const [totals] = await db
        .select({ count: count() })
        .from(leadsTable)
        .where(eq(leadsTable.campaignId, c.id));

      const [contacted] = await db
        .select({ count: count() })
        .from(leadsTable)
        .where(
          and(
            eq(leadsTable.campaignId, c.id),
            eq(leadsTable.status, "no_answer")
          )
        );

      const [hotLeads] = await db
        .select({ count: count() })
        .from(leadsTable)
        .where(and(eq(leadsTable.campaignId, c.id), eq(leadsTable.status, "hot_lead")));

      return {
        ...c,
        description: c.description ?? null,
        totalLeads: Number(totals?.count ?? 0),
        contactedLeads: Number(contacted?.count ?? 0),
        hotLeads: Number(hotLeads?.count ?? 0),
        createdAt: c.createdAt.toISOString(),
      };
    })
  );

  res.json(result);
});

router.post("/campaigns", async (req, res) => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const [campaign] = await db.insert(campaignsTable).values(parsed.data).returning();
  res.status(201).json({
    ...campaign,
    description: campaign.description ?? null,
    totalLeads: 0,
    contactedLeads: 0,
    hotLeads: 0,
    createdAt: campaign.createdAt.toISOString(),
  });
});

export default router;

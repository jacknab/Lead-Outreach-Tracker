import { Router } from "express";
import { db, agentsTable, leadsTable } from "@workspace/db";
import { eq, and, or, isNull, lte, ne, sql } from "drizzle-orm";
import {
  CreateAgentBody,
  UpdateAgentStateBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/agents", async (req, res) => {
  const agents = await db.select().from(agentsTable).orderBy(agentsTable.id);
  const result = agents.map((a) => ({
    ...a,
    currentLeadId: a.currentLeadId ?? null,
    createdAt: a.createdAt.toISOString(),
  }));
  res.json(result);
});

router.post("/agents", async (req, res) => {
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const [agent] = await db.insert(agentsTable).values(parsed.data).returning();
  res.status(201).json({ ...agent, createdAt: agent.createdAt.toISOString() });
});

router.get("/agents/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json({ ...agent, currentLeadId: agent.currentLeadId ?? null, createdAt: agent.createdAt.toISOString() });
});

router.patch("/agents/:id/state", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = UpdateAgentStateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const [agent] = await db
    .update(agentsTable)
    .set({ status: parsed.data.status })
    .where(eq(agentsTable.id, id))
    .returning();
  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }
  res.json({ ...agent, currentLeadId: agent.currentLeadId ?? null, createdAt: agent.createdAt.toISOString() });
});

router.post("/agents/:id/assign-lead", async (req, res) => {
  const agentId = parseInt(req.params.id);

  const now = new Date();

  const CAMPAIGN_ID = 4; // Nail Salon Outbound 2026
  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(
      and(
        or(
          eq(leadsTable.status, "new"),
          and(
            eq(leadsTable.status, "callback"),
            lte(leadsTable.callbackAt, now)
          )
        ),
        isNull(leadsTable.assignedAgentId),
        eq(leadsTable.campaignId, CAMPAIGN_ID),
        sql`TRIM(${leadsTable.phone}) != ''`
      )
    )
    .orderBy(sql`lead_score DESC NULLS LAST`)
    .limit(1);

  if (!lead) {
    res.status(204).send();
    return;
  }

  const [updatedLead] = await db
    .update(leadsTable)
    .set({ status: "assigned", assignedAgentId: agentId })
    .where(eq(leadsTable.id, lead.id))
    .returning();

  await db
    .update(agentsTable)
    .set({ currentLeadId: updatedLead.id, status: "idle" })
    .where(eq(agentsTable.id, agentId));

  res.json({
    ...updatedLead,
    assignedAgentId: updatedLead.assignedAgentId ?? null,
    campaignId: updatedLead.campaignId ?? null,
    email: updatedLead.email ?? null,
    business: updatedLead.business ?? null,
    address: updatedLead.address ?? null,
    city: updatedLead.city ?? null,
    state: updatedLead.state ?? null,
    zip: updatedLead.zip ?? null,
    callbackAt: updatedLead.callbackAt?.toISOString() ?? null,
    createdAt: updatedLead.createdAt.toISOString(),
  });
});

router.get("/agents/:id/current-lead", async (req, res) => {
  const agentId = parseInt(req.params.id);
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent || !agent.currentLeadId) {
    res.status(204).send();
    return;
  }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, agent.currentLeadId));
  if (!lead) {
    res.status(204).send();
    return;
  }
  res.json({
    ...lead,
    assignedAgentId: lead.assignedAgentId ?? null,
    campaignId: lead.campaignId ?? null,
    email: lead.email ?? null,
    business: lead.business ?? null,
    address: lead.address ?? null,
    city: lead.city ?? null,
    state: lead.state ?? null,
    zip: lead.zip ?? null,
    callbackAt: lead.callbackAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
  });
});

export default router;

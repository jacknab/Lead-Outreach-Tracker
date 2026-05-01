import { Router } from "express";
import { db, leadsTable, leadNotesTable, agentsTable } from "@workspace/db";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { CreateLeadBody, SetLeadDispositionBody, AddLeadNoteBody } from "@workspace/api-zod";

const router = Router();

function formatLead(lead: typeof leadsTable.$inferSelect) {
  return {
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
  };
}

router.get("/leads", async (req, res) => {
  let query = db.select().from(leadsTable).$dynamic();
  // Always require a non-empty phone number — can't dial without one
  const conditions = [sql`TRIM(${leadsTable.phone}) != ''`];
  if (req.query.status) {
    conditions.push(eq(leadsTable.status, req.query.status as string));
  }
  if (req.query.campaignId) {
    conditions.push(eq(leadsTable.campaignId, parseInt(req.query.campaignId as string)));
  }
  query = query.where(and(...conditions));
  const leads = await query.orderBy(desc(leadsTable.createdAt)).limit(
    req.query.limit ? parseInt(req.query.limit as string) : 50
  );
  res.json(leads.map(formatLead));
});

router.post("/leads", async (req, res) => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const [lead] = await db.insert(leadsTable).values(parsed.data).returning();
  res.status(201).json(formatLead(lead));
});

router.get("/leads/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id));
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json(formatLead(lead));
});

router.patch("/leads/:id/disposition", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = SetLeadDispositionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { disposition, notes, callbackAt, agentId } = parsed.data;

  let newStatus: typeof leadsTable.$inferSelect["status"] = "closed";
  if (disposition === "no_answer") newStatus = "no_answer";
  else if (disposition === "busy") newStatus = "busy";
  else if (disposition === "hot_lead") newStatus = "hot_lead";
  else if (disposition === "callback") newStatus = "callback";
  else if (disposition === "not_interested") newStatus = "not_interested";
  else if (disposition === "closed") newStatus = "closed";

  const updateData: Partial<typeof leadsTable.$inferInsert> = {
    status: newStatus,
    assignedAgentId: null,
  };
  if (callbackAt) updateData.callbackAt = new Date(callbackAt);

  const [updatedLead] = await db
    .update(leadsTable)
    .set(updateData)
    .where(eq(leadsTable.id, id))
    .returning();

  if (!updatedLead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  if (notes) {
    await db.insert(leadNotesTable).values({
      leadId: id,
      agentId: agentId ?? null,
      content: `[${disposition.toUpperCase()}] ${notes}`,
    });
  }

  await db
    .update(agentsTable)
    .set({ currentLeadId: null, status: "wrap_up" })
    .where(eq(agentsTable.id, agentId));

  res.json(formatLead(updatedLead));
});

router.get("/leads/:id/notes", async (req, res) => {
  const id = parseInt(req.params.id);
  const notes = await db
    .select({
      id: leadNotesTable.id,
      leadId: leadNotesTable.leadId,
      agentId: leadNotesTable.agentId,
      content: leadNotesTable.content,
      createdAt: leadNotesTable.createdAt,
      agentName: agentsTable.name,
    })
    .from(leadNotesTable)
    .leftJoin(agentsTable, eq(leadNotesTable.agentId, agentsTable.id))
    .where(eq(leadNotesTable.leadId, id))
    .orderBy(desc(leadNotesTable.createdAt));

  res.json(
    notes.map((n) => ({
      ...n,
      agentId: n.agentId ?? null,
      agentName: n.agentName ?? null,
      createdAt: n.createdAt.toISOString(),
    }))
  );
});

router.post("/leads/:id/notes", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = AddLeadNoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const [note] = await db
    .insert(leadNotesTable)
    .values({ leadId: id, agentId: parsed.data.agentId ?? null, content: parsed.data.content })
    .returning();

  let agentName: string | null = null;
  if (note.agentId) {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, note.agentId));
    agentName = agent?.name ?? null;
  }

  res.status(201).json({ ...note, agentId: note.agentId ?? null, agentName, createdAt: note.createdAt.toISOString() });
});

export default router;

import { Router } from "express";
import { db, callLogsTable, agentsTable, leadsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { CreateCallBody, UpdateCallBody } from "@workspace/api-zod";
import { amiOriginate } from "../ami";

const router = Router();

function formatCall(call: typeof callLogsTable.$inferSelect & { agentName?: string | null; leadName?: string | null }) {
  return {
    ...call,
    agentName: call.agentName ?? null,
    leadName: call.leadName ?? null,
    endTime: call.endTime?.toISOString() ?? null,
    duration: call.duration ?? null,
    result: call.result ?? null,
    dispositionNotes: call.dispositionNotes ?? null,
    amiChannel: call.amiChannel ?? null,
    startTime: call.startTime.toISOString(),
    createdAt: call.createdAt.toISOString(),
  };
}

router.get("/calls", async (req, res) => {
  const conditions = [];
  if (req.query.agentId) conditions.push(eq(callLogsTable.agentId, parseInt(req.query.agentId as string)));
  if (req.query.leadId) conditions.push(eq(callLogsTable.leadId, parseInt(req.query.leadId as string)));

  const calls = await db
    .select({
      id: callLogsTable.id,
      agentId: callLogsTable.agentId,
      leadId: callLogsTable.leadId,
      phoneNumber: callLogsTable.phoneNumber,
      startTime: callLogsTable.startTime,
      endTime: callLogsTable.endTime,
      duration: callLogsTable.duration,
      result: callLogsTable.result,
      dispositionNotes: callLogsTable.dispositionNotes,
      amiChannel: callLogsTable.amiChannel,
      createdAt: callLogsTable.createdAt,
      agentName: agentsTable.name,
      leadFirstName: leadsTable.firstName,
      leadLastName: leadsTable.lastName,
    })
    .from(callLogsTable)
    .leftJoin(agentsTable, eq(callLogsTable.agentId, agentsTable.id))
    .leftJoin(leadsTable, eq(callLogsTable.leadId, leadsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(callLogsTable.startTime))
    .limit(req.query.limit ? parseInt(req.query.limit as string) : 50);

  res.json(
    calls.map((c) =>
      formatCall({
        ...c,
        agentName: c.agentName ?? null,
        leadName: c.leadFirstName && c.leadLastName ? `${c.leadFirstName} ${c.leadLastName}` : null,
      })
    )
  );
});

router.post("/calls", async (req, res) => {
  const parsed = CreateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { agentId, leadId, phoneNumber } = parsed.data;

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));

  if (!agent) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const [call] = await db
    .insert(callLogsTable)
    .values({ agentId, leadId, phoneNumber })
    .returning();

  await db.update(agentsTable).set({ status: "ringing" }).where(eq(agentsTable.id, agentId));
  await db.update(leadsTable).set({ status: "ringing" }).where(eq(leadsTable.id, leadId));

  amiOriginate({
    extension: agent.extension,
    phoneNumber,
    actionId: `call-${call.id}`,
  }).then(async (result) => {
    req.log?.info({ callId: call.id, amiResult: result }, "AMI originate result");
    if (result.success) {
      await db
        .update(callLogsTable)
        .set({ amiChannel: `PJSIP/${agent.extension}` })
        .where(eq(callLogsTable.id, call.id));
    } else {
      req.log?.warn({ callId: call.id, message: result.message }, "AMI originate failed");
    }
  }).catch((err) => {
    req.log?.error({ err }, "AMI originate threw");
  });

  res.status(201).json(
    formatCall({
      ...call,
      agentName: agent?.name ?? null,
      leadName: lead ? `${lead.firstName} ${lead.lastName}` : null,
    })
  );
});

router.patch("/calls/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const parsed = UpdateCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const updateData: Partial<typeof callLogsTable.$inferInsert> = {};
  if (parsed.data.endTime) updateData.endTime = new Date(parsed.data.endTime as unknown as string);
  if (parsed.data.duration !== undefined) updateData.duration = parsed.data.duration;
  if (parsed.data.result) updateData.result = parsed.data.result;
  if (parsed.data.dispositionNotes) updateData.dispositionNotes = parsed.data.dispositionNotes;
  if (parsed.data.amiChannel) updateData.amiChannel = parsed.data.amiChannel;

  const [call] = await db.update(callLogsTable).set(updateData).where(eq(callLogsTable.id, id)).returning();
  if (!call) {
    res.status(404).json({ error: "Call not found" });
    return;
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, call.agentId));
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, call.leadId));

  res.json(
    formatCall({
      ...call,
      agentName: agent?.name ?? null,
      leadName: lead ? `${lead.firstName} ${lead.lastName}` : null,
    })
  );
});

router.get("/calls/lead/:leadId", async (req, res) => {
  const leadId = parseInt(req.params.leadId);
  const calls = await db
    .select({
      id: callLogsTable.id,
      agentId: callLogsTable.agentId,
      leadId: callLogsTable.leadId,
      phoneNumber: callLogsTable.phoneNumber,
      startTime: callLogsTable.startTime,
      endTime: callLogsTable.endTime,
      duration: callLogsTable.duration,
      result: callLogsTable.result,
      dispositionNotes: callLogsTable.dispositionNotes,
      amiChannel: callLogsTable.amiChannel,
      createdAt: callLogsTable.createdAt,
      agentName: agentsTable.name,
      leadFirstName: leadsTable.firstName,
      leadLastName: leadsTable.lastName,
    })
    .from(callLogsTable)
    .leftJoin(agentsTable, eq(callLogsTable.agentId, agentsTable.id))
    .leftJoin(leadsTable, eq(callLogsTable.leadId, leadsTable.id))
    .where(eq(callLogsTable.leadId, leadId))
    .orderBy(desc(callLogsTable.startTime));

  res.json(
    calls.map((c) =>
      formatCall({
        ...c,
        agentName: c.agentName ?? null,
        leadName: c.leadFirstName && c.leadLastName ? `${c.leadFirstName} ${c.leadLastName}` : null,
      })
    )
  );
});

export default router;

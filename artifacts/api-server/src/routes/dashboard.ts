import { Router } from "express";
import { db, agentsTable, leadsTable, callLogsTable } from "@workspace/db";
import { count, eq, and, gte, avg, ne, sql, isNull } from "drizzle-orm";

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalAgentsRow] = await db.select({ count: count() }).from(agentsTable);
  const [activeAgentsRow] = await db
    .select({ count: count() })
    .from(agentsTable)
    .where(ne(agentsTable.status, "offline"));

  const [callsTodayRow] = await db
    .select({ count: count() })
    .from(callLogsTable)
    .where(gte(callLogsTable.startTime, today));

  const [hotLeadsTodayRow] = await db
    .select({ count: count() })
    .from(leadsTable)
    .where(eq(leadsTable.status, "hot_lead"));

  const CAMPAIGN_ID = 4;
  const [totalLeadsRow] = await db
    .select({ count: count() })
    .from(leadsTable)
    .where(eq(leadsTable.campaignId, CAMPAIGN_ID));

  const [pendingLeadsRow] = await db
    .select({ count: count() })
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.status, "new"),
        eq(leadsTable.campaignId, CAMPAIGN_ID),
        isNull(leadsTable.assignedAgentId),
        sql`TRIM(${leadsTable.phone}) != ''`
      )
    );

  const allCalls = await db
    .select({ duration: callLogsTable.duration })
    .from(callLogsTable)
    .where(gte(callLogsTable.startTime, today));

  const durations = allCalls.map((c) => c.duration ?? 0).filter((d) => d > 0);
  const avgCallDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  const totalCalls = Number(callsTodayRow?.count ?? 0);
  const hotLeads = Number(hotLeadsTodayRow?.count ?? 0);
  const conversionRate = totalCalls > 0 ? Math.round((hotLeads / totalCalls) * 100 * 10) / 10 : 0;

  res.json({
    activeAgents: Number(activeAgentsRow?.count ?? 0),
    totalAgents: Number(totalAgentsRow?.count ?? 0),
    callsToday: totalCalls,
    hotLeadsToday: hotLeads,
    totalLeads: Number(totalLeadsRow?.count ?? 0),
    pendingLeads: Number(pendingLeadsRow?.count ?? 0),
    avgCallDuration,
    conversionRate,
  });
});

router.get("/dashboard/agent-stats", async (req, res) => {
  const agents = await db.select().from(agentsTable);

  const result = await Promise.all(
    agents.map(async (agent) => {
      const [hotLeadsRow] = await db
        .select({ count: count() })
        .from(leadsTable)
        .where(
          and(eq(leadsTable.status, "hot_lead"), eq(leadsTable.assignedAgentId, agent.id))
        );

      const calls = await db
        .select({ duration: callLogsTable.duration })
        .from(callLogsTable)
        .where(eq(callLogsTable.agentId, agent.id));

      const durations = calls.map((c) => c.duration ?? 0).filter((d) => d > 0);
      const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

      const hot = Number(hotLeadsRow?.count ?? 0);
      const total = agent.callsToday;
      const conversionRate = total > 0 ? Math.round((hot / total) * 100 * 10) / 10 : 0;

      return {
        agentId: agent.id,
        agentName: agent.name,
        extension: agent.extension,
        status: agent.status,
        callsToday: agent.callsToday,
        hotLeads: hot,
        avgDuration,
        conversionRate,
      };
    })
  );

  res.json(result);
});

router.get("/dashboard/lead-funnel", async (req, res) => {
  const statuses = [
    "new",
    "assigned",
    "ringing",
    "answered",
    "no_answer",
    "busy",
    "hot_lead",
    "callback",
    "closed",
    "not_interested",
  ] as const;

  const [totalRow] = await db.select({ count: count() }).from(leadsTable);
  const total = Number(totalRow?.count ?? 1);

  const result = await Promise.all(
    statuses.map(async (status) => {
      const [row] = await db
        .select({ count: count() })
        .from(leadsTable)
        .where(eq(leadsTable.status, status));
      const cnt = Number(row?.count ?? 0);
      return {
        label: status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        count: cnt,
        percentage: Math.round((cnt / total) * 100 * 10) / 10,
      };
    })
  );

  res.json(result);
});

export default router;

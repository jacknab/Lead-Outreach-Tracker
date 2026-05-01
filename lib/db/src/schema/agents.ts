import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentStatusEnum = pgEnum("agent_status", [
  "idle",
  "ringing",
  "on_call",
  "wrap_up",
  "paused",
  "offline",
]);

export const agentsTable = pgTable("agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  extension: text("extension").notNull().unique(),
  status: agentStatusEnum("status").notNull().default("idle"),
  currentLeadId: integer("current_lead_id"),
  callsToday: integer("calls_today").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ id: true, createdAt: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;

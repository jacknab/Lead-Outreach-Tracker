import { pgTable, serial, text, integer, timestamp, pgEnum, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leadStatusEnum = pgEnum("lead_status", [
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
]);

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  business: text("business"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  status: leadStatusEnum("status").notNull().default("new"),
  assignedAgentId: integer("assigned_agent_id"),
  campaignId: integer("campaign_id"),
  callbackAt: timestamp("callback_at"),
  website: text("website"),
  leadScore: integer("lead_score"),
  tier: text("tier"),
  signalTags: text("signal_tags"),
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  placeId: text("place_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;

# Outbound Call Campaign + Agent State System

## Overview

A full-stack outbound dialer CRM for sales teams. Agents are auto-assigned leads and manually trigger calls via Asterisk AMI integration. Managers see real-time agent status and campaign analytics.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite, TanStack Query, Wouter router, shadcn/ui, Tailwind CSS, Recharts, framer-motion

## Artifacts

- **Dialer frontend** (`artifacts/dialer`) — React + Vite app at `/`
  - `/agent` — Agent Dashboard (auto-assigned lead, Notes, Call History, CALL NOW control panel)
  - `/manager` — Manager Dashboard (live agent status, lead funnel chart, recent call logs)
- **API Server** (`artifacts/api-server`) — Express at `/api`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Database Schema

- `agents` — agent records with status (idle/ringing/on_call/wrap_up/paused/offline), extension, callsToday
- `campaigns` — outbound campaigns with status tracking
- `leads` — lead records with full contact info, status (new/assigned/ringing/answered/no_answer/busy/hot_lead/callback/closed/not_interested), and assignment
- `lead_notes` — notes per lead, linked to agent
- `call_logs` — every call with duration, result, AMI channel reference

## API Routes

- `GET/POST /api/agents` — list and create agents
- `GET /api/agents/:id` — get agent
- `PATCH /api/agents/:id/state` — update agent status
- `POST /api/agents/:id/assign-lead` — auto-assign next available lead
- `GET /api/agents/:id/current-lead` — get current assigned lead
- `GET/POST /api/leads` — list and create leads
- `GET /api/leads/:id` — get lead
- `PATCH /api/leads/:id/disposition` — set call disposition
- `GET/POST /api/leads/:id/notes` — get and add lead notes
- `GET/POST /api/calls` — list and log calls
- `PATCH /api/calls/:id` — update call (end time, duration, result)
- `GET /api/calls/lead/:leadId` — call history for a lead
- `GET/POST /api/campaigns` — list and create campaigns
- `GET /api/dashboard/summary` — live summary stats
- `GET /api/dashboard/agent-stats` — per-agent performance
- `GET /api/dashboard/lead-funnel` — disposition breakdown chart

## Agent Workflow

1. Agent logs in → system auto-assigns next available lead (POST /agents/:id/assign-lead)
2. Lead info shown (name, phone, email, business, address) with Notes and Call History
3. Agent clicks CALL NOW → creates call log, updates agent to "ringing" state
4. After call: select disposition → updates lead status, auto-assigns next lead

## Notes on api-zod index.ts

After running `pnpm --filter @workspace/api-spec run codegen`, the `lib/api-zod/src/index.ts` may need to be reset to:
```ts
export * from "./generated/api";
```
(Orval sometimes regenerates it with stale exports that cause type errors.)

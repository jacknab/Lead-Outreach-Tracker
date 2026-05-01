import { useState } from "react";
import { Link } from "wouter";
import {
  useGetDashboardSummary,
  useGetAgentStats,
  useGetLeadFunnel,
  useListCalls,
  getGetDashboardSummaryQueryKey,
  getGetAgentStatsQueryKey,
  getGetLeadFunnelQueryKey,
  getListCallsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Users, PhoneCall, Flame, Clock, Percent, Target, ArrowRight } from "lucide-react";

export default function ManagerDashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({
    query: { refetchInterval: 5000 }
  });

  const { data: agents, isLoading: isLoadingAgents } = useGetAgentStats({
    query: { refetchInterval: 5000 }
  });

  const { data: funnel, isLoading: isLoadingFunnel } = useGetLeadFunnel({
    query: { refetchInterval: 5000 }
  });

  const { data: recentCalls, isLoading: isLoadingCalls } = useListCalls(
    { limit: 10 },
    { query: { refetchInterval: 5000 } }
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "idle": return <Badge variant="outline" className="bg-slate-800 text-slate-300 border-slate-700">Idle</Badge>;
      case "ringing": return <Badge className="bg-amber-500/20 text-amber-500 border-none">Ringing</Badge>;
      case "on_call": return <Badge className="bg-blue-500/20 text-blue-500 border-none animate-pulse">On Call</Badge>;
      case "wrap_up": return <Badge className="bg-purple-500/20 text-purple-400 border-none">Wrap Up</Badge>;
      case "paused": return <Badge className="bg-red-500/20 text-red-500 border-none">Paused</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="font-mono font-bold text-xl tracking-tight text-primary flex items-center gap-2">
            <Target className="w-6 h-6" />
            DIALER<span className="text-muted-foreground">OPS</span>
          </div>
          <div className="h-6 w-px bg-border mx-2" />
          <h1 className="font-medium text-lg">Manager Overview</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/agent" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
            Agent View <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-6 overflow-auto">
        {/* Top Stat Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard title="Active Agents" value={summary?.activeAgents} total={summary?.totalAgents} icon={<Users className="w-4 h-4 text-blue-500" />} isLoading={isLoadingSummary} />
          <StatCard title="Calls Today" value={summary?.callsToday} icon={<PhoneCall className="w-4 h-4 text-green-500" />} isLoading={isLoadingSummary} />
          <StatCard title="Hot Leads" value={summary?.hotLeadsToday} icon={<Flame className="w-4 h-4 text-amber-500" />} isLoading={isLoadingSummary} />
          <StatCard title="Pending Leads" value={summary?.pendingLeads} total={summary?.totalLeads} icon={<Target className="w-4 h-4 text-purple-500" />} isLoading={isLoadingSummary} />
          <StatCard title="Avg Duration" value={summary?.avgCallDuration ? `${Math.round(summary.avgCallDuration)}s` : '0s'} icon={<Clock className="w-4 h-4 text-cyan-500" />} isLoading={isLoadingSummary} />
          <StatCard title="Conversion" value={summary?.conversionRate ? `${summary.conversionRate}%` : '0%'} icon={<Percent className="w-4 h-4 text-emerald-500" />} isLoading={isLoadingSummary} />
        </div>

        {/* Middle Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Agent Status Table */}
          <Card className="lg:col-span-2 bg-card border-border">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Live Agent Status</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="font-mono text-xs text-muted-foreground">AGENT</TableHead>
                    <TableHead className="font-mono text-xs text-muted-foreground">EXT</TableHead>
                    <TableHead className="font-mono text-xs text-muted-foreground">STATUS</TableHead>
                    <TableHead className="font-mono text-xs text-muted-foreground text-right">CALLS</TableHead>
                    <TableHead className="font-mono text-xs text-muted-foreground text-right">HOT</TableHead>
                    <TableHead className="font-mono text-xs text-muted-foreground text-right">CONV %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingAgents ? (
                    Array(5).fill(0).map((_, i) => (
                      <TableRow key={i} className="border-border/50">
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
                        <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : agents?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No agents found</TableCell>
                    </TableRow>
                  ) : agents?.map((agent) => (
                    <TableRow key={agent.agentId} className="border-border/50 hover:bg-muted/20">
                      <TableCell className="font-medium text-slate-200">{agent.agentName}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{agent.extension}</TableCell>
                      <TableCell>{getStatusBadge(agent.status)}</TableCell>
                      <TableCell className="text-right font-mono">{agent.callsToday}</TableCell>
                      <TableCell className="text-right font-mono text-amber-500">{agent.hotLeads}</TableCell>
                      <TableCell className="text-right font-mono text-emerald-500">{agent.conversionRate}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Lead Funnel */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Lead Funnel</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 h-[300px]">
              {isLoadingFunnel ? (
                <div className="w-full h-full flex items-center justify-center">
                  <Skeleton className="w-full h-full" />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnel || []} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1e293b" />
                    <XAxis type="number" stroke="#64748b" fontSize={12} />
                    <YAxis dataKey="label" type="category" stroke="#94a3b8" fontSize={12} width={100} />
                    <Tooltip
                      cursor={{fill: '#1e293b'}}
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc' }}
                      formatter={(value: number, name: string, props: any) => [`${value} (${props.payload.percentage}%)`, 'Count']}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {
                        (funnel || []).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={getFunnelColor(entry.label)} />
                        ))
                      }
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bottom Row - Call Logs */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Recent Calls</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="font-mono text-xs text-muted-foreground">TIME</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground">AGENT</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground">LEAD</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground">PHONE</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground text-right">DURATION</TableHead>
                  <TableHead className="font-mono text-xs text-muted-foreground">RESULT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingCalls ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i} className="border-border/50">
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    </TableRow>
                  ))
                ) : recentCalls?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No recent calls</TableCell>
                  </TableRow>
                ) : recentCalls?.map((call) => (
                  <TableRow key={call.id} className="border-border/50 hover:bg-muted/20">
                    <TableCell className="font-mono text-muted-foreground text-sm">
                      {format(new Date(call.startTime), 'HH:mm:ss')}
                    </TableCell>
                    <TableCell className="font-medium text-slate-200">{call.agentName}</TableCell>
                    <TableCell className="text-slate-300">{call.leadName || 'Unknown'}</TableCell>
                    <TableCell className="font-mono text-muted-foreground">{call.phoneNumber}</TableCell>
                    <TableCell className="text-right font-mono text-slate-300">{call.duration ? `${call.duration}s` : '-'}</TableCell>
                    <TableCell>
                      {call.result ? (
                        <Badge variant="outline" className={getResultColor(call.result)}>
                          {call.result}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm italic">In progress</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function StatCard({ title, value, total, icon, isLoading }: { title: string, value?: number | string, total?: number, icon: React.ReactNode, isLoading: boolean }) {
  return (
    <Card className="bg-card border-border overflow-hidden relative group">
      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
        {icon}
      </div>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {isLoading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-mono font-bold text-slate-100">{value !== undefined ? value : '-'}</span>
            {total !== undefined && (
              <span className="text-sm font-mono text-muted-foreground">/ {total}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getFunnelColor(label: string) {
  const colors: Record<string, string> = {
    'New': '#3b82f6',
    'Assigned': '#6366f1',
    'Contacted': '#8b5cf6',
    'Hot Lead': '#f59e0b',
    'Closed': '#10b981',
    'Not Interested': '#ef4444',
  };
  return colors[label] || '#64748b';
}

function getResultColor(result: string) {
  switch(result) {
    case 'hot_lead': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
    case 'closed': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
    case 'not_interested': return 'bg-red-500/10 text-red-500 border-red-500/20';
    case 'no_answer': 
    case 'busy': return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    case 'callback': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

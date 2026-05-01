import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { 
  Phone, User, Building2, MapPin, Mail, Hash, PhoneCall, 
  PhoneOff, Save, KeyRound, Clock, Activity, AlertCircle, ArrowRight
} from "lucide-react";

import {
  useGetAgent,
  useGetAgentCurrentLead,
  useGetLeadNotes,
  useGetLeadCallHistory,
  useUpdateAgentState,
  useAssignNextLead,
  useCreateCall,
  useUpdateCall,
  useSetLeadDisposition,
  useAddLeadNote,
  getGetAgentQueryKey,
  getGetAgentCurrentLeadQueryKey,
  getGetLeadNotesQueryKey,
  getGetLeadCallHistoryQueryKey
} from "@workspace/api-client-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const AGENT_ID = 1; // Hardcoded for demo

const noteSchema = z.object({
  content: z.string().min(1, "Note cannot be empty")
});

const dispositionSchema = z.object({
  disposition: z.enum(["no_answer", "busy", "hot_lead", "callback", "not_interested", "closed"], {
    required_error: "Select a disposition"
  }),
  notes: z.string().optional(),
});

export default function AgentDashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Queries
  const { data: agent, isLoading: isLoadingAgent } = useGetAgent(AGENT_ID, {
    query: { refetchInterval: 3000 }
  });

  const { data: lead, isLoading: isLoadingLead } = useGetAgentCurrentLead(AGENT_ID, {
    query: { refetchInterval: 3000 }
  });

  const { data: notes, isLoading: isLoadingNotes } = useGetLeadNotes(lead?.id || 0, {
    query: { 
      enabled: !!lead?.id,
      queryKey: getGetLeadNotesQueryKey(lead?.id || 0)
    }
  });

  const { data: callHistory, isLoading: isLoadingHistory } = useGetLeadCallHistory(lead?.id || 0, {
    query: {
      enabled: !!lead?.id,
      queryKey: getGetLeadCallHistoryQueryKey(lead?.id || 0)
    }
  });

  // Mutations
  const updateAgentState = useUpdateAgentState();
  const assignNextLead = useAssignNextLead();
  const createCall = useCreateCall();
  const updateCall = useUpdateCall();
  const setDisposition = useSetLeadDisposition();
  const addNote = useAddLeadNote();

  // Local State
  const [activeCallId, setActiveCallId] = useState<number | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Forms
  const noteForm = useForm<z.infer<typeof noteSchema>>({
    resolver: zodResolver(noteSchema),
    defaultValues: { content: "" }
  });

  const dispositionForm = useForm<z.infer<typeof dispositionSchema>>({
    resolver: zodResolver(dispositionSchema),
    defaultValues: { notes: "" }
  });

  // Call Timer Effect
  useEffect(() => {
    if (agent?.status === "on_call" && !timerRef.current) {
      timerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else if (agent?.status !== "on_call" && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [agent?.status]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleCall = async () => {
    if (!lead || !agent) return;
    
    try {
      updateAgentState.mutate({ id: AGENT_ID, data: { status: "ringing" } });
      
      const call = await createCall.mutateAsync({
        data: {
          agentId: AGENT_ID,
          leadId: lead.id,
          phoneNumber: lead.phone
        }
      });
      
      setActiveCallId(call.id);
      
      // Simulate ringing -> answered after a short delay
      setTimeout(() => {
        updateAgentState.mutate({ id: AGENT_ID, data: { status: "on_call" } });
      }, 1500);
      
    } catch (error) {
      toast({ title: "Call failed to initiate", variant: "destructive" });
      updateAgentState.mutate({ id: AGENT_ID, data: { status: "idle" } });
    }
  };

  const handleHangup = async () => {
    if (!activeCallId) return;
    
    try {
      await updateCall.mutateAsync({
        id: activeCallId,
        data: { duration: callDuration }
      });
      
      updateAgentState.mutate({ id: AGENT_ID, data: { status: "wrap_up" } });
      setActiveCallId(null);
      setCallDuration(0);
    } catch (error) {
      toast({ title: "Error hanging up", variant: "destructive" });
    }
  };

  const onSubmitDisposition = async (data: z.infer<typeof dispositionSchema>) => {
    if (!lead) return;
    
    try {
      await setDisposition.mutateAsync({
        id: lead.id,
        data: {
          disposition: data.disposition,
          notes: data.notes,
          agentId: AGENT_ID
        }
      });
      
      if (activeCallId) {
        await updateCall.mutateAsync({
          id: activeCallId,
          data: { result: data.disposition, dispositionNotes: data.notes }
        });
      }

      await assignNextLead.mutateAsync({ id: AGENT_ID });
      
      dispositionForm.reset();
      toast({ title: "Disposition saved", description: "Loading next lead..." });
      
      queryClient.invalidateQueries({ queryKey: getGetAgentCurrentLeadQueryKey(AGENT_ID) });
      
    } catch (error) {
      toast({ title: "Error saving disposition", variant: "destructive" });
    }
  };

  const onSubmitNote = async (data: z.infer<typeof noteSchema>) => {
    if (!lead) return;
    
    try {
      await addNote.mutateAsync({
        id: lead.id,
        data: { content: data.content, agentId: AGENT_ID }
      });
      
      noteForm.reset();
      queryClient.invalidateQueries({ queryKey: getGetLeadNotesQueryKey(lead.id) });
      toast({ title: "Note added" });
    } catch (error) {
      toast({ title: "Error adding note", variant: "destructive" });
    }
  };

  const isCallActive = agent?.status === "on_call" || agent?.status === "ringing";
  const needsDisposition = agent?.status === "wrap_up";

  return (
    <div className="min-h-screen bg-[#0f111a] text-slate-300 font-sans flex flex-col selection:bg-blue-500/30">
      {/* Header StatusBar */}
      <header className="h-14 bg-[#151822] border-b border-slate-800 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-6">
          <div className="font-mono font-bold text-xl tracking-tight text-blue-500 flex items-center gap-2">
            <Activity className="w-5 h-5" />
            DIALER<span className="text-slate-500">OPS</span>
          </div>
          
          <div className="h-6 w-px bg-slate-800" />
          
          <div className="flex items-center gap-2 text-sm font-mono">
            <div className={`w-2 h-2 rounded-full ${agent ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500'}`} />
            <span className={agent ? 'text-emerald-500' : 'text-red-500'}>
              {agent ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm font-mono">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">QUEUED</span>
            <span className="text-slate-300 font-bold">142</span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-slate-500">STATUS</span>
            <Badge variant="outline" className={`
              font-mono rounded-sm border
              ${agent?.status === 'idle' ? 'bg-slate-800 text-slate-300 border-slate-700' : ''}
              ${agent?.status === 'on_call' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : ''}
              ${agent?.status === 'wrap_up' ? 'bg-purple-500/20 text-purple-400 border-purple-500/30' : ''}
              ${agent?.status === 'ringing' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : ''}
            `}>
              {agent?.status?.toUpperCase() || 'UNKNOWN'}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500">EXT</span>
            <span className="text-slate-300">{agent?.extension || '---'}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-slate-500">ID</span>
            <span className="text-slate-300">{agent?.id || '-'}</span>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/manager" className="text-slate-500 hover:text-blue-400 flex items-center gap-1 transition-colors">
              MGR <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Content Area */}
        <div className="flex-1 flex p-4 gap-4 overflow-hidden">
          
          {/* Left Column: Lead Info */}
          <div className="w-[40%] flex flex-col">
            <Card className="bg-[#151822] border-slate-800 h-full flex flex-col rounded-md shadow-lg shadow-black/20">
              <CardHeader className="pb-3 border-b border-slate-800 shrink-0">
                <CardTitle className="text-xs font-mono font-medium text-slate-500 flex items-center gap-2 tracking-wider">
                  <User className="w-4 h-4" /> 
                  ACTIVE LEAD PROFILE
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto p-0">
                {isLoadingLead ? (
                  <div className="p-6 space-y-6">
                    <Skeleton className="h-8 w-3/4 bg-slate-800" />
                    <Skeleton className="h-4 w-1/2 bg-slate-800" />
                    <Skeleton className="h-4 w-2/3 bg-slate-800" />
                  </div>
                ) : !lead ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                    <AlertCircle className="w-12 h-12 opacity-50" />
                    <p className="font-mono text-sm">NO LEAD ASSIGNED</p>
                    <Button 
                      variant="outline" 
                      className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                      onClick={() => assignNextLead.mutate({ id: AGENT_ID })}
                      disabled={assignNextLead.isPending}
                    >
                      REQUEST NEXT LEAD
                    </Button>
                  </div>
                ) : (
                  <div className="p-6 space-y-8">
                    <div>
                      <h2 className="text-3xl font-bold text-white mb-2 tracking-tight">
                        {lead.firstName} {lead.lastName}
                      </h2>
                      <div className="flex items-center gap-2 text-blue-400 font-mono text-lg bg-blue-500/10 w-fit px-3 py-1 rounded border border-blue-500/20">
                        <Phone className="w-4 h-4" />
                        {lead.phone}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                      <div className="space-y-4">
                        <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider border-b border-slate-800 pb-2">Primary Details</h3>
                        
                        <div className="grid gap-3">
                          <div className="flex justify-between items-center group">
                            <span className="text-sm text-slate-500 flex items-center gap-2"><Mail className="w-4 h-4" /> Email</span>
                            <span className="text-sm text-slate-300 font-medium group-hover:text-white transition-colors">{lead.email || '—'}</span>
                          </div>
                          <div className="flex justify-between items-center group">
                            <span className="text-sm text-slate-500 flex items-center gap-2"><Building2 className="w-4 h-4" /> Business</span>
                            <span className="text-sm text-slate-300 font-medium group-hover:text-white transition-colors">{lead.business || '—'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider border-b border-slate-800 pb-2">Location</h3>
                        
                        <div className="grid gap-3">
                          <div className="flex justify-between items-center group">
                            <span className="text-sm text-slate-500 flex items-center gap-2"><MapPin className="w-4 h-4" /> Address</span>
                            <span className="text-sm text-slate-300 font-medium group-hover:text-white transition-colors text-right">
                              {lead.address}<br/>
                              {lead.city && lead.state ? `${lead.city}, ${lead.state} ${lead.zip || ''}` : '—'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider border-b border-slate-800 pb-2">System</h3>
                        
                        <div className="grid gap-3">
                          <div className="flex justify-between items-center group">
                            <span className="text-sm text-slate-500 flex items-center gap-2"><Hash className="w-4 h-4" /> Lead ID</span>
                            <span className="text-sm text-slate-300 font-mono group-hover:text-white transition-colors">{lead.id}</span>
                          </div>
                          <div className="flex justify-between items-center group">
                            <span className="text-sm text-slate-500 flex items-center gap-2"><Activity className="w-4 h-4" /> Status</span>
                            <Badge variant="outline" className="border-slate-700 text-slate-400 bg-slate-800/50 uppercase font-mono text-[10px]">
                              {lead.status}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Center Column: Tabbed Content (Stacked) */}
          <div className="w-[60%] flex flex-col gap-4">
            {/* Notes Panel */}
            <Card className="bg-[#151822] border-slate-800 flex-1 flex flex-col min-h-[300px] rounded-md shadow-lg shadow-black/20">
              <CardHeader className="pb-3 border-b border-slate-800 py-3 px-4 shrink-0">
                <CardTitle className="text-xs font-mono font-medium text-slate-500">NOTES</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
                <div className="flex-1 overflow-auto p-4 space-y-4">
                  {isLoadingNotes ? (
                    <Skeleton className="h-16 w-full bg-slate-800" />
                  ) : notes?.length === 0 ? (
                    <div className="text-sm text-slate-600 font-mono italic text-center py-4">No notes found</div>
                  ) : (
                    notes?.map(note => (
                      <div key={note.id} className="bg-slate-900/50 p-3 rounded border border-slate-800 text-sm">
                        <div className="flex justify-between items-center mb-1 text-xs font-mono text-slate-500">
                          <span>{note.agentName || `Agent ${note.agentId}`}</span>
                          <span>{format(new Date(note.createdAt), 'MMM d, HH:mm')}</span>
                        </div>
                        <p className="text-slate-300">{note.content}</p>
                      </div>
                    ))
                  )}
                </div>
                
                <div className="p-4 border-t border-slate-800 bg-slate-900/30 shrink-0">
                  <Form {...noteForm}>
                    <form onSubmit={noteForm.handleSubmit(onSubmitNote)} className="flex gap-2">
                      <FormField
                        control={noteForm.control}
                        name="content"
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <Input 
                                placeholder="Type a note..." 
                                className="bg-[#0f111a] border-slate-700 text-white placeholder:text-slate-600 focus-visible:ring-blue-500" 
                                disabled={!lead}
                                {...field} 
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="submit" 
                        size="icon" 
                        className="bg-blue-600 hover:bg-blue-500 text-white shrink-0"
                        disabled={!lead || addNote.isPending}
                      >
                        <Save className="w-4 h-4" />
                      </Button>
                    </form>
                  </Form>
                </div>
              </CardContent>
            </Card>

            {/* Call History Panel */}
            <Card className="bg-[#151822] border-slate-800 flex-1 flex flex-col min-h-[250px] rounded-md shadow-lg shadow-black/20">
              <CardHeader className="pb-3 border-b border-slate-800 py-3 px-4 shrink-0">
                <CardTitle className="text-xs font-mono font-medium text-slate-500">CALL HISTORY</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-auto flex-1">
                <Table>
                  <TableHeader className="bg-slate-900/50 sticky top-0">
                    <TableRow className="border-slate-800 hover:bg-transparent">
                      <TableHead className="font-mono text-xs text-slate-500 h-8">DATE</TableHead>
                      <TableHead className="font-mono text-xs text-slate-500 h-8">DURATION</TableHead>
                      <TableHead className="font-mono text-xs text-slate-500 h-8">RESULT</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingHistory ? (
                      <TableRow className="border-slate-800">
                        <TableCell><Skeleton className="h-4 w-20 bg-slate-800" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12 bg-slate-800" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24 bg-slate-800" /></TableCell>
                      </TableRow>
                    ) : callHistory?.length === 0 ? (
                      <TableRow className="border-slate-800">
                        <TableCell colSpan={3} className="text-center text-slate-600 py-4 font-mono text-sm italic">
                          No previous calls
                        </TableCell>
                      </TableRow>
                    ) : (
                      callHistory?.map(call => (
                        <TableRow key={call.id} className="border-slate-800 hover:bg-slate-800/30">
                          <TableCell className="text-slate-300 text-sm py-2">
                            {format(new Date(call.createdAt), 'MMM d, HH:mm')}
                          </TableCell>
                          <TableCell className="text-slate-400 font-mono text-sm py-2">
                            {call.duration ? `${call.duration}s` : '—'}
                          </TableCell>
                          <TableCell className="py-2">
                            <Badge variant="outline" className="border-slate-700 bg-slate-900 text-slate-300 font-mono text-[10px] uppercase">
                              {call.result || 'INCOMPLETE'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Future Panel */}
            <Card className="bg-[#151822] border-slate-800 flex-1 min-h-[150px] flex items-center justify-center rounded-md shadow-lg shadow-black/20 border-dashed">
               <div className="text-center text-slate-600">
                 <KeyRound className="w-8 h-8 mx-auto mb-2 opacity-20" />
                 <p className="font-mono text-xs uppercase tracking-widest">Additional features coming soon</p>
               </div>
            </Card>
          </div>
        </div>

        {/* Right Sidebar: Call State Panel */}
        <div className="w-[300px] border-l border-slate-800 bg-[#12141c] shrink-0 flex flex-col p-4">
          
          <div className="mb-6 space-y-2">
            <h2 className="text-xs font-mono font-bold text-slate-500 uppercase tracking-widest">Control Panel</h2>
            <div className={`
              h-24 rounded flex items-center justify-center border
              ${agent?.status === 'idle' ? 'bg-slate-800/50 border-slate-700 text-slate-400' : ''}
              ${agent?.status === 'ringing' ? 'bg-amber-500/10 border-amber-500/50 text-amber-500 animate-pulse' : ''}
              ${agent?.status === 'on_call' ? 'bg-blue-500/10 border-blue-500/50 text-blue-500' : ''}
              ${agent?.status === 'wrap_up' ? 'bg-purple-500/10 border-purple-500/50 text-purple-400' : ''}
            `}>
              <div className="text-center">
                <p className="font-mono text-sm font-bold uppercase tracking-widest mb-1">
                  {agent?.status === 'on_call' ? 'LIVE CALL' : 
                   agent?.status === 'wrap_up' ? 'WRAP UP' : 
                   agent?.status || 'UNKNOWN'}
                </p>
                {agent?.status === 'on_call' && (
                  <p className="font-mono text-2xl font-bold tracking-tight">
                    {formatDuration(callDuration)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {!isCallActive && !needsDisposition && (
            <Button 
              className="w-full h-16 text-lg font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] transition-all rounded-md"
              onClick={handleCall}
              disabled={!lead || agent?.status !== 'idle'}
              data-testid="button-call-now"
            >
              <PhoneCall className="w-5 h-5 mr-2" />
              CALL NOW
            </Button>
          )}

          {isCallActive && (
            <Button 
              variant="destructive"
              className="w-full h-16 text-lg font-bold bg-red-600 hover:bg-red-500 shadow-[0_0_15px_rgba(220,38,38,0.3)] rounded-md"
              onClick={handleHangup}
              data-testid="button-hangup"
            >
              <PhoneOff className="w-5 h-5 mr-2" />
              HANGUP
            </Button>
          )}

          {needsDisposition && (
            <Card className="bg-[#151822] border-purple-500/30 border shadow-[0_0_15px_rgba(168,85,247,0.1)]">
              <CardHeader className="py-3 px-4 border-b border-slate-800">
                <CardTitle className="text-xs font-mono text-purple-400 uppercase tracking-widest">Disposition Required</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <Form {...dispositionForm}>
                  <form onSubmit={dispositionForm.handleSubmit(onSubmitDisposition)} className="space-y-4">
                    <FormField
                      control={dispositionForm.control}
                      name="disposition"
                      render={({ field }) => (
                        <FormItem>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="bg-[#0f111a] border-slate-700 text-white font-mono">
                                <SelectValue placeholder="Select outcome..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-[#151822] border-slate-700 text-slate-300">
                              <SelectItem value="hot_lead">HOT LEAD</SelectItem>
                              <SelectItem value="closed">CLOSED</SelectItem>
                              <SelectItem value="callback">CALLBACK</SelectItem>
                              <SelectItem value="not_interested">NOT INTERESTED</SelectItem>
                              <SelectItem value="no_answer">NO ANSWER</SelectItem>
                              <SelectItem value="busy">BUSY</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={dispositionForm.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <Textarea 
                              placeholder="Wrap-up notes..." 
                              className="min-h-[80px] resize-none bg-[#0f111a] border-slate-700 text-white placeholder:text-slate-600 font-mono text-sm"
                              {...field}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <Button type="submit" className="w-full bg-purple-600 hover:bg-purple-500 font-bold tracking-wide" disabled={setDisposition.isPending}>
                      SUBMIT & NEXT
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          )}

          <div className="mt-auto">
            <h3 className="text-[10px] font-mono text-slate-600 uppercase tracking-widest mb-3 pb-2 border-b border-slate-800">Hotkeys</h3>
            <ul className="space-y-2">
              {[
                { label: 'CALL NEXT', key: 'Enter' },
                { label: 'HANGUP', key: 'Esc' },
                { label: 'DISPOSITION', key: 'D' },
                { label: 'ADD NOTE', key: 'N' },
              ].map(hotkey => (
                <li key={hotkey.key} className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-medium">{hotkey.label}</span>
                  <kbd className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-400 font-mono text-[10px] shadow-sm">
                    {hotkey.key}
                  </kbd>
                </li>
              ))}
            </ul>
          </div>

        </div>
      </div>
    </div>
  );
}

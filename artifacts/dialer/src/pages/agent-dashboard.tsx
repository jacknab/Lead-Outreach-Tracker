import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

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
  getGetAgentCurrentLeadQueryKey,
  getGetLeadNotesQueryKey,
  getGetLeadCallHistoryQueryKey,
  getGetAgentQueryKey,
} from "@workspace/api-client-react";

const AGENT_ID = 1;

type Disposition = "no_answer" | "busy" | "hot_lead" | "callback" | "not_interested";

const DISPOSITIONS: { key: string; code: Disposition; label: string; color: string }[] = [
  { key: "1", code: "no_answer",    label: "No Answer",    color: "text-slate-400" },
  { key: "2", code: "busy",         label: "Busy",         color: "text-yellow-400" },
  { key: "3", code: "hot_lead",     label: "Hot Lead",     color: "text-emerald-400" },
  { key: "4", code: "callback",     label: "Callback",     color: "text-blue-400" },
  { key: "5", code: "not_interested", label: "Not Interested", color: "text-red-400" },
];

function useTime() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return time;
}

export default function AgentDashboard() {
  const queryClient = useQueryClient();
  const time = useTime();

  const { data: agent } = useGetAgent(AGENT_ID, {
    query: { refetchInterval: 2000, queryKey: getGetAgentQueryKey(AGENT_ID) },
  });

  const { data: lead } = useGetAgentCurrentLead(AGENT_ID, {
    query: { refetchInterval: 2000, queryKey: getGetAgentCurrentLeadQueryKey(AGENT_ID) },
  });

  const { data: notes } = useGetLeadNotes(lead?.id || 0, {
    query: { enabled: !!lead?.id, queryKey: getGetLeadNotesQueryKey(lead?.id || 0), refetchInterval: 5000 },
  });

  const { data: callHistory } = useGetLeadCallHistory(lead?.id || 0, {
    query: { enabled: !!lead?.id, queryKey: getGetLeadCallHistoryQueryKey(lead?.id || 0), refetchInterval: 5000 },
  });

  const updateAgentState = useUpdateAgentState();
  const assignNextLead  = useAssignNextLead();
  const createCall      = useCreateCall();
  const updateCall      = useUpdateCall();
  const setDisposition  = useSetLeadDisposition();
  const addNote         = useAddLeadNote();

  const [activeCallId, setActiveCallId]   = useState<number | null>(null);
  const [callDuration, setCallDuration]   = useState(0);
  const [noteText, setNoteText]           = useState("");
  const [statusMsg, setStatusMsg]         = useState("READY");
  const [selectedDisp, setSelectedDisp]   = useState<Disposition | null>(null);
  const [noteInputFocused, setNoteInputFocused] = useState(false);

  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const noteRef   = useRef<HTMLTextAreaElement>(null);

  /* ── call timer ── */
  useEffect(() => {
    const isOnCall = agent?.status === "on_call";
    if (isOnCall && !timerRef.current) {
      timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
    } else if (!isOnCall && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [agent?.status]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  /* ── actions ── */
  const doCall = useCallback(async () => {
    if (!lead || !agent || agent.status !== "idle") return;
    setStatusMsg("INITIATING CALL...");
    updateAgentState.mutate({ id: AGENT_ID, data: { status: "ringing" } });
    const call = await createCall.mutateAsync({ data: { agentId: AGENT_ID, leadId: lead.id, phoneNumber: lead.phone } });
    setActiveCallId(call.id);
    setTimeout(() => {
      updateAgentState.mutate({ id: AGENT_ID, data: { status: "on_call" } });
      setStatusMsg("ON CALL");
    }, 1500);
  }, [lead, agent, updateAgentState, createCall]);

  const doHangup = useCallback(async () => {
    if (!activeCallId || agent?.status !== "on_call") return;
    setStatusMsg("ENDING CALL...");
    await updateCall.mutateAsync({ id: activeCallId, data: { duration: callDuration } });
    updateAgentState.mutate({ id: AGENT_ID, data: { status: "wrap_up" } });
    setCallDuration(0);
    setStatusMsg("SELECT DISPOSITION");
  }, [activeCallId, agent, callDuration, updateCall, updateAgentState]);

  const doDisposition = useCallback(async (disp: Disposition) => {
    if (!lead || agent?.status !== "wrap_up") return;
    setStatusMsg(`LOGGING: ${disp.toUpperCase()}...`);
    await setDisposition.mutateAsync({ id: lead.id, data: { disposition: disp, agentId: AGENT_ID } });
    if (activeCallId) {
      await updateCall.mutateAsync({ id: activeCallId, data: { result: disp } });
    }
    setActiveCallId(null);
    setSelectedDisp(null);
    setStatusMsg("LOADING NEXT LEAD...");
    await assignNextLead.mutateAsync({ id: AGENT_ID });
    queryClient.invalidateQueries({ queryKey: getGetAgentCurrentLeadQueryKey(AGENT_ID) });
    setStatusMsg("READY");
  }, [lead, agent, activeCallId, setDisposition, updateCall, assignNextLead, queryClient]);

  const doPause = useCallback(() => {
    if (!agent) return;
    if (agent.status === "paused") {
      updateAgentState.mutate({ id: AGENT_ID, data: { status: "idle" } });
      setStatusMsg("RESUMED");
    } else if (agent.status === "idle") {
      updateAgentState.mutate({ id: AGENT_ID, data: { status: "paused" } });
      setStatusMsg("PAUSED");
    }
  }, [agent, updateAgentState]);

  const doNextLead = useCallback(async () => {
    setStatusMsg("REQUESTING NEXT LEAD...");
    await assignNextLead.mutateAsync({ id: AGENT_ID });
    queryClient.invalidateQueries({ queryKey: getGetAgentCurrentLeadQueryKey(AGENT_ID) });
    setStatusMsg("READY");
  }, [assignNextLead, queryClient]);

  const doSaveNote = useCallback(async () => {
    if (!lead || !noteText.trim()) return;
    await addNote.mutateAsync({ id: lead.id, data: { content: noteText.trim(), agentId: AGENT_ID } });
    setNoteText("");
    queryClient.invalidateQueries({ queryKey: getGetLeadNotesQueryKey(lead.id) });
    setStatusMsg("NOTE SAVED");
    setTimeout(() => setStatusMsg("READY"), 1500);
  }, [lead, noteText, addNote, queryClient]);

  /* ── global keyboard handler ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (noteInputFocused) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          doSaveNote();
        }
        if (e.key === "Escape") {
          noteRef.current?.blur();
          setNoteInputFocused(false);
        }
        return;
      }

      const k = e.key.toUpperCase();

      if (k === "C" && agent?.status === "idle" && lead)       { e.preventDefault(); doCall(); }
      if (k === "H" && agent?.status === "on_call")            { e.preventDefault(); doHangup(); }
      if (k === "W" && agent?.status === "on_call")            { e.preventDefault(); doHangup(); }
      if (k === "P")                                           { e.preventDefault(); doPause(); }
      if (k === "N" && agent?.status === "idle")               { e.preventDefault(); doNextLead(); }

      if (agent?.status === "wrap_up") {
        const d = DISPOSITIONS.find(d => d.key === e.key);
        if (d) { e.preventDefault(); setSelectedDisp(d.code); doDisposition(d.code); }
      }

      if (k === "T") {
        window.location.href = "/manager";
      }

      if (e.key === "/" && lead) {
        e.preventDefault();
        noteRef.current?.focus();
        setNoteInputFocused(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [agent, lead, noteInputFocused, doCall, doHangup, doPause, doNextLead, doDisposition, doSaveNote]);

  /* ── derived state ── */
  const status = agent?.status || "offline";

  const statusColor: Record<string, string> = {
    idle:    "text-emerald-400",
    ringing: "text-yellow-400",
    on_call: "text-blue-400",
    wrap_up: "text-purple-400",
    paused:  "text-orange-400",
    offline: "text-slate-500",
  };

  const statusBg: Record<string, string> = {
    idle:    "bg-emerald-400",
    ringing: "bg-yellow-400",
    on_call: "bg-blue-400",
    wrap_up: "bg-purple-400",
    paused:  "bg-orange-400",
    offline: "bg-slate-500",
  };

  const callStateLabel: Record<string, string> = {
    idle:    "READY",
    ringing: "RINGING...",
    on_call: "LIVE CALL",
    wrap_up: "WRAP-UP",
    paused:  "PAUSED",
    offline: "OFFLINE",
  };

  return (
    <div className="terminal-screen h-screen bg-background text-foreground font-mono flex flex-col overflow-hidden select-none">
      {/* ════ HEADER BAR ════ */}
      <div
        data-testid="header-bar"
        className="flex items-center border-b border-border bg-[hsl(220,20%,6%)] shrink-0"
        style={{ height: 28 }}
      >
        <div className="flex items-center gap-0 border-r border-border px-3 h-full">
          <span className="text-emerald-400 font-bold text-[11px] tracking-widest">DIALER</span>
          <span className="text-slate-500 font-bold text-[11px] tracking-widest ml-1">OPS</span>
          <span className="text-slate-600 text-[10px] ml-2">v2.0</span>
        </div>

        <div className="flex items-center gap-1 border-r border-border px-3 h-full">
          <span className={`w-1.5 h-1.5 rounded-full ${agent ? "bg-emerald-400 status-pulse" : "bg-red-500"}`} />
          <span className={`text-[10px] font-semibold ${agent ? "text-emerald-400" : "text-red-400"}`}>
            {agent ? "CONNECTED" : "CONNECTING..."}
          </span>
        </div>

        <div className="flex items-center gap-1 border-r border-border px-3 h-full">
          <span className="text-slate-600 text-[10px]">QUEUED</span>
          <span className="text-slate-300 text-[10px] font-bold">–</span>
        </div>

        <div className="flex items-center gap-1 border-r border-border px-3 h-full">
          <span className="text-slate-600 text-[10px]">STATUS</span>
          <span
            data-testid="agent-status"
            className={`text-[10px] font-bold ${statusColor[status]}`}
          >
            {status.toUpperCase().replace("_", "-")}
          </span>
        </div>

        <div className="flex items-center gap-1 border-r border-border px-3 h-full">
          <span className="text-slate-600 text-[10px]">EXT</span>
          <span className="text-slate-300 text-[10px]">{agent?.extension || "—"}</span>
        </div>

        <div className="flex items-center gap-1 border-r border-border px-3 h-full">
          <span className="text-slate-600 text-[10px]">AGENT</span>
          <span className="text-slate-300 text-[10px]">agent-{String(AGENT_ID).padStart(3, "0")}</span>
        </div>

        <div className="ml-auto flex items-center gap-1 border-l border-border px-3 h-full">
          <span className="text-slate-500 text-[10px]">{format(time, "HH:mm:ss")}</span>
        </div>

        <Link
          href="/manager"
          className="flex items-center gap-1 border-l border-border px-3 h-full text-slate-500 hover:text-emerald-400 text-[10px] transition-colors"
          data-testid="link-manager"
        >
          MGR VIEW
        </Link>
      </div>

      {/* ════ MAIN BODY ════ */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: CUSTOMER PANEL ── */}
        <div
          className="flex flex-col border-r border-border"
          style={{ width: 230 }}
        >
          <div className="panel-header">
            <span className="text-emerald-400">◄</span>
            <span>CUSTOMER</span>
            {lead && (
              <span className="ml-auto text-[9px] px-1 border border-emerald-400/40 text-emerald-400">ACTIVE</span>
            )}
          </div>

          {!lead ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
              <span className="text-slate-600 text-[11px] text-center">NO LEAD ASSIGNED</span>
              <button
                data-testid="btn-request-lead"
                onClick={doNextLead}
                className="text-[10px] border border-emerald-400/40 text-emerald-400 px-3 py-1 hover:bg-emerald-400/10 transition-colors"
              >
                [N] REQUEST LEAD
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-3 space-y-3">
              {/* Name */}
              <div>
                <div className="text-[10px] text-slate-600 mb-0.5">NAME</div>
                <div
                  data-testid="lead-name"
                  className="text-emerald-300 font-semibold text-[13px] leading-tight"
                >
                  {lead.firstName} {lead.lastName}
                </div>
              </div>

              {/* Phone */}
              <div>
                <div className="text-[10px] text-slate-600 mb-0.5">PHONE</div>
                <div
                  data-testid="lead-phone"
                  className="text-white font-bold text-[13px]"
                >
                  {lead.phone}
                </div>
              </div>

              <div className="border-t border-border pt-2 space-y-2">
                {[
                  { label: "EMAIL",    value: lead.email },
                  { label: "BUSINESS", value: lead.business },
                  { label: "ADDRESS",  value: lead.address },
                  {
                    label: "LOCATION",
                    value: lead.city && lead.state
                      ? `${lead.city}, ${lead.state} ${lead.zip || ""}`.trim()
                      : null,
                  },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="text-[9px] text-slate-600">{label}</div>
                    <div className="text-[11px] text-slate-300 leading-snug">{value || "—"}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-2">
                <div className="text-[9px] text-slate-600">STATUS</div>
                <div className={`text-[11px] font-bold ${statusColor[lead.status as string] || "text-slate-400"}`}>
                  {lead.status.toUpperCase().replace("_", " ")}
                </div>
              </div>

              <div>
                <div className="text-[9px] text-slate-600">LEAD ID</div>
                <div className="text-[11px] text-slate-500">#{lead.id}</div>
              </div>
            </div>
          )}
        </div>

        {/* ── CENTER: NOTES / HISTORY / BLANK ── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Status bar below header */}
          <div
            className="flex items-center gap-2 border-b border-border px-3"
            style={{ height: 22, background: "hsl(220,20%,6%)" }}
          >
            <span className="text-[9px] text-slate-600">SYS:</span>
            <span
              data-testid="status-message"
              className={`text-[10px] font-semibold ${
                statusMsg.includes("ERROR") ? "text-red-400" :
                statusMsg.includes("HOT") ? "text-emerald-400" :
                "text-slate-400"
              }`}
            >
              {statusMsg}
            </span>
            {status === "on_call" && (
              <span className="ml-auto text-blue-400 font-bold text-[11px] tracking-widest">
                {fmt(callDuration)}
              </span>
            )}
          </div>

          {/* Three-column bottom panels */}
          <div className="flex flex-1 overflow-hidden">

            {/* NOTES */}
            <div className="flex flex-col border-r border-border" style={{ flex: 2 }}>
              <div className="panel-header">
                <span className="text-blue-400">◄</span>
                <span>NOTES</span>
                <span className="ml-auto text-slate-600 text-[9px]">
                  {notes?.length ?? 0} entries
                </span>
              </div>

              <div className="flex-1 overflow-auto p-2 space-y-2">
                {!lead ? (
                  <div className="text-slate-700 text-[10px] italic pt-4 text-center">— no lead selected —</div>
                ) : !notes?.length ? (
                  <div className="text-slate-700 text-[10px] italic pt-4 text-center">— no notes —</div>
                ) : (
                  notes.map(note => (
                    <div
                      key={note.id}
                      className="border border-border p-2"
                    >
                      <div className="flex justify-between text-[9px] text-slate-600 mb-1">
                        <span>{note.agentName || `AGENT-${note.agentId}`}</span>
                        <span>{format(new Date(note.createdAt), "MMM d HH:mm")}</span>
                      </div>
                      <div className="text-[11px] text-slate-300">{note.content}</div>
                    </div>
                  ))
                )}
              </div>

              {/* Note input */}
              <div className="border-t border-border p-2">
                <div className="text-[9px] text-slate-600 mb-1">
                  ADD NOTE {noteInputFocused ? "— ENTER to save · ESC to cancel" : "— press / to focus"}
                </div>
                <textarea
                  ref={noteRef}
                  data-testid="input-note"
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  onFocus={() => setNoteInputFocused(true)}
                  onBlur={() => setNoteInputFocused(false)}
                  onKeyDown={e => {
                    if (e.key === "/") {
                      /* handled globally */
                    }
                  }}
                  disabled={!lead}
                  rows={2}
                  placeholder="Type note then press ENTER..."
                  className="w-full bg-[hsl(220,18%,7%)] border border-border text-[11px] text-slate-300 placeholder-slate-700 p-1.5 resize-none focus:outline-none focus:border-blue-400/60"
                />
              </div>
            </div>

            {/* CALL HISTORY */}
            <div className="flex flex-col border-r border-border" style={{ flex: 2 }}>
              <div className="panel-header">
                <span className="text-yellow-400">◄</span>
                <span>CALL HISTORY</span>
                <span className="ml-auto text-slate-600 text-[9px]">
                  {callHistory?.length ?? 0} calls
                </span>
              </div>

              <div className="flex-1 overflow-auto">
                {!lead ? (
                  <div className="text-slate-700 text-[10px] italic pt-4 text-center">— no lead selected —</div>
                ) : !callHistory?.length ? (
                  <div className="text-slate-700 text-[10px] italic pt-4 text-center">— no previous calls —</div>
                ) : (
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-border text-slate-600">
                        <th className="text-left px-2 py-1 font-normal">DATE</th>
                        <th className="text-left px-2 py-1 font-normal">DUR</th>
                        <th className="text-left px-2 py-1 font-normal">RESULT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {callHistory.map(call => (
                        <tr key={call.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                          <td className="px-2 py-1.5 text-slate-400">
                            {format(new Date(call.startTime), "MM/dd HH:mm")}
                          </td>
                          <td className="px-2 py-1.5 text-slate-500">
                            {call.duration ? `${call.duration}s` : "—"}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={`text-[9px] font-bold ${
                              call.result === "hot_lead"       ? "text-emerald-400" :
                              call.result === "no_answer"      ? "text-slate-500" :
                              call.result === "busy"           ? "text-yellow-400" :
                              call.result === "callback"       ? "text-blue-400" :
                              call.result === "not_interested" ? "text-red-400" :
                              "text-slate-500"
                            }`}>
                              {(call.result || "—").toUpperCase().replace("_", " ")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* BLANK / FUTURE PANEL */}
            <div className="flex flex-col" style={{ flex: 1 }}>
              <div className="panel-header">
                <span className="text-slate-600">◄</span>
                <span className="text-slate-600">MODULE</span>
              </div>
              <div className="flex-1 flex items-center justify-center">
                <span className="text-slate-800 text-[10px] text-center leading-relaxed">
                  FUTURE<br/>MODULE
                </span>
              </div>
            </div>

          </div>
        </div>

        {/* ── RIGHT: CALL STATE PANEL ── */}
        <div
          className="flex flex-col border-l border-border shrink-0"
          style={{ width: 190 }}
        >
          {/* Call state display */}
          <div className="panel-header">
            <span className="text-slate-500">CALL STATE</span>
          </div>

          <div
            className={`mx-2 mt-2 p-3 border flex flex-col items-center justify-center gap-1 ${
              status === "idle"    ? "border-emerald-400/30 bg-emerald-400/5" :
              status === "ringing" ? "border-yellow-400/40 bg-yellow-400/5 animate-pulse" :
              status === "on_call" ? "border-blue-400/40 bg-blue-400/5" :
              status === "wrap_up" ? "border-purple-400/40 bg-purple-400/5" :
              status === "paused"  ? "border-orange-400/30 bg-orange-400/5" :
              "border-border bg-muted/20"
            }`}
            style={{ minHeight: 64 }}
          >
            <div
              data-testid="call-state-label"
              className={`text-[11px] font-bold tracking-widest ${statusColor[status]}`}
            >
              {callStateLabel[status] || status.toUpperCase()}
            </div>
            {status === "on_call" && (
              <div className="text-blue-300 font-bold text-[18px] tracking-widest font-mono">
                {fmt(callDuration)}
              </div>
            )}
            {status === "ringing" && (
              <div className="flex gap-1 mt-1">
                {[0,1,2].map(i => (
                  <span
                    key={i}
                    className="w-1 h-1 rounded-full bg-yellow-400"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* OPTIONS */}
          <div className="panel-header mt-2">
            <span className="text-slate-500">OPTIONS</span>
          </div>

          <div className="px-2 py-1 space-y-0.5">
            {status === "idle" && lead && (
              <button
                data-testid="btn-call-now"
                onClick={doCall}
                className="w-full flex items-center gap-2 text-[10px] text-emerald-400 hover:bg-emerald-400/10 px-1 py-1 transition-colors border border-emerald-400/20 hover:border-emerald-400/50"
              >
                <span className="key-badge active">C</span>
                <span>Call Now</span>
              </button>
            )}
            {status === "idle" && (
              <button
                data-testid="btn-next-lead"
                onClick={doNextLead}
                className="w-full flex items-center gap-2 text-[10px] text-slate-400 hover:bg-white/5 px-1 py-1 transition-colors"
              >
                <span className="key-badge">N</span>
                <span>Next Lead</span>
              </button>
            )}
            {(status === "on_call" || status === "ringing") && (
              <button
                data-testid="btn-hangup"
                onClick={doHangup}
                className="w-full flex items-center gap-2 text-[10px] text-red-400 hover:bg-red-400/10 px-1 py-1 transition-colors border border-red-400/20"
              >
                <span className="key-badge" style={{ borderColor: "rgb(248 113 113 / 0.5)", color: "rgb(248 113 113)" }}>H</span>
                <span>Hang Up</span>
              </button>
            )}
            {(status === "idle" || status === "paused") && (
              <button
                data-testid="btn-pause"
                onClick={doPause}
                className="w-full flex items-center gap-2 text-[10px] text-orange-400 hover:bg-orange-400/10 px-1 py-1 transition-colors"
              >
                <span className="key-badge">P</span>
                <span>{status === "paused" ? "Resume" : "Pause"}</span>
              </button>
            )}
          </div>

          {/* DISPOSITION — shown in wrap-up */}
          {status === "wrap_up" && (
            <>
              <div className="panel-header mt-2">
                <span className="text-purple-400">DISPOSITION</span>
              </div>
              <div className="px-2 py-1 space-y-0.5">
                {DISPOSITIONS.map(d => (
                  <button
                    key={d.key}
                    data-testid={`btn-disp-${d.code}`}
                    onClick={() => doDisposition(d.code)}
                    className={`w-full flex items-center gap-2 text-[10px] px-1 py-1 transition-colors hover:bg-white/5 ${
                      selectedDisp === d.code ? "bg-white/10" : ""
                    } ${d.color}`}
                  >
                    <span className="key-badge">{d.key}</span>
                    <span>{d.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* HOTKEYS reference */}
          <div className="panel-header mt-auto">
            <span className="text-slate-500">HOTKEYS</span>
          </div>

          <div className="px-2 py-1 space-y-0.5 text-[9px] text-slate-600">
            <div className="flex justify-between">
              <span><span className="key-badge mr-1">C</span> Call</span>
              <span><span className="key-badge mr-1">H</span> Hangup</span>
            </div>
            <div className="flex justify-between">
              <span><span className="key-badge mr-1">W</span> Wrap</span>
              <span><span className="key-badge mr-1">P</span> Pause</span>
            </div>
            <div className="flex justify-between">
              <span><span className="key-badge mr-1">N</span> Next</span>
              <span><span className="key-badge mr-1">T</span> MGR</span>
            </div>
            <div className="border-t border-border/50 pt-1 mt-1">
              {DISPOSITIONS.map(d => (
                <div key={d.key} className={`flex items-center gap-1.5 ${d.color}`}>
                  <span className="key-badge">{d.key}</span>
                  <span>{d.label}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border/50 pt-1 mt-1 text-slate-700">
              / = focus note
            </div>
          </div>

          {/* Note input shortcut info */}
          <div className="border-t border-border" />
          <div className="px-2 py-1">
            <Link
              href="/manager"
              className="text-[9px] text-slate-600 hover:text-emerald-400 transition-colors block text-center"
            >
              → MANAGER VIEW
            </Link>
          </div>
        </div>

      </div>
    </div>
  );
}

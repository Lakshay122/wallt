"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, Shield, ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { io } from "socket.io-client";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Reply {
  id: string;
  content: string;
  createdAt: string;
  userId?: string | null;
  user?: User | null;
}

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignedToId?: string | null;
  assignedTo?: User | null;
  creator: User;
  createdAt: string;
  replies: Reply[];
}

export default function TicketDetailPage() {
  const router = useRouter();
  const { id } = useParams() as { id: string };

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [socketToken, setSocketToken] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<{ userId: string; name: string; role: string; }[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [agents, setAgents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Reply state
  const [replyContent, setReplyContent] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);

  // AI states
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiUsage, setAiUsage] = useState<{ count: number; limit: number } | null>(null);

  const fetchAiUsage = async () => {
    try {
      const res = await fetch("/api/tickets/ai-usage");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAiUsage({ count: data.count, limit: data.limit });
        }
      }
    } catch (err) {
      console.error("Failed to fetch AI usage:", err);
    }
  };

  // Ticket local properties for save changes option
  const [localStatus, setLocalStatus] = useState("");
  const [localPriority, setLocalPriority] = useState("");
  const [localAssignedToId, setLocalAssignedToId] = useState("");
  const [updatingProperties, setUpdatingProperties] = useState(false);

  useEffect(() => {
    if (ticket) {
      setLocalStatus(ticket.status);
      setLocalPriority(ticket.priority);
      setLocalAssignedToId(ticket.assignedToId || "unassigned");
    }
  }, [ticket]);

  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom helper
  const scrollToBottom = () => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Get Initials from name
  const getInitials = (nameStr: string) => {
    if (!nameStr) return "";
    const parts = nameStr.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Color picker for initials circle
  const getAvatarBg = (nameStr: string) => {
    const colors = [
      "bg-purple-50 text-purple-700 border-purple-200",
      "bg-blue-50 text-blue-700 border-blue-200",
      "bg-emerald-50 text-emerald-700 border-emerald-200",
      "bg-amber-50 text-amber-700 border-amber-200",
      "bg-rose-50 text-rose-700 border-rose-200",
    ];
    let sum = 0;
    for (let i = 0; i < nameStr.length; i++) {
      sum += nameStr.charCodeAt(i);
    }
    return colors[sum % colors.length];
  };

  // Fetch meta user profile
  useEffect(() => {
    async function loadMeta() {
      try {
        const res = await fetch("/api/users/me");
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            setCurrentUser(data.data);
            setSocketToken(data.token || null);
          }
        }
      } catch (err) {
        console.error("Failed to load user metadata:", err);
      }
    }
    loadMeta();
  }, [router]);

  // Fetch ticket details
  const fetchTicket = async () => {
    try {
      const res = await fetch(`/api/tickets/${id}`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch ticket.");
      setTicket(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  // Fetch agents
  const fetchAgents = async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setAgents(data.data || []);
      }
    } catch (err) {
      console.error("Failed to load agents:", err);
    }
  };

  useEffect(() => {
    fetchTicket();
    fetchAgents();
    fetchAiUsage();
  }, [id]);

  // Real-time updates via Socket.IO
  useEffect(() => {
    if (!currentUser || !id || !socketToken) {
      console.log("🔌 Socket connection skipped: missing currentUser, id, or socketToken", { currentUser, id, socketToken });
      return;
    }

    console.log("🔌 Attempting Socket.IO connection to", process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001", "with token:", socketToken.substring(0, 15) + "...");
    const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001", {
      auth: { token: socketToken },
    });

    socket.on("connect", () => {
      console.log("🟢 Connected to Socket.IO Server, socket ID:", socket.id);
      // Join this ticket-specific room with user details
      console.log("Emitting ticket:join for", id, "with user name:", currentUser.name);
      socket.emit("ticket:join", { ticketId: id, userName: currentUser.name });
    });

    socket.on("connect_error", (err) => {
      console.error("🔴 Socket.IO connection/auth error:", err.message, err);
    });

    socket.on("reply:created", (payload) => {
      console.log("📢 New reply event received:", payload);
      // Fetch ticket details again to refresh conversation timeline and AI recommendations
      fetchTicket();
    });

    socket.on("ticket:updated", (payload) => {
      if (payload.ticketId === id) {
        console.log("📢 Ticket updated event received:", payload);
        // Fetch ticket details again to update fields
        fetchTicket();
      }
    });

    socket.on("ticket:active_users", (users) => {
      console.log("📢 Active users event received:", users);
      setActiveUsers(users);
    });

    return () => {
      console.log("🔌 Disconnecting socket");
      socket.emit("ticket:leave", id);
      socket.disconnect();
    };
  }, [currentUser, id, socketToken]);

  useEffect(() => {
    scrollToBottom();
  }, [ticket?.replies]);

  // Save ticket properties handler (triggers single PATCH query on clicking Save button)
  const handleSaveChanges = async () => {
    if (!ticket) return;
    setUpdatingProperties(true);
    try {
      const updatedAssignedToId = localAssignedToId === "unassigned" ? null : localAssignedToId;
      const res = await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: localStatus,
          priority: localPriority,
          assignedToId: updatedAssignedToId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update properties.");
      await fetchTicket(); // Refetch details to sync values
    } catch (err: any) {
      alert(err.message || "Failed to save properties.");
    } finally {
      setUpdatingProperties(false);
    }
  };

  const hasChanges = ticket && (
    localStatus !== ticket.status ||
    localPriority !== ticket.priority ||
    localAssignedToId !== (ticket.assignedToId || "unassigned")
  );

  // Submit reply
  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyContent.trim()) return;
    setReplyLoading(true);

    try {
      const res = await fetch(`/api/tickets/${id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyContent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to post reply.");
      setReplyContent("");
      fetchTicket(); // Refresh replies
    } catch (err: any) {
      alert(err.message || "Failed to send reply.");
    } finally {
      setReplyLoading(false);
    }
  };

  // Stream AI Suggestion using TextDecoder reader
  const handleGetAiSuggestion = async () => {
    setAiSuggestion("");
    setAiStreaming(true);
    setAiError("");

    try {
      const response = await fetch(`/api/tickets/${id}/suggest`);
      
      if (!response.ok) {
        let msg = `AI suggestion service responded with status ${response.status}`;
        try {
          const errData = await response.json();
          if (errData.message) {
            msg = errData.message;
          } else if (errData.error) {
            msg = errData.error;
          }
        } catch (e) {
          // ignore parsing error
        }
        throw new Error(msg);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Response body reader not available.");
      }

      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last partial line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const cleanedLine = line.trim();
          if (!cleanedLine) continue;

          if (cleanedLine.startsWith("data: ")) {
            try {
              const data = JSON.parse(cleanedLine.substring(6));
              if (data.error) {
                setAiError(data.error);
              } else if (data.text) {
                console.log('🤖 Suggestion chunk received:', data.text);
                const cleanedText = data.text.replaceAll('*', '');
                setAiSuggestion((prev) => prev + cleanedText);
              }
            } catch (err) {
              // Ignore partial chunk parse error
            }
          }
        }
      }
    } catch (err: any) {
      setAiError(err.message || "Connection timed out.");
    } finally {
      setAiStreaming(false);
      fetchAiUsage();
    }
  };

  // Logout handler
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-zinc-500 bg-zinc-50 font-sans">
        <Loader2 className="animate-spin text-zinc-400 mr-2" size={20} />
        Loading ticket room...
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center bg-zinc-50 text-zinc-900 font-sans selection:bg-zinc-200">
        <h2 className="text-2xl font-bold text-red-650">Ticket Load Failure</h2>
        <p className="text-sm text-zinc-500 mt-2">{error || "Ticket does not exist or access was denied."}</p>
        <Link href="/dashboard" className="mt-4">
          <Button variant="outline" className="text-sm font-semibold px-6 py-2">Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-zinc-200 selection:text-zinc-900">
      {/* Top Navbar Header */}
      <header className="px-8 h-16 flex items-center justify-between border-b border-zinc-200 bg-white sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-8">
          <span className="text-lg font-bold tracking-tight text-zinc-900">
            Helpdesk Workspace
          </span>
          <nav className="flex gap-2">
            <Link 
              href="/dashboard" 
              className="text-zinc-500 hover:text-zinc-900 px-3.5 py-1.5 rounded-lg flex items-center gap-2 text-sm font-semibold transition-colors"
            >
              <LayoutGrid size={16} />
              Dashboard
            </Link>
            {currentUser?.role === 'ADMIN' && (
              <Link 
                href="/admin" 
                className="text-zinc-500 hover:text-zinc-900 px-3.5 py-1.5 rounded-lg flex items-center gap-2 text-sm font-semibold transition-colors"
              >
                <Shield size={16} />
                Admin Room
              </Link>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {currentUser && (
            <div className="flex items-center gap-2">
              <span className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-semibold ${getAvatarBg(currentUser.name)}`}>
                {getInitials(currentUser.name)}
              </span>
              <span className="text-sm font-medium text-zinc-700 hidden md:inline">
                {currentUser.name}
              </span>
            </div>
          )}
          <button 
            onClick={handleLogout}
            className="border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-55 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors shadow-xs"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main Container Header (Back to Tickets) */}
      <div className="max-w-7xl w-full mx-auto px-8 pt-6">
        <Link 
          href="/dashboard" 
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-zinc-950 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Tickets
        </Link>
      </div>

      {/* Grid Layout */}
      <div className="flex-1 max-w-7xl w-full mx-auto grid grid-cols-1 lg:grid-cols-4 p-8 gap-8 pt-4">
        {/* Main Conversation Thread (3/4 Width) */}
        <div className="lg:col-span-3 flex flex-col space-y-8">
          {/* Ticket Description Hero */}
          <Card className="border-zinc-200 bg-white shadow-xs">
            <CardContent className="pt-6 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {/* Status Badge */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Status:</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                    ticket.status === "OPEN" ? "border-blue-250 bg-blue-50 text-blue-700" :
                    ticket.status === "IN_PROGRESS" ? "border-indigo-250 bg-indigo-50 text-indigo-700" :
                    ticket.status === "RESOLVED" ? "border-emerald-250 bg-emerald-50 text-emerald-700" :
                    "border-zinc-200 bg-zinc-100 text-zinc-700"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      ticket.status === "OPEN" ? "bg-blue-500 animate-pulse" :
                      ticket.status === "IN_PROGRESS" ? "bg-indigo-500" :
                      ticket.status === "RESOLVED" ? "bg-emerald-500" :
                      "bg-zinc-500"
                    }`} />
                    {ticket.status.charAt(0) + ticket.status.slice(1).toLowerCase().replace('_', ' ')}
                  </span>
                </div>

                {/* Priority Badge */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Priority:</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                    ticket.priority === "LOW" ? "border-zinc-200 bg-zinc-50 text-zinc-600" :
                    ticket.priority === "MEDIUM" ? "border-amber-250 bg-amber-50 text-amber-800" :
                    ticket.priority === "HIGH" ? "border-orange-250 bg-orange-50 text-orange-700" :
                    "border-red-250 bg-red-50 text-red-750"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      ticket.priority === "LOW" ? "bg-zinc-400" :
                      ticket.priority === "MEDIUM" ? "bg-amber-500" :
                      ticket.priority === "HIGH" ? "bg-orange-500" :
                      "bg-red-500"
                    }`} />
                    {ticket.priority.charAt(0) + ticket.priority.slice(1).toLowerCase()}
                  </span>
                </div>

                <div className="border-r border-zinc-200 h-4 mx-1 hidden sm:block" />

                <span className="text-xs text-zinc-500 font-medium">Created by {ticket.creator.name} ({ticket.creator.email})</span>
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-zinc-900">{ticket.title}</h1>
              <p className="text-zinc-800 text-sm leading-relaxed bg-zinc-50 p-5 rounded-lg border border-zinc-200 whitespace-pre-wrap">
                {ticket.description}
              </p>
            </CardContent>
          </Card>

          {/* Conversation Timeline */}
          <Card className="border-zinc-200 bg-white flex-1 min-h-[350px] flex flex-col shadow-xs">
            <CardHeader className="border-b border-zinc-200 py-4 px-6 bg-zinc-50/50">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Conversation Timeline</span>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-6 space-y-5 max-h-[450px] flex flex-col">
              {!currentUser ? (
                <div className="flex flex-col justify-center items-center py-20 text-zinc-500 text-sm gap-2">
                  <Loader2 className="animate-spin text-zinc-400" size={24} />
                  <span>Loading chat history...</span>
                </div>
              ) : ticket.replies.length === 0 ? (
                <div className="text-center text-sm text-zinc-400 py-16 italic">
                  No replies in this thread yet. Agent response required.
                </div>
              ) : (
                ticket.replies.map((reply) => {
                  const isMyReply = reply.userId === currentUser?.id;
                  return (
                    <div
                      key={reply.id}
                      className={`flex flex-col max-w-[80%] rounded-2xl p-4 shadow-xs text-sm transition-all duration-200 ${
                        isMyReply
                          ? "bg-zinc-100 border border-zinc-200 text-zinc-900 ml-auto rounded-tr-none"
                          : "bg-white border border-zinc-200 text-zinc-800 mr-auto rounded-tl-none"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1 text-xs text-zinc-500 font-semibold">
                        <span>{reply.user?.name || "Customer"}</span>
                        <span>•</span>
                        <span>{new Date(reply.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p className="leading-relaxed whitespace-pre-wrap">{reply.content}</p>
                    </div>
                  );
                })
              )}
              <div ref={endOfMessagesRef} />
            </CardContent>
          </Card>

          {/* AI suggestion panel & Reply Input box */}
          <div className="space-y-4">
            {/* AI Suggestion Box */}
            {(aiSuggestion || aiStreaming || aiError) && (
              <Card className="border-zinc-200 bg-zinc-50/60 shadow-xs">
                <CardHeader className="py-3 border-b border-zinc-200 flex flex-row items-center justify-between">
                  <span className="text-xs font-bold text-zinc-600 flex items-center gap-1.5 uppercase tracking-wider">
                    <Sparkles size={14} className="text-[#3b82f6]" />
                    AI Draft Recommendation {aiUsage ? `(${aiUsage.count}/${aiUsage.limit} used in last hour)` : ""}
                  </span>
                  {aiStreaming && <span className="text-[10px] text-zinc-500 animate-pulse">Streaming suggestion...</span>}
                </CardHeader>
                <CardContent className="pt-4 pb-4 text-sm text-zinc-800">
                  {aiError ? (
                    <span className="text-red-600 font-medium text-xs">{aiError}</span>
                  ) : (
                    <p className="whitespace-pre-wrap font-sans leading-relaxed">{aiSuggestion}</p>
                  )}
                  {aiSuggestion && !aiStreaming && !aiError && (
                    <div className="flex gap-2 pt-4 border-t border-zinc-200 mt-4 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-white hover:bg-zinc-50 border-zinc-200 text-xs py-1 px-3"
                        onClick={() => {
                          setReplyContent((prev) => (prev ? prev + "\n" + aiSuggestion : aiSuggestion));
                        }}
                      >
                        Apply to Reply Editor
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Fast Reply Box */}
            <form onSubmit={handleSubmitReply} className="space-y-4">
              <div className="relative">
                <Textarea
                  placeholder="Draft your reply to the customer here..."
                  rows={5}
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  className="w-full bg-white border border-zinc-200 text-sm p-4 placeholder-zinc-400 focus-visible:ring-0 focus-visible:ring-offset-0 focus:border-zinc-350"
                  required
                />
                <button
                  type="button"
                  onClick={handleGetAiSuggestion}
                  disabled={aiStreaming || (aiUsage !== null && aiUsage.limit - aiUsage.count <= 0)}
                  className={`absolute right-4 bottom-4 text-xs font-semibold py-1.5 px-3 rounded-full flex items-center gap-1.5 shadow-xs transition-all border ${
                    (aiStreaming || (aiUsage && aiUsage.limit - aiUsage.count <= 0))
                      ? 'bg-zinc-100 text-zinc-400 border-zinc-200 cursor-not-allowed'
                      : 'text-zinc-700 bg-white hover:bg-zinc-50 border-zinc-200 cursor-pointer'
                  }`}
                >
                  <Sparkles size={13} className={(aiStreaming || (aiUsage && aiUsage.limit - aiUsage.count <= 0)) ? "text-zinc-400" : "text-[#3b82f6]"} />
                  AI Suggest {aiUsage ? `(${aiUsage.limit - aiUsage.count} left)` : ""}
                </button>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="submit" className="bg-zinc-900 text-white hover:bg-zinc-800 text-sm font-semibold px-6 py-2" disabled={replyLoading}>
                  {replyLoading ? "Posting..." : "Send Reply"}
                </Button>
              </div>
            </form>
          </div>
        </div>

        {/* Sidebar Ticket Properties (1/4 Width) */}
        <div className="space-y-8">
          <Card className="border-zinc-200 bg-white shadow-xs rounded-xl overflow-hidden">
            <CardHeader className="border-b border-zinc-200 py-4 bg-zinc-50/50">
              <CardTitle className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Ticket Properties</CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-5 text-sm">
              {/* Status Select */}
              <div className="space-y-1.5">
                <Label htmlFor="statusSelect" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Ticket Status</Label>
                <Select
                  value={localStatus}
                  onValueChange={setLocalStatus}
                >
                  <SelectTrigger id="statusSelect" className="h-10 text-xs bg-zinc-50 border-zinc-200 text-zinc-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-zinc-200 text-zinc-900">
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Priority Select */}
              <div className="space-y-1.5">
                <Label htmlFor="prioritySelect" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Ticket Priority</Label>
                <Select
                  value={localPriority}
                  onValueChange={setLocalPriority}
                >
                  <SelectTrigger id="prioritySelect" className="h-10 text-xs bg-zinc-50 border-zinc-200 text-zinc-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-zinc-200 text-zinc-900">
                    <SelectItem value="LOW">Low</SelectItem>
                    <SelectItem value="MEDIUM">Medium</SelectItem>
                    <SelectItem value="HIGH">High</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Assignee Select */}
              <div className="space-y-1.5">
                <Label htmlFor="assigneeSelect" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Assignee</Label>
                <Select
                  value={localAssignedToId}
                  onValueChange={setLocalAssignedToId}
                >
                  <SelectTrigger id="assigneeSelect" className="h-10 text-xs bg-zinc-50 border-zinc-200 text-zinc-800">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-zinc-200 text-zinc-900">
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Save changes button */}
              {hasChanges && (
                <button
                  type="button"
                  onClick={handleSaveChanges}
                  disabled={updatingProperties}
                  className="w-full mt-4 bg-zinc-900 text-white hover:bg-zinc-800 disabled:bg-zinc-400 text-xs font-semibold py-2.5 px-3 rounded-lg shadow-xs transition-colors"
                >
                  {updatingProperties ? "Saving..." : "Save Changes"}
                </button>
              )}
            </CardContent>
          </Card>

          {/* Active Users Widget */}
          <Card className="border-zinc-200 bg-white shadow-xs rounded-xl overflow-hidden">
            <CardHeader className="border-b border-zinc-200 py-3.5 px-5 bg-zinc-50/50">
              <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Active Users ({activeUsers.length})</span>
            </CardHeader>
            <CardContent className="p-5 space-y-3">
              {activeUsers.length === 0 ? (
                <span className="text-xs text-zinc-400 italic">No other users online.</span>
              ) : (
                <div className="space-y-2">
                  {activeUsers.map((u) => (
                    <div key={u.userId} className="flex items-center gap-2 text-xs font-medium text-zinc-700">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                      <span className="truncate">{u.name}</span>
                      {u.userId === currentUser?.id && <span className="text-[10px] text-zinc-400">(you)</span>}
                      <span className="text-[10px] text-zinc-400 uppercase ml-auto">({u.role})</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

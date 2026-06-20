"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  LayoutGrid, 
  Shield, 
  Plus, 
  Ticket, 
  CircleDot, 
  AlertTriangle, 
  CheckCircle2, 
  Search, 
  X,
  Loader2
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Ticket {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assignedTo?: User | null;
  creator: User;
  createdAt: string;
}

interface Stats {
  total: number;
  open: number;
  highPriority: number;
  resolved: number;
}

export default function DashboardPage() {
  const router = useRouter();
  
  // App states
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, open: 0, highPriority: 0, resolved: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  // Filter and search states
  const [status, setStatus] = useState("ALL");
  const [priority, setPriority] = useState("ALL");
  const [assignedToId, setAssignedToId] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<{ ticketId: string; title: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);


  // Create ticket states
  const [createOpen, setCreateOpen] = useState(false);
  const [newTicket, setNewTicket] = useState({
    title: "",
    description: "",
    priority: "LOW",
    assignedToId: "",
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [agents, setAgents] = useState<User[]>([]);

  // Fetch current user details & agents
  useEffect(() => {
    async function loadMeta() {
      try {
        const [meRes, usersRes] = await Promise.all([
          fetch("/api/users/me"),
          fetch("/api/users")
        ]);

        if (meRes.status === 401 || usersRes.status === 401) {
          router.push("/login");
          return;
        }

        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData.success) {
            setCurrentUser(meData.data);
          }
        }

        if (usersRes.ok) {
          const uData = await usersRes.json();
          setAgents(uData.data || []);
        }
      } catch (err) {
        console.error("Failed to load user and agent metadata:", err);
      }
    }
    loadMeta();
  }, [router]);

  // Fetch stats helper
  const fetchStats = async () => {
    try {
      const res = await fetch("/api/tickets/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  };

  // Fetch tickets
  const fetchTickets = async (cursorVal = "", append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");

    try {
      let url = `/api/tickets?limit=10`;
      if (status !== "ALL") url += `&status=${status}`;
      if (priority !== "ALL") url += `&priority=${priority}`;
      if (assignedToId !== "ALL" && assignedToId !== "") url += `&assignedToId=${assignedToId}`;
      if (cursorVal) url += `&cursor=${cursorVal}`;

      const res = await fetch(url);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch tickets.");

      if (append) {
        setTickets((prev) => [...prev, ...data.tickets]);
      } else {
        setTickets(data.tickets || []);
      }
      setNextCursor(data.nextCursor || null);
    } catch (err: any) {
      setError(err.message || "Failed to load tickets.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Debounced search query and suggestions fetcher
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchQuery.trim()) {
        const performSearch = async () => {
          try {
            const res = await fetch(`/api/tickets/search?q=${encodeURIComponent(searchQuery)}`);
            if (res.ok) {
              const data = await res.json();
              if (data.success) {
                setTickets(data.tickets.map((t: any) => ({
                  id: t.ticketId,
                  title: t.title,
                  description: t.description,
                  status: t.status,
                  priority: t.priority,
                  createdAt: t.createdAt,
                  assignedTo: t.assignedTo || null,
                  creator: t.creator || { id: "", name: "Unknown", email: "", role: "AGENT" },
                })));
                setNextCursor(null);
              }
            }
          } catch (err) {
            console.error("Search failed:", err);
          }
        };

        const fetchSuggestions = async () => {
          try {
            const res = await fetch(`/api/tickets/search?q=${encodeURIComponent(searchQuery)}&type=suggest`);
            if (res.ok) {
              const data = await res.json();
              if (data.success) {
                setSuggestions(data.tickets || []);
                setShowSuggestions(true);
              }
            }
          } catch (err) {
            console.error("Suggestions failed:", err);
          }
        };

        performSearch();
        fetchSuggestions();
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
        fetchTickets();
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  // Trigger load on filter change
  useEffect(() => {
    if (!searchQuery.trim()) {
      fetchTickets();
      fetchStats();
    }
  }, [status, priority, assignedToId]);


  // Logout handler
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  // Create ticket submit
  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError("");

    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTicket.title,
          description: newTicket.description,
          priority: newTicket.priority,
          assignedToId: newTicket.assignedToId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create ticket.");

      setCreateOpen(false);
      setNewTicket({ title: "", description: "", priority: "LOW", assignedToId: "" });
      
      // Refresh list and stats
      fetchTickets();
      fetchStats();
    } catch (err: any) {
      setCreateError(err.message || "Failed to create ticket.");
    } finally {
      setCreateLoading(false);
    }
  };

  const resetFilters = () => {
    setStatus("ALL");
    setPriority("ALL");
    setAssignedToId("ALL");
    setSearchQuery("");
  };

  // Get Initials from name
  const getInitials = (nameStr: string) => {
    if (!nameStr) return "";
    const parts = nameStr.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Color picker for initials circle (Light Mode Friendly)
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

  // Filter tickets locally for active dropdown selectors
  const filteredTickets = tickets.filter((ticket) => {
    if (status !== "ALL" && ticket.status !== status) return false;
    if (priority !== "ALL" && ticket.priority !== priority) return false;
    if (assignedToId !== "ALL" && assignedToId !== "" && ticket.assignedTo?.id !== assignedToId) return false;
    return true;
  });


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
              className="bg-zinc-100 text-zinc-900 px-3.5 py-1.5 rounded-lg flex items-center gap-2 text-sm font-semibold transition-colors"
            >
              <LayoutGrid size={16} />
              Dashboard
            </Link>
            {currentUser?.role === "ADMIN" && (
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
            className="border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors shadow-xs"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-8 space-y-8">
        
        {/* Page Title & Actions */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900">Support Tickets</h1>
            <p className="text-sm text-zinc-500">Manage, filter, and resolve issues for your active tenant.</p>
          </div>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <button className="border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-900 text-sm font-semibold px-4 py-2.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-xs">
                <Plus size={16} />
                Create Ticket
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-md bg-white border-zinc-200 text-zinc-900">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold text-zinc-900">Create Support Ticket</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateTicket} className="space-y-4 pt-2 text-sm">
                {createError && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                    {createError}
                  </div>
                )}
                
                <div className="space-y-1.5">
                  <Label htmlFor="title" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Title</Label>
                  <Input
                    id="title"
                    placeholder="Database connection timeout"
                    value={newTicket.title}
                    onChange={(e) => setNewTicket({ ...newTicket, title: e.target.value })}
                    required
                    className="h-10 text-sm bg-zinc-50 border-zinc-200 text-zinc-950 placeholder-zinc-400 focus:border-zinc-350 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="description" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Description</Label>
                  <Input
                    id="description"
                    placeholder="Describe the issue in details..."
                    value={newTicket.description}
                    onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                    required
                    className="h-10 text-sm bg-zinc-50 border-zinc-200 text-zinc-950 placeholder-zinc-400 focus:border-zinc-350 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="priorityInput" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Priority</Label>
                    <Select
                      value={newTicket.priority}
                      onValueChange={(val) => setNewTicket({ ...newTicket, priority: val })}
                    >
                      <SelectTrigger id="priorityInput" className="h-10 text-sm bg-zinc-50 border-zinc-200 text-zinc-900">
                        <SelectValue placeholder="Select priority" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-zinc-200 text-zinc-900">
                        <SelectItem value="LOW">Low</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="CRITICAL">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="assignedToIdInput" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Assignee (Optional)</Label>
                    <Select
                      value={newTicket.assignedToId}
                      onValueChange={(val) => setNewTicket({ ...newTicket, assignedToId: val === "unassigned" ? "" : val })}
                    >
                      <SelectTrigger id="assignedToIdInput" className="h-10 text-sm bg-zinc-50 border-zinc-200 text-zinc-900">
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
                </div>

                <DialogFooter className="pt-4">
                  <Button type="button" variant="ghost" className="text-zinc-500 hover:text-zinc-900" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-zinc-900 hover:bg-zinc-800 text-white font-semibold" disabled={createLoading}>
                    {createLoading ? "Creating..." : "Save Ticket"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-white border-zinc-200 shadow-xs">
            <CardContent className="p-5 flex flex-col justify-between h-28">
              <div className="flex items-center justify-between text-zinc-500 text-xs font-semibold">
                <span>Total tickets</span>
                <Ticket size={16} className="text-zinc-400" />
              </div>
              <span className="text-4xl font-extrabold text-zinc-900 tracking-tight">
                {stats.total}
              </span>
            </CardContent>
          </Card>

          <Card className="bg-white border-zinc-200 shadow-xs">
            <CardContent className="p-5 flex flex-col justify-between h-28">
              <div className="flex items-center justify-between text-zinc-500 text-xs font-semibold">
                <span>Open</span>
                <CircleDot size={16} className="text-blue-500" />
              </div>
              <span className="text-4xl font-extrabold text-blue-600 tracking-tight">
                {stats.open}
              </span>
            </CardContent>
          </Card>

          <Card className="bg-white border-zinc-200 shadow-xs">
            <CardContent className="p-5 flex flex-col justify-between h-28">
              <div className="flex items-center justify-between text-zinc-500 text-xs font-semibold">
                <span>High priority</span>
                <AlertTriangle size={16} className="text-orange-500" />
              </div>
              <span className="text-4xl font-extrabold text-orange-600 tracking-tight">
                {stats.highPriority}
              </span>
            </CardContent>
          </Card>

          <Card className="bg-white border-zinc-200 shadow-xs">
            <CardContent className="p-5 flex flex-col justify-between h-28">
              <div className="flex items-center justify-between text-zinc-500 text-xs font-semibold">
                <span>Resolved</span>
                <CheckCircle2 size={16} className="text-emerald-500" />
              </div>
              <span className="text-4xl font-extrabold text-emerald-600 tracking-tight">
                {stats.resolved}
              </span>
            </CardContent>
          </Card>
        </div>

        {/* Filter Controls Card */}
        <div className="bg-white border border-zinc-200 shadow-xs rounded-xl p-4 flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-1.5 min-w-[140px] flex-1">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Status</span>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-10 text-xs bg-zinc-50 border-zinc-200 text-zinc-800">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent className="bg-white border-zinc-200 text-zinc-900">
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="OPEN">Open</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="RESOLVED">Resolved</SelectItem>
                <SelectItem value="CLOSED">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 min-w-[140px] flex-1">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Priority</span>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="h-10 text-xs bg-zinc-50 border-zinc-200 text-zinc-800">
                <SelectValue placeholder="All priorities" />
              </SelectTrigger>
              <SelectContent className="bg-white border-zinc-200 text-zinc-900">
                <SelectItem value="ALL">All priorities</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="CRITICAL">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 min-w-[160px] flex-1">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Assignee</span>
            <Select value={assignedToId} onValueChange={setAssignedToId}>
              <SelectTrigger className="h-10 text-xs bg-zinc-50 border-zinc-200 text-zinc-800">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent className="bg-white border-zinc-200 text-zinc-900">
                <SelectItem value="ALL">All agents</SelectItem>
                {agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search box & reset button */}
          <div className="flex flex-col gap-1.5 min-w-[200px] flex-2 relative">
            <span className="text-[10px] font-bold text-transparent select-none uppercase tracking-wider">Search</span>
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" size={15} />
              <Input
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="h-10 text-xs pl-9 bg-zinc-50 border-zinc-200 text-zinc-800 placeholder-zinc-400 focus:border-zinc-300 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-11 bg-white border border-zinc-200 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto py-1">
                  {suggestions.map((s) => (
                    <div
                      key={s.ticketId}
                      onClick={() => {
                        setSearchQuery(s.title);
                        setShowSuggestions(false);
                      }}
                      className="px-4 py-2 text-xs text-zinc-700 hover:bg-zinc-100 cursor-pointer font-medium truncate"
                    >
                      🔍 {s.title}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-transparent select-none uppercase tracking-wider">Action</span>
            <button
              onClick={resetFilters}
              className="h-10 px-4 border border-zinc-200 bg-transparent hover:bg-zinc-55 text-zinc-600 hover:text-zinc-900 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-colors"
            >
              <X size={14} />
              Reset
            </button>
          </div>
        </div>

        {/* Tickets Grid / Table */}
        <div className="bg-white border border-zinc-200 shadow-xs rounded-xl overflow-hidden">
          {error && (
            <div className="m-4 rounded-lg bg-red-50 p-4 text-xs text-red-600 border border-red-200 font-medium">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col justify-center items-center py-20 text-zinc-500 text-sm gap-2">
              <Loader2 className="animate-spin text-zinc-400" size={24} />
              <span>Loading workspace tickets...</span>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-2 text-zinc-400">
              <span className="text-lg font-bold text-zinc-900">No tickets found</span>
              <span className="text-xs text-zinc-500">Try relaxing your filters or create a new support ticket.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="border-b border-zinc-200 bg-zinc-50/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[30%] text-xs font-bold text-zinc-500 uppercase tracking-wider py-3 pl-6">Ticket / Description</TableHead>
                    <TableHead className="w-[18%] text-xs font-bold text-zinc-500 uppercase tracking-wider py-3">Ticket Status</TableHead>
                    <TableHead className="w-[18%] text-xs font-bold text-zinc-500 uppercase tracking-wider py-3">Priority</TableHead>
                    <TableHead className="w-[18%] text-xs font-bold text-zinc-500 uppercase tracking-wider py-3">Assignee</TableHead>
                    <TableHead className="w-[18%] text-xs font-bold text-zinc-500 uppercase tracking-wider py-3">Creator</TableHead>
                    <TableHead className="w-[12%] text-xs font-bold text-zinc-500 uppercase tracking-wider py-3 text-right pr-6">Created At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTickets.map((ticket) => (
                    <TableRow
                      key={ticket.id}
                      className="cursor-pointer border-b border-zinc-200 hover:bg-zinc-50/50 transition-colors"
                      onClick={() => router.push(`/tickets/${ticket.id}`)}
                    >
                      <TableCell className="py-4 pl-6">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-bold text-zinc-900 hover:text-blue-600 transition-colors">{ticket.title}</span>
                          <span className="text-xs text-zinc-500 line-clamp-1 max-w-[320px]">
                            {ticket.description}
                          </span>
                        </div>
                      </TableCell>
                      
                      <TableCell>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                          ticket.status === 'OPEN' ? 'border-blue-200 bg-blue-50 text-blue-700' :
                          ticket.status === 'IN_PROGRESS' ? 'border-amber-200 bg-amber-50 text-amber-800' :
                          ticket.status === 'PENDING' ? 'border-orange-200 bg-orange-50 text-orange-700' :
                          ticket.status === 'RESOLVED' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
                          'border-zinc-200 bg-zinc-50 text-zinc-650'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            ticket.status === 'OPEN' ? 'bg-blue-500 animate-pulse' :
                            ticket.status === 'IN_PROGRESS' ? 'bg-amber-500' :
                            ticket.status === 'PENDING' ? 'bg-orange-500' :
                            ticket.status === 'RESOLVED' ? 'bg-emerald-500' :
                            'bg-zinc-400'
                          }`} />
                          {ticket.status.charAt(0) + ticket.status.slice(1).toLowerCase().replace('_', ' ')}
                        </span>
                      </TableCell>

                      <TableCell>
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                          ticket.priority === 'LOW' ? 'border-zinc-200 bg-zinc-50 text-zinc-600' :
                          ticket.priority === 'MEDIUM' ? 'border-amber-200 bg-amber-50 text-amber-800' :
                          ticket.priority === 'HIGH' ? 'border-orange-200 bg-orange-50 text-orange-700' :
                          'border-rose-200 bg-rose-50 text-rose-700'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            ticket.priority === 'LOW' ? 'bg-zinc-400' :
                            ticket.priority === 'MEDIUM' ? 'bg-amber-500' :
                            ticket.priority === 'HIGH' ? 'bg-orange-500' :
                            'bg-rose-500'
                          }`} />
                          {ticket.priority.charAt(0) + ticket.priority.slice(1).toLowerCase()}
                        </span>
                      </TableCell>

                      <TableCell>
                        {ticket.assignedTo ? (
                          <div className="flex items-center gap-2">
                            <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold ${getAvatarBg(ticket.assignedTo.name)}`}>
                              {getInitials(ticket.assignedTo.name)}
                            </span>
                            <span className="text-xs font-medium text-zinc-700">
                              {ticket.assignedTo.name}
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-400 text-xs italic">Unassigned</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold ${getAvatarBg(ticket.creator.name)}`}>
                            {getInitials(ticket.creator.name)}
                          </span>
                          <span className="text-xs font-medium text-zinc-700">
                            {ticket.creator.name}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell className="text-right text-zinc-450 text-xs font-medium pr-6">
                        {new Date(ticket.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric'
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Cursor Pagination Button */}
        {nextCursor && (
          <div className="flex justify-center pt-2">
            <button
              disabled={loadingMore}
              onClick={() => fetchTickets(nextCursor, true)}
              className="border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 text-xs font-semibold px-5 py-2.5 rounded-lg transition-colors shadow-xs"
            >
              {loadingMore ? "Loading more..." : "Load More Tickets"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

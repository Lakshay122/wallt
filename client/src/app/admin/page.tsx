"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, Shield, Plus, X, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getErrorMessage } from "@/lib/utils";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";


interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface FailedNotification {
  id: string;
  event: string;
  payload: any;
  reason: string;
  createdAt: string;
}

export default function AdminPage() {
  const router = useRouter();
  
  // App states
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [agents, setAgents] = useState<User[]>([]);
  const [failedNotifs, setFailedNotifs] = useState<FailedNotification[]>([]);
  const [notifCursor, setNotifCursor] = useState<string | null>(null);
  
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [loadingMoreNotifs, setLoadingMoreNotifs] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  
  const [analyticsData, setAnalyticsData] = useState<{
    statusCounts: { OPEN: number; IN_PROGRESS: number; RESOLVED: number; CLOSED: number };
    avgResolutionTime: number;
    dailyCreations: Array<{ date: string; count: number }>;
    topAgents: Array<{ id: string; name: string; count: number }>;
  } | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(true);
  const [analyticsError, setAnalyticsError] = useState("");

  // Webhook settings states
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookActive, setWebhookActive] = useState(true);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [loadingWebhook, setLoadingWebhook] = useState(true);
  const [updatingWebhook, setUpdatingWebhook] = useState(false);
  const [webhookError, setWebhookError] = useState("");
  const [webhookSuccess, setWebhookSuccess] = useState("");
  
  const [error, setError] = useState("");
  
  // Onboard agent states
  const [inviteOpen, setInviteOpen] = useState(false);
  const [newAgent, setNewAgent] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");

  // Edit agent states
  const [editOpen, setEditOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<{ id: string; name: string; email: string } | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete confirmation states
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [deleteConfirmLoading, setDeleteConfirmLoading] = useState(false);

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

  // Fetch current user and check authorization
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
          }
        }
      } catch (err) {
        console.error("Failed to load current user details:", err);
      }
    }
    loadMeta();
  }, [router]);

  // Fetch agents
  const fetchAgents = async () => {
    setLoadingAgents(true);
    setError("");
    try {
      const res = await fetch("/api/users");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.status === 403) {
        setIsAdmin(false);
        return;
      }
      setIsAdmin(true);
      if (!res.ok) {
        throw new Error(await getErrorMessage(res, "Failed to load agents."));
      }
      const data = await res.json();
      setAgents(data.data || []);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoadingAgents(false);
    }
  };

  const fetchFailedNotifications = async (cursorVal = "", append = false) => {
    if (append) setLoadingMoreNotifs(true);
    else setLoadingNotifs(true);
    try {
      let url = `/api/admin/failed-notifications?limit=10`;
      if (cursorVal) url += `&cursor=${cursorVal}`;
      
      const res = await fetch(url);
      if (res.status === 403) {
        setIsAdmin(false);
        return;
      }
      const data = await res.json();
      if (res.ok && data.success) {
        if (append) {
          setFailedNotifs((prev) => [...prev, ...data.data]);
        } else {
          setFailedNotifs(data.data || []);
        }
        setNotifCursor(data.nextCursor || null);
      }
    } catch (err) {
      console.error("Failed to load DLQ data:", err);
    } finally {
      setLoadingNotifs(false);
      setLoadingMoreNotifs(false);
    }
  };

  const fetchAnalytics = async () => {
    setLoadingAnalytics(true);
    setAnalyticsError("");
    try {
      const res = await fetch("/api/analytics");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (res.status === 403) {
        setAnalyticsError("Forbidden: Access restricted to administrators.");
        return;
      }
      const data = await res.json();
      if (res.ok && data.success) {
        setAnalyticsData(data.data);
      } else {
        setAnalyticsError(data.error || "Failed to load analytics.");
      }
    } catch (err: any) {
      setAnalyticsError(err.message || "Failed to fetch analytics.");
    } finally {
      setLoadingAnalytics(false);
    }
  };

  const fetchWebhookConfig = async () => {
    setLoadingWebhook(true);
    setWebhookError("");
    try {
      const res = await fetch("/api/admin/webhooks");
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setWebhookUrl(data.data.url || "");
          setWebhookActive(data.data.isActive);
          setWebhookSecret(data.data.secret || "");
        }
      }
    } catch (err) {
      console.error("Failed to load webhook configuration:", err);
    } finally {
      setLoadingWebhook(false);
    }
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingWebhook(true);
    setWebhookError("");
    setWebhookSuccess("");

    try {
      const res = await fetch("/api/admin/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl, isActive: webhookActive }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setWebhookSuccess("Webhook settings updated successfully!");
        setWebhookUrl(data.data.url || "");
        setWebhookActive(data.data.isActive);
        setWebhookSecret(data.data.secret || "");
      } else {
        setWebhookError(data.message || "Failed to save webhook settings.");
      }
    } catch (err: any) {
      setWebhookError(err.message || "Failed to update webhook config.");
    } finally {
      setUpdatingWebhook(false);
    }
  };

  useEffect(() => {
    fetchAgents();
    fetchFailedNotifications();
    fetchAnalytics();
    fetchWebhookConfig();
  }, []);

  // Toggle agent active status
  const handleToggleStatus = async (agent: User) => {
    try {
      const res = await fetch(`/api/users/${agent.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !agent.isActive }),
      });
      if (!res.ok) {
        throw new Error(await getErrorMessage(res, "Failed to toggle status."));
      }
      fetchAgents(); // Refresh directory
    } catch (err: any) {
      alert(err.message || "Failed to update status.");
    }
  };

  // Open Delete Confirmation Dialog
  const triggerDeleteAgent = (agentId: string) => {
    setDeletingAgentId(agentId);
    setDeleteConfirmOpen(true);
  };

  // Perform actual Delete Action
  const executeDeleteAgent = async () => {
    if (!deletingAgentId) return;
    setDeleteConfirmLoading(true);
    try {
      const res = await fetch(`/api/users/${deletingAgentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(await getErrorMessage(res, "Failed to delete agent."));
      }
      setDeleteConfirmOpen(false);
      setDeletingAgentId(null);
      fetchAgents(); // Refresh directory
    } catch (err: any) {
      alert(err.message || "Failed to delete agent.");
    } finally {
      setDeleteConfirmLoading(false);
    }
  };

  // Open Edit Agent Dialog
  const triggerEditAgent = (agent: User) => {
    setEditingAgent({
      id: agent.id,
      name: agent.name,
      email: agent.email,
    });
    setEditError("");
    setEditOpen(true);
  };

  // Save the Edited Agent
  const handleEditAgentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAgent) return;
    setEditLoading(true);
    setEditError("");
    try {
      const res = await fetch(`/api/users/${editingAgent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingAgent.name,
          email: editingAgent.email,
        }),
      });
      if (!res.ok) {
        throw new Error(await getErrorMessage(res, "Failed to update agent."));
      }
      setEditOpen(false);
      setEditingAgent(null);
      fetchAgents(); // Refresh directory
    } catch (err: any) {
      setEditError(err.message || "Failed to update agent.");
    } finally {
      setEditLoading(false);
    }
  };

  // Submit agent invitation
  const handleOnboardAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteLoading(true);
    setInviteError("");

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAgent),
      });
      if (!res.ok) {
        throw new Error(await getErrorMessage(res, "Failed to invite agent."));
      }
      
      setInviteOpen(false);
      setNewAgent({ name: "", email: "", password: "" });
      fetchAgents(); // Refresh directory
    } catch (err: any) {
      setInviteError(err.message || "Failed to onboard agent.");
    } finally {
      setInviteLoading(false);
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

  if (isAdmin === false) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center bg-zinc-50 text-zinc-900 font-sans selection:bg-zinc-200">
        <h2 className="text-2xl font-bold text-red-600">Access Forbidden</h2>
        <p className="text-sm text-zinc-500 mt-2">You must have an ADMIN role to view the workspace administrative dashboard.</p>
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
            <Link 
              href="/admin" 
              className="bg-zinc-100 text-zinc-900 px-3.5 py-1.5 rounded-lg flex items-center gap-2 text-sm font-semibold transition-colors"
            >
              <Shield size={16} />
              Admin Room
            </Link>
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

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-8 space-y-8">
        <div className="space-y-1">
          <h1 className="text-3xl font-extrabold tracking-tight text-zinc-900">Workspace Administration</h1>
          <p className="text-sm text-zinc-500">Onboard agents, configure access states, and audit background delivery systems.</p>
        </div>

        <Tabs defaultValue="agents" className="space-y-6">
          <TabsList className="bg-zinc-200/50 border border-zinc-200">
            <TabsTrigger value="agents" className="text-sm py-1.5 px-4 font-semibold text-zinc-600 data-[state=active]:bg-white data-[state=active]:text-zinc-900">Agent Management</TabsTrigger>
            <TabsTrigger value="dlq" className="text-sm py-1.5 px-4 font-semibold text-zinc-600 data-[state=active]:bg-white data-[state=active]:text-zinc-900">Delivery Failure Logs (DLQ)</TabsTrigger>
            <TabsTrigger value="analytics" className="text-sm py-1.5 px-4 font-semibold text-zinc-600 data-[state=active]:bg-white data-[state=active]:text-zinc-900">Analytics Dashboard</TabsTrigger>
            <TabsTrigger value="webhooks" className="text-sm py-1.5 px-4 font-semibold text-zinc-600 data-[state=active]:bg-white data-[state=active]:text-zinc-900">Webhooks Settings</TabsTrigger>
          </TabsList>

          {/* Agents Management Tab */}
          <TabsContent value="agents" className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-zinc-900">Workspace Agents Directory</h2>
              
              <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogTrigger asChild>
                  <button className="border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-900 text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors shadow-xs">
                    <Plus size={16} />
                    Onboard Agent
                  </button>
                </DialogTrigger>
                <DialogContent className="max-w-md bg-white border-zinc-200 text-zinc-900">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-bold text-zinc-900">Invite New Support Agent</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleOnboardAgent} className="space-y-4 pt-2 text-sm">
                    {inviteError && (
                      <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                        {inviteError}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="agentName" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Full Name</Label>
                      <Input
                        id="agentName"
                        placeholder="Jane Agent"
                        value={newAgent.name}
                        onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
                        required
                        className="h-10 text-sm bg-zinc-50 border-zinc-200 text-zinc-950 placeholder-zinc-400 focus:border-zinc-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="agentEmail" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Email Address</Label>
                      <Input
                        id="agentEmail"
                        type="email"
                        placeholder="jane@beta.com"
                        value={newAgent.email}
                        onChange={(e) => setNewAgent({ ...newAgent, email: e.target.value })}
                        required
                        className="h-10 text-sm bg-zinc-50 border-zinc-200 text-zinc-950 placeholder-zinc-400 focus:border-zinc-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="agentPassword" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Temporary Password</Label>
                      <Input
                        id="agentPassword"
                        type="password"
                        placeholder="••••••••"
                        value={newAgent.password}
                        onChange={(e) => setNewAgent({ ...newAgent, password: e.target.value })}
                        required
                        className="h-10 text-sm bg-zinc-50 border-zinc-200 text-zinc-950 placeholder-zinc-400 focus:border-zinc-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                    </div>

                    <DialogFooter className="pt-4">
                      <Button type="button" variant="ghost" className="text-zinc-500 hover:text-zinc-900" onClick={() => setInviteOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" className="bg-zinc-900 hover:bg-zinc-800 text-white font-semibold" disabled={inviteLoading}>
                        {inviteLoading ? "Onboarding..." : "Invite Agent"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>

              {/* Edit Agent Dialog */}
              <Dialog open={editOpen} onOpenChange={setEditOpen}>
                <DialogContent className="max-w-md bg-white border-zinc-200 text-zinc-900">
                  <DialogHeader>
                    <DialogTitle className="text-xl font-bold text-zinc-900">Edit Support Agent Details</DialogTitle>
                  </DialogHeader>
                  {editingAgent && (
                    <form onSubmit={handleEditAgentSubmit} className="space-y-4 pt-2 text-sm">
                      {editError && (
                        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                          {editError}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label htmlFor="editAgentName" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Full Name</Label>
                        <Input
                          id="editAgentName"
                          placeholder="Jane Agent"
                          value={editingAgent.name}
                          onChange={(e) => setEditingAgent({ ...editingAgent, name: e.target.value })}
                          required
                          className="h-10 text-sm bg-zinc-50 border-zinc-200 text-zinc-950 focus:border-zinc-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="editAgentEmail" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Email Address</Label>
                        <Input
                          id="editAgentEmail"
                          type="email"
                          placeholder="jane@beta.com"
                          value={editingAgent.email}
                          onChange={(e) => setEditingAgent({ ...editingAgent, email: e.target.value })}
                          required
                          className="h-10 text-sm bg-zinc-50 border-zinc-200 text-zinc-955 focus:border-zinc-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                        />
                      </div>

                      <DialogFooter className="pt-4">
                        <Button type="button" variant="ghost" className="text-zinc-500 hover:text-zinc-900" onClick={() => setEditOpen(false)}>
                          Cancel
                        </Button>
                        <Button type="submit" className="bg-zinc-900 hover:bg-zinc-800 text-white font-semibold" disabled={editLoading}>
                          {editLoading ? "Saving..." : "Save Changes"}
                        </Button>
                      </DialogFooter>
                    </form>
                  )}
                </DialogContent>
              </Dialog>

              {/* Delete Agent Confirmation Dialog */}
              <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                <DialogContent className="max-w-md bg-white border-zinc-200 text-zinc-900">
                  <DialogHeader>
                    <DialogTitle className="text-lg font-bold text-zinc-900">Confirm Permanent Deletion</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-2 text-sm text-zinc-600">
                    <p>Are you sure you want to permanently delete this agent? This action cannot be undone and will revoke their workspace access immediately.</p>
                    <DialogFooter className="pt-4">
                      <Button type="button" variant="ghost" className="text-zinc-500 hover:text-zinc-900" onClick={() => setDeleteConfirmOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="button" className="bg-red-600 hover:bg-red-700 text-white font-semibold" disabled={deleteConfirmLoading} onClick={executeDeleteAgent}>
                        {deleteConfirmLoading ? "Deleting..." : "Permanently Delete"}
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Card className="border-zinc-200 bg-white shadow-xs rounded-xl overflow-hidden">
              <CardContent className="p-0">
                {loadingAgents ? (
                  <div className="flex flex-col justify-center items-center py-20 text-zinc-500 text-sm gap-2">
                    <Loader2 className="animate-spin text-zinc-400" size={24} />
                    <span>Loading agent profiles...</span>
                  </div>
                ) : error ? (
                  <div className="m-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                    {error}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="border-b border-zinc-200 bg-zinc-50/50">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="text-xs font-bold text-zinc-500 uppercase tracking-wider py-3 pl-6">Name</TableHead>
                          <TableHead className="text-xs font-bold text-zinc-500 uppercase tracking-wider py-3">Email</TableHead>
                          <TableHead className="text-xs font-bold text-zinc-500 uppercase tracking-wider py-3">Role</TableHead>
                          <TableHead className="text-xs font-bold text-zinc-500 uppercase tracking-wider py-3">Status</TableHead>
                          <TableHead className="text-xs font-bold text-zinc-500 uppercase tracking-wider py-3">Added On</TableHead>
                          <TableHead className="text-right text-xs font-bold text-zinc-500 uppercase tracking-wider py-3 pr-6">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agents.map((agent) => (
                          <TableRow key={agent.id} className="border-b border-zinc-200 hover:bg-zinc-50/50 transition-colors">
                            <TableCell className="font-bold text-zinc-900 py-4 text-sm pl-6">{agent.name}</TableCell>
                            <TableCell className="text-sm text-zinc-700">{agent.email}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="border-zinc-200 text-zinc-800 bg-zinc-50 text-[10px] py-0.5 px-2 font-semibold uppercase">
                                {agent.role}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {agent.isActive ? (
                                <Badge className="bg-zinc-900 text-white border-none text-[10px] py-0.5 px-2 font-semibold">Active</Badge>
                              ) : (
                                <Badge className="bg-zinc-400 text-white border-none text-[10px] py-0.5 px-2 font-semibold">Disabled</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-zinc-500">
                              {new Date(agent.createdAt).toLocaleDateString('en-GB', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric'
                              })}
                            </TableCell>
                            <TableCell className="text-right space-x-2 py-4 pr-6">
                              {agent.role !== "ADMIN" && (
                                <>
                                  <button
                                    className="text-xs font-semibold px-2.5 py-1 border border-zinc-200 hover:bg-zinc-50 rounded-lg text-zinc-700 transition-colors"
                                    onClick={() => triggerEditAgent(agent)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="text-xs font-semibold px-2.5 py-1 border border-zinc-200 hover:bg-zinc-50 rounded-lg text-zinc-700 transition-colors"
                                    onClick={() => handleToggleStatus(agent)}
                                  >
                                    {agent.isActive ? "Disable" : "Enable"}
                                  </button>
                                  <button
                                    className="text-xs font-semibold px-2.5 py-1 hover:bg-red-50 text-zinc-500 hover:text-red-600 rounded-lg transition-colors"
                                    onClick={() => triggerDeleteAgent(agent.id)}
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Delivery Failure Logs Tab */}
          <TabsContent value="dlq" className="space-y-4">
            <h2 className="text-lg font-bold text-zinc-900">Delivery Failure Audits (DLQ Persistence)</h2>
            <Card className="border-zinc-200 bg-white shadow-xs rounded-xl overflow-hidden">
              <CardContent className="p-0">
                {loadingNotifs ? (
                  <div className="flex flex-col justify-center items-center py-20 text-zinc-500 text-sm gap-2">
                    <Loader2 className="animate-spin text-zinc-400" size={24} />
                    <span>Loading quarantined notifications...</span>
                  </div>
                ) : failedNotifs.length === 0 ? (
                  <div className="text-center text-zinc-500 py-16 italic text-sm">
                    No failed delivery logs found. Worker is running healthy!
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="border-b border-zinc-200 bg-zinc-50/50">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="text-xs font-bold text-zinc-500 uppercase tracking-wider py-3 pl-6">Event Type</TableHead>
                          <TableHead className="text-xs font-bold text-zinc-500 uppercase tracking-wider py-3">Failure Reason</TableHead>
                          <TableHead className="text-xs font-bold text-zinc-500 uppercase tracking-wider py-3">Payload Preview</TableHead>
                          <TableHead className="text-right text-xs font-bold text-zinc-500 uppercase tracking-wider py-3 pr-6">Failed At</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {failedNotifs.map((notif) => (
                          <TableRow key={notif.id} className="border-b border-zinc-200 hover:bg-zinc-50/50 transition-colors">
                            <TableCell className="font-mono text-xs text-zinc-900 font-semibold py-4 pl-6">{notif.event}</TableCell>
                            <TableCell className="text-xs max-w-[350px]">
                              <pre className="overflow-y-auto bg-red-50 p-3 rounded-lg border border-red-200 font-mono text-[10px] text-red-700 max-h-24 whitespace-pre-wrap break-all">
                                {notif.reason}
                              </pre>
                            </TableCell>
                            <TableCell className="text-xs max-w-[350px]">
                              <pre className="overflow-x-auto bg-zinc-50 p-3 rounded-lg border border-zinc-250 font-mono text-[10px] text-zinc-700 max-h-24">
                                {JSON.stringify(notif.payload, null, 2)}
                              </pre>
                            </TableCell>
                            <TableCell className="text-right text-xs text-zinc-500 pr-6">
                              {new Date(notif.createdAt).toLocaleString()}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {notifCursor && (
                      <div className="flex justify-center py-4 border-t border-zinc-200">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => fetchFailedNotifications(notifCursor, true)}
                          disabled={loadingMoreNotifs}
                          className="text-xs font-bold text-zinc-600 hover:text-zinc-900"
                        >
                          {loadingMoreNotifs ? "Loading more..." : "Load More Logs"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Dashboard Tab */}
          <TabsContent value="analytics" className="space-y-6">
            {loadingAnalytics ? (
              <div className="flex flex-col justify-center items-center py-20 text-zinc-500 text-sm gap-2">
                <Loader2 className="animate-spin text-zinc-400" size={24} />
                <span>Loading analytics reports...</span>
              </div>
            ) : analyticsError ? (
              <div className="text-xs text-red-655 bg-red-50 border border-red-200 rounded-lg p-3">
                {analyticsError}
              </div>
            ) : analyticsData ? (
              <div className="space-y-6">
                {/* Metrics Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card className="border-zinc-200 bg-white shadow-xs">
                    <CardHeader className="py-4">
                      <CardTitle className="text-xs font-bold text-zinc-400 uppercase tracking-wider font-sans">Open (Current Month)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-extrabold text-zinc-900">{analyticsData.statusCounts.OPEN}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-zinc-200 bg-white shadow-xs">
                    <CardHeader className="py-4">
                      <CardTitle className="text-xs font-bold text-zinc-400 uppercase tracking-wider font-sans">In Progress (Current Month)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-extrabold text-zinc-900">{analyticsData.statusCounts.IN_PROGRESS}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-zinc-200 bg-white shadow-xs">
                    <CardHeader className="py-4">
                      <CardTitle className="text-xs font-bold text-zinc-400 uppercase tracking-wider font-sans">Resolved (Current Month)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-extrabold text-zinc-900">{analyticsData.statusCounts.RESOLVED + analyticsData.statusCounts.CLOSED}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-zinc-200 bg-white shadow-xs">
                    <CardHeader className="py-4">
                      <CardTitle className="text-xs font-bold text-zinc-400 uppercase tracking-wider font-sans">Avg Resolution Time</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-extrabold text-zinc-900">{analyticsData.avgResolutionTime} hrs</div>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Daily Ticket Creations Chart */}
                  <Card className="lg:col-span-2 border-zinc-200 bg-white shadow-xs">
                    <CardHeader className="border-b border-zinc-100 py-4">
                      <CardTitle className="text-sm font-bold text-zinc-800 font-sans">Tickets Created (Last 30 Days)</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6">
                      <div className="w-full h-72">
                        {analyticsData.dailyCreations.length === 0 ? (
                          <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm italic">
                            No tickets created in the last 30 days.
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={analyticsData.dailyCreations} margin={{ left: -20, right: 10, top: 10, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f4f4f5" />
                              <XAxis 
                                dataKey="date" 
                                stroke="#888888" 
                                fontSize={10} 
                                tickLine={false} 
                                axisLine={false} 
                                tickFormatter={(str) => {
                                  const parts = str.split("-");
                                  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : str;
                                }}
                              />
                              <YAxis 
                                stroke="#888888" 
                                fontSize={10} 
                                tickLine={false} 
                                axisLine={false} 
                              />
                              <Tooltip 
                                contentStyle={{ backgroundColor: "#ffffff", borderColor: "#e4e4e7", borderRadius: "8px", fontSize: "12px" }}
                                labelStyle={{ fontWeight: "bold", color: "#18181b" }}
                              />
                              <Line 
                                type="monotone" 
                                dataKey="count" 
                                name="Tickets" 
                                stroke="#18181b" 
                                strokeWidth={2} 
                                dot={{ stroke: "#18181b", strokeWidth: 1, r: 3, fill: "#ffffff" }}
                                activeDot={{ r: 5 }}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Top Resolving Agents */}
                  <Card className="border-zinc-200 bg-white shadow-xs">
                    <CardHeader className="border-b border-zinc-100 py-4">
                      <CardTitle className="text-sm font-bold text-zinc-800 font-sans">Top Resolving Agents</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      {analyticsData.topAgents.length === 0 ? (
                        <div className="py-10 text-center text-zinc-400 text-sm italic">
                          No agent performance logs found.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {analyticsData.topAgents.map((agent, index) => (
                            <div key={agent.id} className="flex items-center gap-3 py-2 border-b border-zinc-100 last:border-none">
                              <span className="w-6 h-6 flex items-center justify-center bg-zinc-900 text-white font-bold rounded-full text-xs">
                                {index + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-zinc-800 truncate">{agent.name}</p>
                              </div>
                              <Badge className="bg-zinc-100 hover:bg-zinc-100 text-zinc-800 border border-zinc-200 text-xs font-bold py-0.5 px-2.5">
                                {agent.count} resolved
                              </Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : null}
          </TabsContent>

          {/* Webhooks Tab */}
          <TabsContent value="webhooks" className="space-y-6">
            <h2 className="text-lg font-bold text-zinc-900">Webhooks Integration Settings</h2>
            <Card className="border-zinc-200 bg-white shadow-xs rounded-xl overflow-hidden max-w-2xl">
              <CardHeader className="border-b border-zinc-100 py-4 bg-zinc-50/50">
                <CardTitle className="text-sm font-bold text-zinc-800 font-sans">Webhook Endpoint Configuration</CardTitle>
                <CardDescription className="text-xs text-zinc-500 font-sans">
                  Configure a target URL to receive real-time HTTP POST alerts on ticket events.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                {loadingWebhook ? (
                  <div className="flex flex-col justify-center items-center py-10 text-zinc-500 text-sm gap-2">
                    <Loader2 className="animate-spin text-zinc-400" size={20} />
                    <span>Loading webhook details...</span>
                  </div>
                ) : (
                  <form onSubmit={handleSaveWebhook} className="space-y-5 text-sm">
                    {webhookSuccess && (
                      <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                        {webhookSuccess}
                      </div>
                    )}
                    {webhookError && (
                      <div className="text-xs text-red-650 bg-red-50 border border-red-200 rounded-lg p-3">
                        {webhookError}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="webhookUrlInput" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Payload Delivery URL</Label>
                      <Input
                        id="webhookUrlInput"
                        type="url"
                        placeholder="https://your-server.com/webhook"
                        value={webhookUrl}
                        onChange={(e) => setWebhookUrl(e.target.value)}
                        required
                        className="h-10 text-sm bg-zinc-50 border-zinc-200 text-zinc-950 placeholder-zinc-400 focus:border-zinc-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="webhookStatusSelect" className="text-xs font-bold uppercase tracking-wider text-zinc-500">Status</Label>
                      <select
                        id="webhookStatusSelect"
                        value={webhookActive ? "true" : "false"}
                        onChange={(e) => setWebhookActive(e.target.value === "true")}
                        className="w-full h-10 px-3 rounded-md bg-zinc-50 border border-zinc-200 text-zinc-950 text-sm focus:border-zinc-300 focus-visible:ring-0"
                      >
                        <option value="true">Active (Dispatch payloads)</option>
                        <option value="false">Inactive (Suspended)</option>
                      </select>
                    </div>

                    {webhookSecret && (
                      <div className="space-y-2 bg-zinc-50 p-4 rounded-lg border border-zinc-200">
                        <Label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Payload Signature Secret</Label>
                        <div className="font-mono text-xs font-semibold text-zinc-800 break-all select-all">
                          {webhookSecret}
                        </div>
                        <p className="text-[10px] text-zinc-500 leading-relaxed font-sans">
                          Signatures are computed as an HMAC SHA-256 hash of the JSON payload string using this secret and transmitted in the <code>X-Helpdesk-Signature</code> header.
                        </p>
                      </div>
                    )}

                    <div className="flex justify-end pt-2">
                      <Button
                        type="submit"
                        disabled={updatingWebhook}
                        className="bg-zinc-900 hover:bg-zinc-800 text-white font-semibold text-sm px-6"
                      >
                        {updatingWebhook ? "Saving Changes..." : "Save Settings"}
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

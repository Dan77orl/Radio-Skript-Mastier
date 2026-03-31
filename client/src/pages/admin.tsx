import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Users, Activity, Shield, ShieldOff, Trash2, UserCheck, UserX, BarChart3, Clock, MessageSquare, ChevronDown, ChevronRight, Key, Download, Upload, Database } from "lucide-react";

interface UserWithStats {
  id: string;
  email: string;
  name: string | null;
  role: string;
  blocked: boolean;
  createdAt: string;
  stats: {
    dialogs: number;
    programs: number;
    voices: number;
    programTypes: number;
  };
}

interface DashboardData {
  totalUsers: number;
  newThisWeek: number;
  newThisMonth: number;
  activeUsers: number;
  blockedUsers: number;
}

interface UsageLog {
  id: string;
  userId: string | null;
  action: string;
  details: string | null;
  tokensUsed: number | null;
  createdAt: string;
}

interface UsageData {
  stats: { userId: string; action: string; count: number }[];
  logs: UsageLog[];
  storageUsedBytes: number;
}

interface SupportSession {
  sessionId: string;
  userId: string | null;
  user: { email: string; name: string | null } | null;
  messages: {
    id: string;
    role: string;
    content: string;
    createdAt: string;
  }[];
}

export default function AdminPage() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("dashboard");

  const isAdmin = user?.role === "admin";

  const { data: dashboard, isLoading: dashLoading } = useQuery<DashboardData>({
    queryKey: ["/api/admin/dashboard"],
    enabled: isAdmin,
  });

  const { data: users, isLoading: usersLoading } = useQuery<UserWithStats[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin,
  });

  const { data: usage, isLoading: usageLoading } = useQuery<UsageData>({
    queryKey: ["/api/admin/usage"],
    enabled: isAdmin,
  });

  const { data: supportSessions, isLoading: supportLoading } = useQuery<SupportSession[]>({
    queryKey: ["/api/admin/support-messages"],
    enabled: isAdmin,
  });

  const { data: settingsData } = useQuery<Record<string, unknown>>({
    queryKey: ["/api/settings"],
    enabled: isAdmin,
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      toast({ title: "User updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/admin/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
      toast({ title: "User deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      setLocation("/");
    }
  }, [isLoading, isAdmin, setLocation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const actionLabels: Record<string, string> = {
    script_generation: "Script Generation",
    audio_generation: "Audio Generation",
    ad_generation: "Ad Generation",
    file_upload: "File Upload",
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="admin-page">
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-admin-title">Admin Panel</h1>
          <p className="text-muted-foreground text-sm">Platform management and monitoring</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="admin-tabs">
          <TabsTrigger value="dashboard" data-testid="tab-dashboard">
            <BarChart3 className="h-4 w-4 mr-1" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">
            <Users className="h-4 w-4 mr-1" />
            Users
          </TabsTrigger>
          <TabsTrigger value="usage" data-testid="tab-usage">
            <Activity className="h-4 w-4 mr-1" />
            Usage
          </TabsTrigger>
          <TabsTrigger value="support" data-testid="tab-support">
            <MessageSquare className="h-4 w-4 mr-1" />
            Support
          </TabsTrigger>
          <TabsTrigger value="apikeys" data-testid="tab-apikeys">
            <Key className="h-4 w-4 mr-1" />
            API Keys
          </TabsTrigger>
          <TabsTrigger value="data-sync" data-testid="tab-data-sync">
            <Database className="h-4 w-4 mr-1" />
            Data Sync
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          {dashLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : dashboard ? (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold" data-testid="stat-total-users">{dashboard.totalUsers}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">New This Week</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-green-600" data-testid="stat-new-week">{dashboard.newThisWeek}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">New This Month</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-blue-600" data-testid="stat-new-month">{dashboard.newThisMonth}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Active Users</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-emerald-600" data-testid="stat-active">{dashboard.activeUsers}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Blocked</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-red-600" data-testid="stat-blocked">{dashboard.blockedUsers}</div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          {usersLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Dialogs</TableHead>
                      <TableHead>Programs</TableHead>
                      <TableHead>Voices</TableHead>
                      <TableHead>Registered</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users?.map((u) => (
                      <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{u.name || "—"}</div>
                            <div className="text-xs text-muted-foreground">{u.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={u.role === "admin" ? "default" : "secondary"} data-testid={`badge-role-${u.id}`}>
                            {u.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={u.blocked ? "destructive" : "outline"} data-testid={`badge-status-${u.id}`}>
                            {u.blocked ? "Blocked" : "Active"}
                          </Badge>
                        </TableCell>
                        <TableCell>{u.stats.dialogs}</TableCell>
                        <TableCell>{u.stats.programs}</TableCell>
                        <TableCell>{u.stats.voices}</TableCell>
                        <TableCell className="text-sm">{formatDate(u.createdAt)}</TableCell>
                        <TableCell>
                          {u.id !== user?.id && (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => updateUserMutation.mutate({ id: u.id, data: { role: u.role === "admin" ? "user" : "admin" } })}
                                title={u.role === "admin" ? "Remove admin" : "Make admin"}
                                data-testid={`button-toggle-role-${u.id}`}
                              >
                                {u.role === "admin" ? <ShieldOff className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => updateUserMutation.mutate({ id: u.id, data: { blocked: !u.blocked } })}
                                title={u.blocked ? "Unblock" : "Block"}
                                data-testid={`button-toggle-block-${u.id}`}
                              >
                                {u.blocked ? <UserCheck className="h-4 w-4 text-green-600" /> : <UserX className="h-4 w-4 text-orange-600" />}
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="ghost" title="Delete user" data-testid={`button-delete-user-${u.id}`}>
                                    <Trash2 className="h-4 w-4 text-red-600" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete user?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete {u.email} and all their data. This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteUserMutation.mutate(u.id)}
                                      className="bg-red-600 hover:bg-red-700"
                                      data-testid={`button-confirm-delete-${u.id}`}
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          {usageLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : (
            <>
              {usage && (
                <Card className="mb-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Audio Storage Used</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold" data-testid="text-storage-used">
                      {usage.storageUsedBytes < 1024 * 1024
                        ? `${(usage.storageUsedBytes / 1024).toFixed(1)} KB`
                        : usage.storageUsedBytes < 1024 * 1024 * 1024
                        ? `${(usage.storageUsedBytes / (1024 * 1024)).toFixed(1)} MB`
                        : `${(usage.storageUsedBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`}
                    </div>
                  </CardContent>
                </Card>
              )}

              {usage?.stats && usage.stats.length > 0 && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {Object.entries(
                      usage.stats.reduce((acc, s) => {
                        acc[s.action] = (acc[s.action] || 0) + s.count;
                        return acc;
                      }, {} as Record<string, number>)
                    ).map(([action, count]) => (
                      <Card key={action}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium text-muted-foreground">
                            {actionLabels[action] || action}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-3xl font-bold">{count}</div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Per-User Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>User</TableHead>
                            <TableHead>Action</TableHead>
                            <TableHead>Count</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {usage.stats.map((s, i) => {
                            const u = users?.find(u => u.id === s.userId);
                            return (
                              <TableRow key={i} data-testid={`row-usage-${i}`}>
                                <TableCell className="font-medium">
                                  {u?.email || s.userId?.slice(0, 8) || "—"}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline">{actionLabels[s.action] || s.action}</Badge>
                                </TableCell>
                                <TableCell className="font-bold">{s.count}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Recent Activity</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {usage?.logs && usage.logs.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Action</TableHead>
                          <TableHead>Details</TableHead>
                          <TableHead>Tokens</TableHead>
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {usage.logs.slice(0, 50).map((log) => (
                          <TableRow key={log.id}>
                            <TableCell>
                              <Badge variant="outline">{actionLabels[log.action] || log.action}</Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{log.details || "—"}</TableCell>
                            <TableCell>{log.tokensUsed || "—"}</TableCell>
                            <TableCell className="text-sm">
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {formatDate(log.createdAt)}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      No usage data yet. Usage will be tracked as users generate content.
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="support" className="space-y-4">
          {supportLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : supportSessions && supportSessions.length > 0 ? (
            <div className="space-y-3">
              {supportSessions.map((session) => (
                <SupportSessionCard key={session.sessionId} session={session} />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No support conversations yet.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="apikeys" className="space-y-4">
          <ApiKeysTab settings={settingsData as Record<string, string> | undefined} />
        </TabsContent>

        <TabsContent value="data-sync" className="space-y-4">
          <DataSyncTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const API_KEY_SERVICES = [
  { name: "Anthropic (Claude)", key: "anthropicApiKey" },
  { name: "ElevenLabs (TTS)", key: "elevenLabsApiKey" },
  { name: "Yandex Disk", key: "yandexDiskToken" },
  { name: "Freesound", key: "freesoundApiKey" },
];

function ApiKeysTab({ settings }: { settings: Record<string, string> | undefined }) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState("");
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      await apiRequest("POST", "/api/settings", { [key]: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setEditingKey(null);
      setKeyValue("");
      toast({ title: "API key updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Service API Keys</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {API_KEY_SERVICES.map((service) => {
              const isConfigured = settings && settings[service.key] && settings[service.key] !== "";
              const isEditing = editingKey === service.key;
              return (
                <TableRow key={service.key}>
                  <TableCell className="font-medium">{service.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={isConfigured ? "default" : "secondary"}
                      data-testid={`badge-apikey-${service.key}`}
                    >
                      {isConfigured ? "Configured" : "Not set"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <div className="flex gap-2 items-center">
                        <input
                          type="password"
                          value={keyValue}
                          onChange={(e) => setKeyValue(e.target.value)}
                          placeholder="Enter new key..."
                          className="flex-1 p-1 text-sm border rounded bg-background min-w-[200px]"
                          data-testid={`input-apikey-${service.key}`}
                        />
                        <Button
                          size="sm"
                          onClick={() => saveMutation.mutate({ key: service.key, value: keyValue })}
                          disabled={!keyValue.trim() || saveMutation.isPending}
                          data-testid={`button-save-apikey-${service.key}`}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setEditingKey(null); setKeyValue(""); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setEditingKey(service.key); setKeyValue(""); }}
                        data-testid={`button-edit-apikey-${service.key}`}
                      >
                        {isConfigured ? "Update" : "Set Key"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SupportSessionCard({ session }: { session: SupportSession }) {
  const [expanded, setExpanded] = useState(false);
  const [replyText, setReplyText] = useState("");
  const { toast } = useToast();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastMsg = session.messages[session.messages.length - 1];
  const userMsgCount = session.messages.filter(m => m.role === "user").length;

  const replyMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/support-reply", {
        sessionId: session.sessionId,
        message: replyText,
      });
    },
    onSuccess: () => {
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/support-messages"] });
      toast({ title: "Reply sent" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader
        className="cursor-pointer pb-2"
        onClick={() => setExpanded(!expanded)}
        data-testid={`support-session-${session.sessionId}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <div>
              <span className="font-medium">
                {session.user?.name || session.user?.email || "Anonymous"}
              </span>
              {session.user?.email && (
                <span className="text-xs text-muted-foreground ml-2">{session.user.email}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{userMsgCount} messages</Badge>
            <span className="text-xs text-muted-foreground">
              {lastMsg ? new Date(lastMsg.createdAt).toLocaleDateString() : ""}
            </span>
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 space-y-3">
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {session.messages.map((msg) => (
              <div
                key={msg.id}
                className={`p-3 rounded-lg text-sm ${
                  msg.role === "user"
                    ? "bg-blue-50 dark:bg-blue-950/30 ml-0 mr-12"
                    : msg.role === "admin"
                    ? "bg-green-50 dark:bg-green-950/30 ml-12 mr-0"
                    : "bg-muted ml-12 mr-0"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <Badge variant={msg.role === "user" ? "default" : msg.role === "admin" ? "outline" : "secondary"} className="text-xs">
                    {msg.role === "user" ? "User" : msg.role === "admin" ? "Admin" : "AI"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(msg.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type admin reply..."
              className="flex-1 min-h-[60px] p-2 text-sm border rounded-md bg-background resize-none"
              data-testid={`input-reply-${session.sessionId}`}
            />
            <Button
              size="sm"
              onClick={() => replyMutation.mutate()}
              disabled={!replyText.trim() || replyMutation.isPending}
              data-testid={`button-reply-${session.sessionId}`}
            >
              {replyMutation.isPending ? "..." : "Reply"}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function DataSyncTab() {
  const { toast } = useToast();
  const [importResult, setImportResult] = useState<Record<string, { created: number; skipped: number }> | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await apiRequest("GET", "/api/admin/export-data");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `radioflow-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Экспорт завершён", description: "Файл с данными скачан" });
    } catch (err: any) {
      toast({ title: "Ошибка экспорта", description: err.message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.exportVersion) {
        toast({ title: "Ошибка", description: "Неверный формат файла экспорта", variant: "destructive" });
        return;
      }
      const res = await apiRequest("POST", "/api/admin/import-data", data);
      const result = await res.json();
      setImportResult(result.results);
      toast({ title: "Импорт завершён", description: "Данные успешно импортированы" });
      queryClient.invalidateQueries();
    } catch (err: any) {
      toast({ title: "Ошибка импорта", description: err.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const LABEL_MAP: Record<string, string> = {
    settings: "Настройки",
    voices: "Голоса",
    programTypes: "Типы передач",
    programs: "Передачи",
    dialogs: "Подводки",
    ads: "Реклама",
    adPresets: "Шаблоны рекламы",
    newsSources: "Источники новостей",
    scheduleTemplates: "Шаблоны расписания",
    hostShifts: "Смены ведущих",
    automations: "Автоматизации",
    customHolidays: "Праздники",
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Экспорт / Импорт данных</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Перенос данных между dev и production окружениями. Экспортируйте все данные (голоса, передачи, подводки, настройки и т.д.) в JSON-файл, затем импортируйте его в другом окружении.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-dashed">
              <CardContent className="pt-6 text-center space-y-3">
                <Download className="h-10 w-10 mx-auto text-blue-500" />
                <h3 className="font-medium">Экспорт данных</h3>
                <p className="text-xs text-muted-foreground">
                  Скачать все ваши данные в JSON-файл
                </p>
                <Button
                  onClick={handleExport}
                  disabled={isExporting}
                  className="w-full"
                  data-testid="button-export-data"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {isExporting ? "Экспортирую..." : "Скачать экспорт"}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-dashed">
              <CardContent className="pt-6 text-center space-y-3">
                <Upload className="h-10 w-10 mx-auto text-green-500" />
                <h3 className="font-medium">Импорт данных</h3>
                <p className="text-xs text-muted-foreground">
                  Загрузить JSON-файл экспорта. Дубликаты пропускаются.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="hidden"
                  data-testid="input-import-file"
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                  variant="outline"
                  className="w-full"
                  data-testid="button-import-data"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {isImporting ? "Импортирую..." : "Загрузить файл"}
                </Button>
              </CardContent>
            </Card>
          </div>

          {importResult && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Результаты импорта</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Категория</TableHead>
                      <TableHead>Создано</TableHead>
                      <TableHead>Пропущено</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(importResult).map(([key, val]) => (
                      <TableRow key={key}>
                        <TableCell className="font-medium">{LABEL_MAP[key] || key}</TableCell>
                        <TableCell>
                          <Badge variant={val.created > 0 ? "default" : "secondary"} data-testid={`badge-import-created-${key}`}>
                            {val.created}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" data-testid={`badge-import-skipped-${key}`}>
                            {val.skipped}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

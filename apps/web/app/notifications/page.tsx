"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Check, MoreVertical } from "lucide-react";

interface Notification {
  id: string;
  monitoringRunId: string;
  strategyId: string | null;
  strategyName: string | null;
  title: string;
  content: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationData {
  notifications: Notification[];
  unreadCount: number;
  todayCount: number;
  weekActionCount: number;
}

type StatusFilter = "all" | "unread" | "read";

export default function NotificationsPage() {
  const router = useRouter();
  const [data, setData] = useState<NotificationData | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [strategyFilter, setStrategyFilter] = useState<string>("all");
  const [strategies, setStrategies] = useState<Array<{ id: string; name: string }>>([]);

  async function fetchNotifications() {
    const params = new URLSearchParams();
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (strategyFilter !== "all") params.set("strategyId", strategyFilter);

    const res = await fetch(`/api/notifications?${params}`);
    const json = await res.json();
    setData(json);
  }

  useEffect(() => {
    fetch("/api/strategies")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setStrategies(data); });
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [statusFilter, strategyFilter]);

  async function markAsRead(id: string) {
    await fetch(`/api/notifications/${id}/read`, { method: "PUT" });
    fetchNotifications();
  }

  async function markAllAsRead() {
    await fetch("/api/notifications/read-all", { method: "PUT" });
    fetchNotifications();
  }

  async function deleteNotification(id: string) {
    await fetch(`/api/notifications/${id}`, { method: "DELETE" });
    fetchNotifications();
  }

  async function deleteReadNotifications() {
    await fetch("/api/notifications/read", { method: "DELETE" });
    fetchNotifications();
  }

  async function handleClickNotification(n: Notification) {
    if (!n.isRead) await markAsRead(n.id);
    router.push(`/monitoring?runId=${n.monitoringRunId}`);
  }

  const notifications = data?.notifications ?? [];
  const stats = {
    unread: data?.unreadCount ?? 0,
    today: data?.todayCount ?? 0,
    weekAction: data?.weekActionCount ?? 0,
  };

  return (
    <div className="p-4 md:p-6 max-w-none md:max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">通知</h1>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{stats.unread}</p>
            <p className="text-xs text-muted-foreground">未读通知</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold">{stats.today}</p>
            <p className="text-xs text-muted-foreground">今日新增</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-orange-600">{stats.weekAction}</p>
            <p className="text-xs text-muted-foreground">本周建议</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", "unread", "read"] as StatusFilter[]).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "全部" : s === "unread" ? "未读" : "已读"}
            </Button>
          ))}
          <Select value={strategyFilter} onValueChange={(v) => setStrategyFilter(v ?? "all")}>
            <SelectTrigger className="w-40">
              <SelectValue>
                {strategyFilter === "all"
                  ? "全部策略"
                  : strategies.find((s) => s.id === strategyFilter)?.name ?? "按策略过滤"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部策略</SelectItem>
              {strategies.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={markAllAsRead}>全部标记已读</Button>
          <Button variant="outline" size="sm" onClick={deleteReadNotifications}>删除已读</Button>
        </div>
      </div>

      <div className="space-y-2">
        {notifications.length === 0 && (
          <p className="text-muted-foreground text-center py-10">暂无通知</p>
        )}
        {notifications.map((n) => (
          <Card
            key={n.id}
            className={`cursor-pointer ${!n.isRead ? "bg-primary/5" : ""}`}
            onClick={() => handleClickNotification(n)}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <div className="flex items-center gap-3 min-w-0">
                  {!n.isRead && (
                    <span className="shrink-0 w-2 h-2 rounded-full bg-primary" />
                  )}
                  <span className="text-sm font-medium truncate">{n.title}</span>
                  {n.strategyName && (
                    <Badge variant="outline" className="shrink-0">{n.strategyName}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {new Date(n.createdAt).toLocaleDateString("zh-CN", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {!n.isRead && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); markAsRead(n.id); }}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

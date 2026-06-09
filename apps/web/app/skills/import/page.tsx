"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { categoryLabel } from "@/lib/skills-ui";

type SeedManifestStatus = "missing" | "in-sync" | "edited";

interface ManifestEntry {
  name: string;
  description: string | null;
  category: string | null;
  currentBodyHash: string;
  status: SeedManifestStatus;
  source: "seed" | "user" | null;
}

type ImportMode = "create" | "overwrite-seed" | "duplicate";

interface RowState {
  busy: boolean;
  error: string | null;
  success: string | null;
}

interface SkillRow {
  id: string;
  name: string;
}

function statusMeta(
  entry: ManifestEntry
): { label: string; variant: "secondary" | "outline" | "destructive" | "default"; className?: string } {
  if (entry.status === "missing") {
    return { label: "未导入", variant: "outline" };
  }
  if (entry.status === "in-sync") {
    return {
      label: "已最新",
      variant: "secondary",
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    };
  }
  // edited
  if (entry.source === "user") {
    return {
      label: "已自定义",
      variant: "secondary",
      className: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    };
  }
  return {
    label: "仓库版本已更新",
    variant: "secondary",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  };
}

function pickAction(
  entry: ManifestEntry
): { mode: ImportMode; label: string } | null {
  if (entry.status === "missing") return { mode: "create", label: "导入" };
  if (entry.status === "in-sync") return null;
  // edited
  if (entry.source === "seed") return { mode: "overwrite-seed", label: "同步更新" };
  // source === "user" or defensively null
  return { mode: "duplicate", label: "另存为副本" };
}

export default function SkillsImportPage() {
  const [manifest, setManifest] = useState<ManifestEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  const loadManifest = useCallback(async () => {
    try {
      const res = await fetch("/api/skills/seed/manifest");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setLoadError(body.error ?? `HTTP ${res.status}`);
        setManifest([]);
        return;
      }
      const data = (await res.json()) as ManifestEntry[];
      setManifest(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setManifest([]);
    }
  }, []);

  useEffect(() => {
    void loadManifest();
  }, [loadManifest]);

  const handleAction = useCallback(
    async (entry: ManifestEntry, mode: ImportMode) => {
      setRowState((s) => ({
        ...s,
        [entry.name]: { busy: true, error: null, success: null },
      }));
      try {
        const res = await fetch("/api/skills/seed/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: entry.name, mode }),
        });
        const body = (await res.json().catch(() => ({}))) as
          | SkillRow
          | { error?: string };
        if (!res.ok) {
          const errMsg =
            (body as { error?: string }).error ?? `HTTP ${res.status}`;
          setRowState((s) => ({
            ...s,
            [entry.name]: { busy: false, error: errMsg, success: null },
          }));
          return;
        }
        const row = body as SkillRow;
        let successMsg: string;
        if (mode === "duplicate") successMsg = `已创建副本：${row.name}`;
        else if (mode === "overwrite-seed") successMsg = "已同步至最新仓库版本";
        else successMsg = "已导入";
        setRowState((s) => ({
          ...s,
          [entry.name]: { busy: false, error: null, success: successMsg },
        }));
        await loadManifest();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setRowState((s) => ({
          ...s,
          [entry.name]: { busy: false, error: msg, success: null },
        }));
      }
    },
    [loadManifest]
  );

  return (
    <div className="p-4 md:p-6 max-w-none md:max-w-4xl mx-auto space-y-6">
      <div className="space-y-2">
        <Link
          href="/skills"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> 返回技能库
        </Link>
        <h1 className="text-2xl font-bold">导入向导</h1>
        <p className="text-sm text-muted-foreground">
          从仓库 seed 文件创建或更新内置 skill。已被你编辑过的不会被覆盖——可选择「另存为副本」保留你的版本。
        </p>
      </div>

      {manifest === null && !loadError && (
        <p className="text-sm text-muted-foreground py-8 text-center">加载中...</p>
      )}

      {loadError && (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">
            加载 seed 清单失败：{loadError}
          </CardContent>
        </Card>
      )}

      {manifest !== null && manifest.length === 0 && !loadError && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          仓库中没有任何 seed 文件。
        </p>
      )}

      {manifest !== null && manifest.length > 0 && (
        <div className="grid gap-2">
          {manifest.map((entry) => {
            const meta = statusMeta(entry);
            const action = pickAction(entry);
            const state = rowState[entry.name] ?? {
              busy: false,
              error: null,
              success: null,
            };
            return (
              <Card key={entry.name}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{entry.name}</span>
                    {entry.category && (
                      <Badge variant="outline" className="text-[10px]">
                        {categoryLabel(entry.category)}
                      </Badge>
                    )}
                    <Badge
                      variant={meta.variant}
                      className={`text-[10px] ${meta.className ?? ""}`}
                    >
                      {meta.label}
                    </Badge>
                    <div className="ml-auto">
                      {action ? (
                        <Button
                          size="sm"
                          variant={
                            action.mode === "duplicate" ? "outline" : "default"
                          }
                          disabled={state.busy}
                          onClick={() => handleAction(entry, action.mode)}
                        >
                          {state.busy ? "处理中..." : action.label}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground px-2">
                          已最新
                        </span>
                      )}
                    </div>
                  </div>
                  {entry.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {entry.description}
                    </p>
                  )}
                  {state.success && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      {state.success}
                    </p>
                  )}
                  {state.error && (
                    <p className="text-xs text-destructive">
                      失败：{state.error}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

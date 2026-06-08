"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  SKILL_BODY_MAX,
  SKILL_CATEGORIES,
  CATEGORY_LABELS,
  type SkillCategory,
} from "@/lib/skills-ui";

export interface SkillEditorInitial {
  id?: string;
  name?: string;
  description?: string | null;
  category?: SkillCategory | null;
  bodyMd?: string;
}

interface Props {
  mode: "new" | "edit";
  initial?: SkillEditorInitial;
  associationCount?: number;
  associatedStrategyNames?: string[];
}

export function SkillEditor({
  mode,
  initial,
  associationCount = 0,
  associatedStrategyNames = [],
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState<SkillCategory | "">(
    (initial?.category as SkillCategory) ?? ""
  );
  const [body, setBody] = useState(initial?.bodyMd ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const trimmedName = name.trim();
  const trimmedBody = body.trim();
  const overLimit = body.length > SKILL_BODY_MAX;
  const invalid = !trimmedName || !trimmedBody || overLimit;

  const counterClass = useMemo(() => {
    if (overLimit) return "text-destructive font-medium";
    if (body.length > SKILL_BODY_MAX * 0.9) return "text-amber-600";
    return "text-muted-foreground";
  }, [body.length, overLimit]);

  async function handleSave() {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: trimmedName,
        description: description.trim() ? description.trim() : null,
        category: category || null,
        bodyMd: body,
      };
      const res =
        mode === "new"
          ? await fetch("/api/skills", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await fetch(`/api/skills/${initial?.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `保存失败 (${res.status})`);
        return;
      }
      router.push("/skills");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (mode !== "edit" || !initial?.id) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills/${initial.id}`, {
        method: "DELETE",
      });
      if (res.status !== 204 && !res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `删除失败 (${res.status})`);
        return;
      }
      router.push("/skills");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-none md:max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">
          {mode === "new" ? "新建技能" : "编辑技能"}
        </h1>
        {mode === "edit" && (
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={deleting}
          >
            <Trash2 size={14} className="mr-1" />
            删除
          </Button>
        )}
      </div>

      {mode === "edit" && associationCount >= 1 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            该技能当前被 {associationCount} 个策略关联，编辑会同时影响所有策略。
            {associatedStrategyNames.length > 0 && (
              <span className="block text-xs mt-0.5 opacity-80">
                关联策略：{associatedStrategyNames.join("、")}
              </span>
            )}
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="rounded-md border border-destructive bg-destructive/5 px-3 py-3 text-sm space-y-2">
          <p>
            确认删除「{trimmedName || initial?.name}」？
            {associationCount >= 1 && (
              <>
                {" "}
                该技能被 {associationCount} 个策略关联，关联会自动解除。
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "删除中..." : "确认删除"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium block mb-1">
              名称 <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：双底形态识别"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">描述</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话说明这个技能做什么"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">分类</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as SkillCategory | "")}
              className="border rounded px-2 py-1 text-sm bg-background w-full h-9"
            >
              <option value="">未分类</option>
              {SKILL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium">
                正文 (Markdown) <span className="text-destructive">*</span>
              </label>
              <span className={`text-xs ${counterClass}`}>
                {body.length} / {SKILL_BODY_MAX}
              </span>
            </div>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="# 技能说明..."
              className="min-h-[400px] max-h-[700px] font-mono text-sm overflow-y-auto"
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={invalid || saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
            <Link
              href="/skills"
              className={buttonVariants({ variant: "outline" })}
            >
              取消
            </Link>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">预览</label>
          <Card>
            <CardContent className="p-4 prose prose-sm dark:prose-invert max-w-none min-h-[400px] max-h-[700px] overflow-y-auto">
              {body.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
              ) : (
                <p className="text-muted-foreground text-sm">
                  在左侧输入 Markdown，预览会出现在这里。
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

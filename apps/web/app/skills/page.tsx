"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  SKILL_CATEGORIES,
  CATEGORY_LABELS,
  type SkillCategory,
} from "@/lib/skills-ui";

interface SkillListItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  source: "user" | "seed";
  updatedAt: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillListItem[] | null>(null);

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data: SkillListItem[]) => setSkills(data))
      .catch(() => setSkills([]));
  }, []);

  const grouped: Record<string, SkillListItem[]> = {};
  for (const c of SKILL_CATEGORIES) grouped[c] = [];
  const uncategorized: SkillListItem[] = [];
  for (const s of skills ?? []) {
    if (s.category && (SKILL_CATEGORIES as readonly string[]).includes(s.category)) {
      grouped[s.category].push(s);
    } else {
      uncategorized.push(s);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-none md:max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">技能库</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Skill 是可挂到策略上的方法论文档，监控分析时会注入到 LLM prompt。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/skills/import"
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            从仓库导入
          </Link>
          <Link
            href="/skills/new"
            className="inline-flex items-center gap-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-3 h-8 text-sm font-medium"
          >
            <Plus size={14} /> 新建技能
          </Link>
        </div>
      </div>

      {skills === null && (
        <p className="text-sm text-muted-foreground py-8 text-center">加载中...</p>
      )}

      {skills !== null && skills.length === 0 && (
        <div className="text-center py-12 space-y-2">
          <p className="text-muted-foreground">还没有任何技能。</p>
          <Link
            href="/skills/new"
            className="text-primary underline text-sm"
          >
            创建第一个技能
          </Link>
        </div>
      )}

      {skills !== null && skills.length > 0 && (
        <div className="space-y-6">
          {(SKILL_CATEGORIES as readonly SkillCategory[]).map((cat) => {
            const items = grouped[cat];
            if (items.length === 0) return null;
            return (
              <section key={cat} className="space-y-2">
                <h2 className="text-lg font-semibold">
                  {CATEGORY_LABELS[cat]}
                  <span className="text-xs text-muted-foreground ml-2 font-normal">
                    {items.length}
                  </span>
                </h2>
                <div className="grid gap-2">
                  {items.map((s) => (
                    <SkillRow key={s.id} skill={s} />
                  ))}
                </div>
              </section>
            );
          })}
          {uncategorized.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">
                未分类
                <span className="text-xs text-muted-foreground ml-2 font-normal">
                  {uncategorized.length}
                </span>
              </h2>
              <div className="grid gap-2">
                {uncategorized.map((s) => (
                  <SkillRow key={s.id} skill={s} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function SkillRow({ skill }: { skill: SkillListItem }) {
  return (
    <Link href={`/skills/${skill.id}/edit`}>
      <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{skill.name}</span>
            <Badge
              variant={skill.source === "seed" ? "secondary" : "outline"}
              className="text-[10px]"
            >
              {skill.source === "seed" ? "内置" : "自定义"}
            </Badge>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {new Date(skill.updatedAt).toLocaleDateString("zh-CN")}
            </span>
          </div>
          {skill.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
              {skill.description}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

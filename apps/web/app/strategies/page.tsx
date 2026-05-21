"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Upload, FileText, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Strategy {
  id: string;
  name: string;
  symbols: string[];
  content: string;
  createdAt: string;
}

interface ParsedStrategy {
  name: string;
  symbols: string[];
  content: string;
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [showInjection, setShowInjection] = useState(false);
  const [tab, setTab] = useState<"upload" | "paste">("paste");
  const [script, setScript] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedStrategy | null>(null);
  const [editName, setEditName] = useState("");
  const [editSymbols, setEditSymbols] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchStrategies = useCallback(async () => {
    const res = await fetch("/api/strategies");
    const data = await res.json();
    setStrategies(data);
  }, []);

  useEffect(() => {
    fetchStrategies();
  }, [fetchStrategies]);

  async function handleParse() {
    if (!script.trim()) return;
    setParsing(true);
    setParsed(null);
    try {
      const res = await fetch("/api/strategies/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script }),
      });
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      setParsed(data);
      setEditName(data.name ?? "");
      setEditSymbols(data.symbols ?? []);
    } catch (err) {
      alert("Parse failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setParsing(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确定删除策略「${name}」？关联的所有持仓记录也将一并删除。`)) return;
    await fetch(`/api/strategies/${id}`, { method: "DELETE" });
    fetchStrategies();
  }

  async function handleSave() {
    if (!parsed) return;
    setSaving(true);
    try {
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          symbols: editSymbols,
          content: parsed.content,
          script,
        }),
      });
      if (res.status === 201) {
        setShowInjection(false);
        setScript("");
        setParsed(null);
        fetchStrategies();
      } else {
        const data = await res.json();
        alert(data.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".py")) {
      alert("Only .py files are accepted");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setScript(text);
      setTab("paste");
    };
    reader.readAsText(file);
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">策略库</h1>
        <Button onClick={() => setShowInjection(!showInjection)}>
          <Plus size={16} className="mr-1" /> 注入策略
        </Button>
      </div>

      {showInjection && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>策略注入</CardTitle>
          </CardHeader>
          <CardContent>
            {!parsed ? (
              <>
                <div className="flex gap-2 mb-4">
                  <Button
                    variant={tab === "upload" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTab("upload")}
                  >
                    <Upload size={14} className="mr-1" /> 上传文件
                  </Button>
                  <Button
                    variant={tab === "paste" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTab("paste")}
                  >
                    <FileText size={14} className="mr-1" /> 粘贴代码
                  </Button>
                </div>
                {tab === "upload" ? (
                  <Input type="file" accept=".py" onChange={handleFileUpload} />
                ) : (
                  <Textarea
                    placeholder="粘贴 Python 策略脚本..."
                    className="min-h-[300px] max-h-[600px] font-mono text-sm overflow-y-auto"
                    value={script}
                    onChange={(e) => setScript(e.target.value)}
                  />
                )}
                <Button
                  className="mt-4"
                  onClick={handleParse}
                  disabled={parsing || !script.trim()}
                >
                  {parsing ? "解析中..." : "解析脚本"}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">策略名称</label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">股票代码</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {editSymbols.map((s, i) => (
                        <Badge key={i} variant="secondary">
                          {s}
                          <button
                            className="ml-1 text-xs hover:text-destructive"
                            onClick={() =>
                              setEditSymbols(editSymbols.filter((_, j) => j !== i))
                            }
                          >
                            x
                          </button>
                        </Badge>
                      ))}
                      <Input
                        className="w-24 h-7 text-xs"
                        placeholder="+ 添加"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.currentTarget.value.trim()) {
                            setEditSymbols([...editSymbols, e.currentTarget.value.trim().toUpperCase()]);
                            e.currentTarget.value = "";
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">策略描述预览</label>
                    <div className="mt-1 p-3 bg-muted rounded-md text-sm max-h-[400px] overflow-y-auto prose prose-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? "保存中..." : "确认保存"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setParsed(null);
                      setScript("");
                    }}
                  >
                    取消
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {strategies.length === 0 && (
          <p className="text-muted-foreground text-center py-10">
            暂无策略，点击上方按钮注入第一个策略
          </p>
        )}
        {strategies.map((s) => (
          <Link key={s.id} href={`/strategies/${s.id}`}>
            <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <div className="flex gap-1 mt-1">
                    {(s.symbols ?? []).map((sym) => (
                      <Badge key={sym} variant="outline" className="text-xs">
                        {sym}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-muted-foreground">
                    {new Date(s.createdAt).toLocaleDateString("zh-CN")}
                  </p>
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(s.id, s.name);
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

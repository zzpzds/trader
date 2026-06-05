"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Flag = "none" | "mild" | "severe";

interface Report {
  basic: {
    closedTrades: number;
    winRate: number;
    avgHoldDays: number;
    profitLossRatio: number;
    totalRealizedPnl: number;
    maxDrawdown: number;
  };
  disposition: { avgHoldDaysWinners: number; avgHoldDaysLosers: number; score: number; flag: Flag };
  anchoring: { avgChaseHighPct: number; chaseRate: number; avgVsRefPct: number; flag: Flag };
  overtrading: { avgTradesPerWeek: number; flipsWithin3d: number; flag: Flag };
}

type ApiResult = Report | { empty: true; reason: string };

interface Strategy { id: string; name: string }

const flagColor: Record<Flag, string> = {
  none: "bg-muted text-muted-foreground",
  mild: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/40 dark:text-yellow-200",
  severe: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
};

const flagLabel: Record<Flag, string> = { none: "正常", mild: "轻度", severe: "严重" };

function FlagBadge({ flag }: { flag: Flag }) {
  return <Badge className={cn("text-[10px]", flagColor[flag])}>{flagLabel[flag]}</Badge>;
}

function pct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

function ReportView({ data }: { data: ApiResult | null }) {
  if (data === null) return <p className="text-sm text-muted-foreground py-8 text-center">加载中…</p>;
  if ("empty" in data) {
    return <p className="text-sm text-muted-foreground py-8 text-center">交易数据不足，需至少 5 笔已平仓交易</p>;
  }

  const { basic, disposition, anchoring, overtrading } = data;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">基础财务</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between"><span>已平仓交易</span><span>{basic.closedTrades}</span></div>
          <div className="flex justify-between"><span>胜率</span><span>{pct(basic.winRate)}</span></div>
          <div className="flex justify-between"><span>盈亏比</span><span>{basic.profitLossRatio.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>平均持仓天数</span><span>{basic.avgHoldDays.toFixed(1)}</span></div>
          <div className="flex justify-between"><span>已实现盈亏</span><span>{basic.totalRealizedPnl.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>最大回撤</span><span>{basic.maxDrawdown.toFixed(2)}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            处置效应 <FlagBadge flag={disposition.flag} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p className="text-muted-foreground text-xs">
            赢家持仓 {disposition.avgHoldDaysWinners.toFixed(1)} 天 vs 输家 {disposition.avgHoldDaysLosers.toFixed(1)} 天
          </p>
          <div className="flex justify-between"><span>得分</span><span>{disposition.score.toFixed(2)}</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            锚定 / 追高 <FlagBadge flag={anchoring.flag} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between"><span>BUY 价 vs 30日高点偏离</span><span>{anchoring.avgChaseHighPct.toFixed(2)}%</span></div>
          <div className="flex justify-between"><span>BUY &gt; 30日均线占比</span><span>{pct(anchoring.chaseRate)}</span></div>
          <div className="flex justify-between"><span>BUY 价 vs 参考价偏离</span><span>{anchoring.avgVsRefPct.toFixed(2)}%</span></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            过度交易 <FlagBadge flag={overtrading.flag} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between"><span>周均交易笔数</span><span>{overtrading.avgTradesPerWeek.toFixed(1)}</span></div>
          <div className="flex justify-between"><span>3 日内反复开平次数</span><span>{overtrading.flipsWithin3d}</span></div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function InsightsPage() {
  const [tab, setTab] = useState<"global" | "byStrategy">("global");
  const [globalData, setGlobalData] = useState<ApiResult | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [stratData, setStratData] = useState<ApiResult | null>(null);

  useEffect(() => {
    fetch("/api/insights").then((r) => r.json()).then(setGlobalData);
    fetch("/api/strategies").then((r) => r.json()).then((arr) => {
      setStrategies(arr);
      if (arr.length > 0) setPickedId(arr[0].id);
    });
  }, []);

  useEffect(() => {
    if (!pickedId || tab !== "byStrategy") return;
    setStratData(null);
    fetch(`/api/insights?strategyId=${pickedId}`).then((r) => r.json()).then(setStratData);
  }, [pickedId, tab]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setTab("global")}
          className={cn("px-3 py-2 text-sm border-b-2", tab === "global" ? "border-primary" : "border-transparent")}
        >
          全局
        </button>
        <button
          onClick={() => setTab("byStrategy")}
          className={cn("px-3 py-2 text-sm border-b-2", tab === "byStrategy" ? "border-primary" : "border-transparent")}
        >
          按策略
        </button>
      </div>

      {tab === "global" && <ReportView data={globalData} />}

      {tab === "byStrategy" && (
        <div className="grid md:grid-cols-[200px_1fr] gap-4">
          <div className="space-y-1">
            {strategies.map((s) => (
              <button
                key={s.id}
                onClick={() => setPickedId(s.id)}
                className={cn(
                  "block w-full text-left px-3 py-2 rounded text-sm",
                  pickedId === s.id ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                )}
              >
                {s.name}
              </button>
            ))}
            {strategies.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">暂无策略</p>
            )}
          </div>
          <ReportView data={stratData} />
        </div>
      )}
    </div>
  );
}

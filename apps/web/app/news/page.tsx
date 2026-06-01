"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

interface NewsSummary {
  strategyId: string;
  strategyName: string | null;
  content: string;
}

interface NewsData {
  date: string;
  summaries: NewsSummary[];
}

function getDateLabel(date: Date, index: number): string {
  if (index === 0) return "今天";
  if (index === 1) return "昨天";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default function NewsPage() {
  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return d;
  });

  const [selectedDate, setSelectedDate] = useState(toDateString(today));
  const [data, setData] = useState<NewsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/api/news?date=${selectedDate}`)
      .then((r) => r.json())
      .then((json) => setData(json))
      .catch(() => setData({ date: selectedDate, summaries: [] }))
      .finally(() => setLoading(false));
  }, [selectedDate]);

  return (
    <div className="p-4 md:p-6 max-w-none md:max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">策略热点</h1>

      <div className="flex gap-2 mb-6 flex-wrap">
        {dates.map((d, i) => {
          const ds = toDateString(d);
          return (
            <button
              key={ds}
              onClick={() => setSelectedDate(ds)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                selectedDate === ds
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent"
              }`}
            >
              {getDateLabel(d, i)}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {!loading && data && data.summaries.length === 0 && (
        <p className="text-muted-foreground text-center py-10">
          暂无热点数据，将在每日 09:30 自动更新
        </p>
      )}

      {!loading && data && data.summaries.length > 0 && (
        <div className="space-y-3">
          {data.summaries.map((s) => (
            <Card key={s.strategyId}>
              <CardContent className="p-4">
                <p className="text-sm font-semibold mb-2">
                  {s.strategyName ? (
                    <Link
                      href={`/strategies/${s.strategyId}`}
                      className="hover:underline"
                    >
                      {s.strategyName}
                    </Link>
                  ) : (
                    s.strategyId
                  )}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

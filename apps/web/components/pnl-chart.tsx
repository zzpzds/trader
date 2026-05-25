"use client";

import { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

type Range = "1m" | "3m" | "all";

interface DataPoint {
  date: string;
  percentPnl: number;
}

interface PnlChartProps {
  fetchUrl: string;
}

const RANGES: { key: Range; label: string }[] = [
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "all", label: "全部" },
];

export function PnlChart({ fetchUrl }: PnlChartProps) {
  const [range, setRange] = useState<Range>("1m");
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${fetchUrl}?range=${range}`)
      .then((r) => r.json())
      .then((d: DataPoint[]) => {
        setData(Array.isArray(d) ? d : []);
        setLoading(false);
      })
      .catch(() => {
        setData([]);
        setLoading(false);
      });
  }, [fetchUrl, range]);

  const lastPoint = data[data.length - 1];
  const lineColor = lastPoint && lastPoint.percentPnl >= 0 ? "#dc2626" : "#16a34a";

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-muted-foreground">收益率</span>
        <div className="flex gap-1">
          {RANGES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                range === key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-40 bg-muted animate-pulse rounded" />
      ) : data.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
          暂无数据
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: string) => v.slice(5)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => `${v}%`}
              width={48}
            />
            <Tooltip
              formatter={(value: number) => [
                `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`,
                "收益率",
              ]}
              labelFormatter={(label: string) => label}
            />
            <Line
              type="monotone"
              dataKey="percentPnl"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

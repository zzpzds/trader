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
  ReferenceLine,
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

  // Build a vertical linear-gradient that switches red→green exactly at y=0.
  // We lock the YAxis domain to the same [yMin, yMax] used to compute the
  // gradient offset, otherwise recharts' auto-padding would desync the split
  // from the actual zero line.
  const values = data.map((d) => d.percentPnl);
  const dataMin = values.length ? Math.min(...values) : 0;
  const dataMax = values.length ? Math.max(...values) : 0;
  const yMin = Math.min(0, dataMin * 1.05);
  const yMax = Math.max(0, dataMax * 1.05);
  const yRange = yMax - yMin || 1;
  const gradientOffset = yMax / yRange;
  const gradientId = `pnl-gradient-${fetchUrl}`;

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
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset={gradientOffset} stopColor="#dc2626" stopOpacity={1} />
                <stop offset={gradientOffset} stopColor="#16a34a" stopOpacity={1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: string) => v.slice(5)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => `${v.toFixed(2)}%`}
              width={56}
              domain={[yMin, yMax]}
            />
            <Tooltip
              formatter={(value: number) => [
                `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`,
                "收益率",
              ]}
              labelFormatter={(label: string) => label}
            />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} />
            <Line
              type="monotone"
              dataKey="percentPnl"
              stroke={`url(#${gradientId})`}
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

"use client";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface SellFormValues {
  shares: string;
  price: string;
  sellDate: string;
  notes: string;
}

interface Props {
  symbol: string;
  maxShares: number;
  submitLabel?: string;
  onSubmit: (values: SellFormValues) => Promise<void> | void;
  onCancel?: () => void;
}

export function SellForm({ symbol, maxShares, submitLabel = "卖出", onSubmit, onCancel }: Props) {
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [sellDate, setSellDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    const s = parseFloat(shares);
    if (!shares || !price || !sellDate) return;
    if (!(s > 0)) { setErr("股数必须大于 0"); return; }
    if (s > maxShares + 1e-9) { setErr(`最多可卖 ${maxShares} 股`); return; }
    setErr(null);
    setBusy(true);
    try {
      await onSubmit({ shares, price, sellDate, notes });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm font-medium mb-3">卖出 {symbol}（持有 {maxShares} 股）</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">卖出股数</label>
            <Input type="number" step="0.0001" value={shares} onChange={(e) => setShares(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">卖出价</label>
            <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">卖出日期</label>
            <Input type="date" value={sellDate} onChange={(e) => setSellDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">备注</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        {err && <p className="text-sm text-destructive mt-2">{err}</p>}
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={handleSubmit} disabled={busy}>{submitLabel}</Button>
          {onCancel && (
            <Button size="sm" variant="outline" onClick={onCancel}>取消</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

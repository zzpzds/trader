"use client";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface LotFormValues {
  symbol: string;
  shares: string;
  costPrice: string;
  lotDate: string;
  notes: string;
}

interface Props {
  initial?: Partial<LotFormValues>;
  symbolLocked?: boolean;
  symbolPlaceholder?: string;
  submitLabel?: string;
  onSubmit: (values: LotFormValues) => Promise<void> | void;
  onCancel?: () => void;
}

export function LotForm({
  initial,
  symbolLocked = false,
  symbolPlaceholder = "QQQ",
  submitLabel = "保存",
  onSubmit,
  onCancel,
}: Props) {
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [shares, setShares] = useState(initial?.shares ?? "");
  const [costPrice, setCostPrice] = useState(initial?.costPrice ?? "");
  const [lotDate, setLotDate] = useState(
    initial?.lotDate ?? new Date().toISOString().slice(0, 10)
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!symbol || !shares || !costPrice || !lotDate) return;
    setBusy(true);
    try {
      await onSubmit({ symbol, shares, costPrice, lotDate, notes });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">股票代码</label>
            <Input
              value={symbol}
              disabled={symbolLocked}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder={symbolPlaceholder}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">股数</label>
            <Input
              type="number"
              step="0.0001"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">成本价</label>
            <Input
              type="number"
              step="0.01"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">建仓日期</label>
            <Input
              type="date"
              value={lotDate}
              onChange={(e) => setLotDate(e.target.value)}
            />
          </div>
          <div className="col-span-1 md:col-span-2">
            <label className="text-xs text-muted-foreground">备注</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={handleSubmit} disabled={busy}>
            {submitLabel}
          </Button>
          {onCancel && (
            <Button size="sm" variant="outline" onClick={onCancel}>
              取消
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

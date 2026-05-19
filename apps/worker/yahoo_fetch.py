#!/usr/bin/env python3
"""
yfinance price fetcher — called as subprocess from the Node.js worker.

stdin:  JSON {"symbols":["QQQ","SPY"],"period":"60d"}
stdout: JSON {"QQQ":{"latest":185.42,"bars":[{"date":"2025-01-02","open":180.0,...}]},"SPY":{...}}
stderr: plain-text error message on failure
exit:   0 on success, 1 on failure
"""
import sys
import json

import yfinance as yf
import pandas as pd


def fetch_symbol(symbol: str, period: str) -> dict:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period=period, auto_adjust=True)
    if hist.empty:
        raise ValueError(f"No data returned for {symbol}")

    latest_close = float(hist["Close"].iloc[-1])
    bars = []
    for date, row in hist.iterrows():
        bars.append({
            "date": date.strftime("%Y-%m-%d"),
            "open": round(float(row["Open"]), 4),
            "high": round(float(row["High"]), 4),
            "low": round(float(row["Low"]), 4),
            "close": round(float(row["Close"]), 4),
            "volume": int(row["Volume"]),
        })

    return {"latest": round(latest_close, 4), "bars": bars}


if __name__ == "__main__":
    try:
        req = json.load(sys.stdin)
        symbols: list[str] = req["symbols"]
        period: str = req.get("period", "60d")

        result = {}
        for symbol in symbols:
            result[symbol] = fetch_symbol(symbol, period)

        print(json.dumps(result))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""
OI Rank vs Funding Rate: クロスコリレーション（ラグ）分析

使い方:
  python3 analysis/oi_fr_lag.py
  python3 analysis/oi_fr_lag.py --symbol BTCUSDT
  python3 analysis/oi_fr_lag.py --db /path/to/oi-alert.db --max-lag 20 --top 30
"""

import argparse
import os
import sqlite3

import numpy as np
import pandas as pd
from scipy import stats


# ─────────────────────────────────────────────────────────────────────────────
# データロード
# ─────────────────────────────────────────────────────────────────────────────

def load_data(db_path: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    if not os.path.exists(db_path):
        raise FileNotFoundError(f"DB not found: {db_path}")

    conn = sqlite3.connect(db_path)

    oi_df = pd.read_sql_query(
        "SELECT ts, symbol, oi_rank FROM oi_snapshots ORDER BY symbol, ts",
        conn,
    )
    fr_df = pd.read_sql_query(
        """
        SELECT ts, symbol,
               AVG(rate) AS avg_fr,
               MAX(rate) AS max_fr,
               COUNT(DISTINCT exchange) AS n_ex
        FROM fr_snapshots
        GROUP BY ts, symbol
        ORDER BY symbol, ts
        """,
        conn,
    )

    conn.close()

    oi_df["ts"] = pd.to_datetime(oi_df["ts"])
    fr_df["ts"] = pd.to_datetime(fr_df["ts"])

    return oi_df, fr_df


# ─────────────────────────────────────────────────────────────────────────────
# 時系列アライメント
# ─────────────────────────────────────────────────────────────────────────────

def align_series(oi_df: pd.DataFrame, fr_df: pd.DataFrame, symbol: str, tol_min: int = 2) -> pd.DataFrame | None:
    """OIとFRの時系列を最近傍マッチで結合する。"""
    oi = oi_df[oi_df.symbol == symbol][["ts", "oi_rank"]].set_index("ts").sort_index()
    fr = fr_df[fr_df.symbol == symbol][["ts", "avg_fr", "max_fr"]].set_index("ts").sort_index()

    if oi.empty or fr.empty:
        return None

    merged = pd.merge_asof(
        oi,
        fr,
        left_index=True,
        right_index=True,
        tolerance=pd.Timedelta(f"{tol_min}min"),
        direction="nearest",
    ).dropna()

    return merged if len(merged) >= 20 else None


# ─────────────────────────────────────────────────────────────────────────────
# クロスコリレーション計算
# ─────────────────────────────────────────────────────────────────────────────

def cross_correlation(x: pd.Series, y: pd.Series, max_lag: int) -> pd.DataFrame:
    """
    lag=k での相関:
      lag > 0: corr(x[t], y[t-k]) → y が x より k 期先行
      lag < 0: corr(x[t], y[t+|k|]) → x が y より |k| 期先行
      lag = 0: 同期

    x=Δoi_rank, y=Δfr とした場合:
      lag < 0: OI ランク変化が FR 変化より |lag| 期先行  ← OI が先行指標
      lag > 0: FR 変化が OI ランク変化より lag 期先行    ← FR が先行指標
    """
    rows = []
    n = len(x)

    for lag in range(-max_lag, max_lag + 1):
        if lag > 0:
            xi, yi = x.iloc[lag:], y.iloc[:n - lag]
        elif lag < 0:
            xi, yi = x.iloc[:n + lag], y.iloc[-lag:]
        else:
            xi, yi = x, y

        if len(xi) < 10:
            continue

        r, p = stats.pearsonr(xi.values, yi.values)
        rows.append({"lag": lag, "r": round(r, 4), "p": round(p, 6), "n": len(xi)})

    return pd.DataFrame(rows)


# ─────────────────────────────────────────────────────────────────────────────
# シンボルごとの分析
# ─────────────────────────────────────────────────────────────────────────────

def analyze(symbol: str, merged: pd.DataFrame, max_lag: int) -> dict | None:
    # 変化量（1期差分）
    d_oi = merged["oi_rank"].diff().dropna()
    d_fr = merged["avg_fr"].diff().dropna()

    idx = d_oi.index.intersection(d_fr.index)
    d_oi, d_fr = d_oi[idx], d_fr[idx]

    if len(d_oi) < 20:
        return None

    cc = cross_correlation(d_oi, d_fr, max_lag)
    if cc.empty:
        return None

    peak_row = cc.loc[cc["r"].abs().idxmax()]

    # レベル相関（参考）
    r_lvl, p_lvl = stats.pearsonr(merged["oi_rank"].values, merged["avg_fr"].values)

    return {
        "symbol": symbol,
        "n_points": len(merged),
        "peak_lag": int(peak_row["lag"]),
        "peak_r": float(peak_row["r"]),
        "peak_p": float(peak_row["p"]),
        "r_at_0": float(cc.loc[cc.lag == 0, "r"].values[0]) if 0 in cc.lag.values else float("nan"),
        "level_r": round(r_lvl, 4),
        "cc": cc,
        "d_oi": d_oi,
        "d_fr": d_fr,
    }


# ─────────────────────────────────────────────────────────────────────────────
# スナップショット間隔を推定
# ─────────────────────────────────────────────────────────────────────────────

def estimate_interval(oi_df: pd.DataFrame) -> int | None:
    diffs = oi_df.sort_values("ts").groupby("symbol")["ts"].diff().dropna()
    if diffs.empty:
        return None
    return int(diffs.median().total_seconds() / 60)


# ─────────────────────────────────────────────────────────────────────────────
# 出力
# ─────────────────────────────────────────────────────────────────────────────

def print_summary(results: list[dict], interval_min: int | None, top: int) -> None:
    rows = [
        {
            "symbol": r["symbol"],
            "n": r["n_points"],
            "peak_lag": r["peak_lag"],
            "peak_r": r["peak_r"],
            "peak_p": r["peak_p"],
            "r_at_0": r["r_at_0"],
        }
        for r in results
    ]
    df = pd.DataFrame(rows).sort_values("peak_r", key=abs, ascending=False).head(top)

    print("=" * 72)
    print("OI ランク変化 vs FR 変化: クロスコリレーション分析結果")
    print("=" * 72)
    print()
    print("▶ lag の解釈 (x=Δoi_rank, y=Δfr):")
    print("   lag < 0 : OI ランク変化が FR 変化より |lag| 期 先行している  ← OI が先行指標")
    print("   lag > 0 : FR 変化が OI ランク変化より lag 期 先行している    ← FR が先行指標")
    print("   lag = 0 : 同期して動いている")
    if interval_min:
        print(f"\n▶ スナップショット間隔: 約 {interval_min} 分 / 期")
    print()

    # lag を時間に変換して表示
    if interval_min:
        df["peak_lag_min"] = df["peak_lag"].apply(lambda x: f"{x * interval_min:+d}min")
    else:
        df["peak_lag_min"] = "N/A"

    cols = ["symbol", "n", "peak_lag", "peak_lag_min", "peak_r", "peak_p", "r_at_0"]
    print(df[cols].to_string(index=False))
    print()

    # ラグ分布
    print("=" * 72)
    print("PEAK LAG 分布（全シンボル集計）")
    print("=" * 72)
    all_df = pd.DataFrame(rows)
    lag_counts = all_df["peak_lag"].value_counts().sort_index()
    for lag, count in lag_counts.items():
        bar = "█" * count
        time_str = f" ({lag * interval_min:+d}min)" if interval_min else ""
        sig = "◀ 最多" if count == lag_counts.max() else ""
        print(f"  lag={lag:+3d}{time_str:>10}  {bar} ({count}) {sig}")
    print()

    sig_count = (all_df["peak_p"] < 0.05).sum()
    print(f"統計的有意 (p<0.05): {sig_count}/{len(all_df)} シンボル")


def print_detail(result: dict, symbol: str, interval_min: int | None) -> None:
    print()
    print("=" * 72)
    print(f"詳細ラグテーブル: {symbol}")
    print("=" * 72)
    cc = result["cc"].copy()
    if interval_min:
        cc["time_offset"] = cc["lag"].apply(lambda x: f"{x * interval_min:+d}min")
    # 有意マーク
    cc["sig"] = cc["p"].apply(lambda p: "***" if p < 0.001 else "**" if p < 0.01 else "*" if p < 0.05 else "")
    # ピーク強調
    peak_lag = result["peak_lag"]
    cc["peak"] = cc["lag"].apply(lambda x: "◀ PEAK" if x == peak_lag else "")

    cols = ["lag", "time_offset", "r", "p", "sig", "n", "peak"] if interval_min else ["lag", "r", "p", "sig", "n", "peak"]
    print(cc[cols].to_string(index=False))
    print()
    print(f"結論: ピーク相関 r={result['peak_r']:.4f} は lag={result['peak_lag']:+d}", end="")
    if interval_min:
        print(f" ({result['peak_lag'] * interval_min:+d}min)", end="")
    print()
    if result["peak_lag"] < 0:
        print(f"→ OI ランク変化は FR 変化より約 {abs(result['peak_lag'])} 期先行している可能性  ← OI が先行指標")
    elif result["peak_lag"] > 0:
        print(f"→ FR 変化が OI ランク変化より約 {result['peak_lag']} 期先行している可能性    ← FR が先行指標")
    else:
        print("→ OI ランク変化と FR 変化はほぼ同時に動いている")

    if result["peak_p"] >= 0.05:
        print(f"  ⚠ p={result['peak_p']:.4f}: 統計的有意性なし（データ不足の可能性）")


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    default_db = os.path.join(os.path.dirname(__file__), "..", "data", "oi-alert.db")

    parser = argparse.ArgumentParser(description="OI rank vs FR cross-correlation analysis")
    parser.add_argument("--db", default=default_db, help="SQLite DBパス")
    parser.add_argument("--symbol", help="特定シンボルを詳細表示 (例: BTCUSDT)")
    parser.add_argument("--max-lag", type=int, default=12, help="最大ラグ期数 (default: 12)")
    parser.add_argument("--min-points", type=int, default=20, help="最低データ点数 (default: 20)")
    parser.add_argument("--top", type=int, default=20, help="上位N件を表示 (default: 20)")
    args = parser.parse_args()

    print(f"DBロード中: {args.db}")
    oi_df, fr_df = load_data(args.db)
    interval_min = estimate_interval(oi_df)

    symbols = [args.symbol.upper()] if args.symbol else sorted(oi_df["symbol"].unique().tolist())
    print(f"分析対象: {len(symbols)} シンボル, max_lag=±{args.max_lag} 期\n")

    results = []
    for sym in symbols:
        merged = align_series(oi_df, fr_df, sym)
        if merged is None:
            continue
        r = analyze(sym, merged, args.max_lag)
        if r:
            results.append(r)

    if not results:
        print("⚠ 分析できるデータがありません（データ蓄積期間が短い可能性があります）")
        return

    print_summary(results, interval_min, args.top)

    # 詳細表示（--symbol 指定時、またはデータが1シンボルのみ）
    if args.symbol:
        matched = [r for r in results if r["symbol"] == args.symbol.upper()]
        if matched:
            print_detail(matched[0], args.symbol.upper(), interval_min)
        else:
            print(f"⚠ {args.symbol} のデータが不十分です")
    elif len(results) == 1:
        print_detail(results[0], results[0]["symbol"], interval_min)


if __name__ == "__main__":
    main()

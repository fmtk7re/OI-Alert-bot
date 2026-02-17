# OI Alert Bot — 実装計画書

## 概要

Loris Tools API (GET https://api.loris.tools/funding) を60秒間隔でポーリングし、
OIランキングの急上昇を検知してDiscordに通知するBot。
ユーザーはこの通知をFunding Rateアービトラージ・方向性トレードの判断材料として利用する。

重要: Loris APIは本番トレーディングでの利用を非推奨としている。
本Botは情報通知ツールであり、売買シグナルを提供するものではない。
商用利用時はLoris Toolsへの帰属リンク必須。

## API仕様

- エンドポイント: GET https://api.loris.tools/funding（パラメータなし）
- 更新頻度: 60秒
- oi_rankings: Binanceベースの相対ランキング（文字列 "1"〜"500+"）
  - zodのtransformで数値化: "500+"→501
  - ランクが小さいほど上位。減少=OI上昇
- funding_rates: 32取引所 × 数千シンボル（値は×10,000済み。そのまま保存・表示）
- 1h interval取引所(Hyperliquid, Bluefin, Bybit等)は8倍済みで提供
- レートリミット: 明示なし（60秒未満のリクエストは無意味）

## デプロイ構成

- Hetzner Cloud CX22: 2 vCPU / 4GB RAM / 40GB SSD / €4.51/月
- リージョン: Singapore
- OS: Ubuntu 24.04
- Docker + Docker Compose
- SQLiteファイルはDocker Volumeで永続化
- Phase 3でBot + Web UI + PostgreSQL同居も同一インスタンスで対応可能

## 通知構成

- Phase 1-2: Discord Webhook (native fetch)。SDK不要
- Phase 3: discord.js に移行し、Botコマンド(/watch, /config等)に対応
- 通知チャンネル: アラート用と管理用で分離
  - DISCORD_WEBHOOK_URL: ユーザー向けアラート通知
  - DISCORD_ADMIN_WEBHOOK_URL: ヘルスチェック・障害通知（API連続失敗, zodパース失敗等）

### アラート通知ルール
- 1ティックで複数アラート発生時: ランク上昇幅(Δ)上位10件を抽出
- 1アラート1メッセージ（Embed1個）で最大10件送信
- 11件目以降は切り捨て（次ティックで条件を満たせば再検知される）

## DBスキーマ
sql
CREATE TABLE oi_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  symbol TEXT NOT NULL,
  oi_rank INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_oi_snapshots_symbol_ts ON oi_snapshots(symbol, ts);

CREATE TABLE fr_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  rate REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fr_snapshots_symbol_ts ON fr_snapshots(symbol, ts);

CREATE TABLE alert_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_alert_history_symbol_sent ON alert_history(symbol, sent_at);
データ保持: oi_snapshots 7日, fr_snapshots 3日, alert_history 30日。日次DELETE。

## 検知ルール

### ルール①: rank-delta
直近T分前(default:30)のランクと比較し、D以上(default:30)改善でAlert。
Severity: Δ>=100 high, >=50 medium, else low。

### ルール②: new-entry
前回501(500+)→今回500以下。Severity: high固定。

### ルール③: ema-cross
EMA(short:5)がEMA(long:20)を上から下にクロス。Severity: medium固定。

### フィルタ (適用順)
1. maxRank: currentRank =5のFRが1つ以上

### 設定 (環境変数)
LORIS_API_URL=https://api.loris.tools/funding
POLL_INTERVAL_MS=60000
RANK_DELTA_WINDOW_MIN=30
RANK_DELTA_THRESHOLD=30
EMA_SHORT_PERIOD=5
EMA_LONG_PERIOD=20
MAX_RANK=300
COOLDOWN_MIN=120
MIN_ABS_FR=5
DISCORD_WEBHOOK_URL=
DISCORD_ADMIN_WEBHOOK_URL=
MAX_ALERTS_PER_TICK=10
OI_RETENTION_DAYS=7
FR_RETENTION_DAYS=3
LOG_LEVEL=info

## 通知フォーマット

Discord Embed形式。色はseverity連動 (high:赤, medium:黄, low:青)。
全通知に含める: symbol, ランク変動(prev→current, Δ, 期間), ルール名+severity,
各取引所FR(rate降順), 最大FRスプレッド(取引所名+値), UTC時刻,
帰属表示 Data by Loris Tools https://loris.tools。

## ログ方針

- pino → Docker標準出力のみ
- Dockerのjson-file driver: max-size 10m, max-file 3
- ファイル出力は障害調査で必要になった時点で追加検討

## 開発フェーズ

### Phase 1: MVP (Week 1-2)
- W1前半: プロジェクト初期化, config.ts, DB schema, zodスキーマ
- W1後半: Collector (fetch→parse→SQLite保存), 60秒ループ
- W2前半: ルール①(rank-delta) + フィルタ + ユニットテスト
- W2後半: Discord通知 + メッセージ整形 + Docker化 + Hetznerデプロイ
- ゴール: ポーリング→検知→Discord通知が動く最小構成

### Phase 2: 検知精度向上 (Week 3-5)
- W3: ルール②(new-entry) + ルール③(ema-cross) + テスト
- W4: FR裏付けフィルタ, severity判定ロジック強化
- W5: ヘルスチェック通知, ログ整備
- ゴール: 3ルール稼働, アラート精度が実用レベル

### Phase 3: ユーザー機能拡充 (Week 6-9)
- W6: discord.js移行, Botコマンド (/watch, /unwatch, /config)
- W7: ユーザー別ウォッチリスト・閾値設定の永続化
- W8: Webダッシュボード (Hono + React), SQLite→PostgreSQL移行検討
- W9: 日次/週次サマリ配信, データ保持ポリシー自動実行
- ゴール: ユーザーカスタマイズ可能, Web UIで過去アラート閲覧

## 実装順序 (Phase 1)

1. config.ts + db/ (connection, migrations, queries)
2. collector/ (schema.ts → client.ts → store.ts)
3. lib/ema.ts + detector/ (types.ts → rules/rank-delta.ts → filters.ts → engine.ts)
4. enricher/ (funding.ts → message.ts)
5. notifier/ (discord.ts → dispatcher.ts)
6. main.ts + lib/scheduler.ts
7. テスト + Dockerfile + docker-compose.yml

## 前提条件

- DiscordサーバーにWebhook2つ作成済み (アラート用 + 管理用)
- Bunインストール済み
- Hetzner Cloudアカウント作成済み

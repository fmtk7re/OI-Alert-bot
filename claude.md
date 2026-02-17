## OI Alert Bot

Loris Tools API を60秒ポーリングし、OIランク急上昇を検知してDiscordに通知するBot。
ドメイン仕様・検知ルール・DBスキーマ・環境変数・通知フォーマット等の詳細は plan.md を参照。

## Stack

Bun, TypeScript (strict), bun:sqlite (WAL), zod, pino, Biome
Notification: Discord Webhook (native fetch) → Phase 3で discord.js
Deploy: Hetzner Cloud CX22 (Singapore), Ubuntu 24.04, Docker Compose

## Architecture

60秒ティックの直列パイプライン: Collector → Detector → Enricher → Notifier
各ステージは前段の出力型を入力として受け取る。グローバル状態禁止。

## Structure
src/
  main.ts, config.ts
  collector/   client.ts, schema.ts, store.ts
  detector/    engine.ts, types.ts, filters.ts, rules/{rank-delta,new-entry,ema-cross}.ts
  enricher/    funding.ts, message.ts
  notifier/    discord.ts, dispatcher.ts
  db/          connection.ts, migrations/, queries.ts
  lib/         ema.ts, logger.ts, scheduler.ts
tests/         detector/, collector/, fixtures/

## TypeScript Rules

- any禁止。unknown+型ガードorzodで絞り込む
- Enum禁止。type X = "a" | "b" のUnion型を使う
- interfaceよりtypeを優先。外部ライブラリの拡張時のみinterface
- Non-null assertion(!)禁止。Optional chaining(?.)とnullish coalescing(??)で処理
- catch節はunknown型。instanceof Errorで判別してからアクセス
- async/awaitで統一。.then()チェーン禁止
- 引数3つ以上はオブジェクト引数にする
- 関数の戻り値型は明示する。推論に頼らない
- データは原則immutable。Readonlyとas constを積極的に使う
- 型定義は使用スコープ最小の場所に置く。複数モジュールから参照される型のみtypes.tsにexport
- 副作用のある関数はcollector/notifier/mainに閉じる。detector/lib/enricherは純粋関数
- 設定値は全て環境変数→config.ts(zodパース)経由。マジックナンバー禁止

## Error Handling

- API fetch失敗: 指数バックオフ3回リトライ→ログerror→次ティック継続
- zodパース失敗: safeParse使用→ログerror→そのティックスキップ
- DB/通知エラー: ログ→ループは止めない

## Testing

detector/rules とlib/ema.ts は必ずユニットテスト。fixtures/にAPIスナップショット配置。bun testで実行。

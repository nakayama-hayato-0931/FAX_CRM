# SHARED_CUSTOMER_MASTER

fax-crm と callcenter-ai-system の **顧客マスタ + 全チャネルイベント** 統合設計(A案: 共通マスタ + イベントハブ)。

## ゴール

> 「いつ FAX(原稿/結果)を送ったか、いつ架電したか」を1人の顧客に対して時系列で見たい(両システム横断)

## 全体図

```
                        ┌────────────────────────────────────────────┐
                        │  fax-crm の MySQL (= 共通マスタ DB)          │
                        │                                              │
                        │   customers          ← 顧客マスタ(統一)     │
                        │   contact_events     ← 全チャネルのイベント  │
                        │                                              │
                        │   (fax-crm 固有テーブルもここに同居)         │
                        │   manuscripts / extraction_batches / ...    │
                        └────────────────────────────────────────────┘
                                  ▲                          ▲
                          (1) HTTP / API                (2) HTTP / API
                                  │                          │
                                  │                          │
      ┌─────────────────────┐    │            ┌──────────────────────┐
      │ fax-crm (Web)        │   │            │ callcenter-ai-system  │
      │  受電報告など          │ ──┘            │  架電履歴など          │ ──┘
      │  contact_events に    │                │  contact_events に     │
      │  自動書き込み(内部)   │                │  POST で書き込み(外部) │
      └─────────────────────┘                └──────────────────────┘
        (自分のDB直アクセス)                    (自分のDB + fax-crm API)
```

各システムが書き込み、両システムが読み出せる単一の **contact_events** が時系列軸。

## スキーマ

### `customers` への追加
```sql
ALTER TABLE customers
  ADD COLUMN external_callcenter_id INT UNSIGNED DEFAULT NULL
    COMMENT 'callcenter-ai-system 側の companies.id 対応';
ALTER TABLE customers
  ADD UNIQUE KEY uk_external_callcenter (external_callcenter_id);
```

- 一意性: 1顧客は callcenter 側1社にしか対応しない
- マイグレ時の戦略は後述

### `contact_events`(新規)

```sql
CREATE TABLE IF NOT EXISTS contact_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('fax', 'call', 'email', 'sns', 'meeting', 'other') NOT NULL,
  event_type VARCHAR(40) NOT NULL,   -- ENUM ではなく可変(イベント種類は増える)
  occurred_at DATETIME NOT NULL,
  source_system ENUM('fax-crm', 'callcenter-ai', 'manual') NOT NULL DEFAULT 'fax-crm',
  source_event_id BIGINT UNSIGNED DEFAULT NULL,
    -- 元システムでのイベントID。重複登録防止のため (source_system, source_event_id) で uniq
  operator_name VARCHAR(100) DEFAULT NULL,
  pc_number VARCHAR(20) DEFAULT NULL,
  manuscript_id INT UNSIGNED DEFAULT NULL,
  manuscript_folder_date DATE DEFAULT NULL,
  manuscript_slot TINYINT UNSIGNED DEFAULT NULL,
  result_label VARCHAR(40) DEFAULT NULL,
  memo TEXT DEFAULT NULL,
  raw_payload JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ce_customer_occurred (customer_id, occurred_at DESC),
  INDEX idx_ce_channel_occurred (channel, occurred_at DESC),
  UNIQUE KEY uk_ce_source_dedup (source_system, source_event_id),
  CONSTRAINT fk_ce_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='全チャネル横断のタッチポイントイベント';
```

#### channel と event_type の例

| channel | event_type | 説明 |
|---|---|---|
| `fax` | `send` | FAX送信 |
| `fax` | `response_inquiry` | 受電(問合せ) |
| `fax` | `response_order` | 受電(発注) |
| `fax` | `refusal` | 拒否 |
| `fax` | `invalid_number` | 番号無効 |
| `call` | `outbound` | 架電 |
| `call` | `no_answer` | 不在 |
| `call` | `ng` | NG |
| `call` | `recall` | リコール設定 |
| `call` | `interested` | 興味あり |
| `call` | `project` | 案件化 |
| `email` | `sent` | メール送信 |
| `sns` | `dm_sent` | SNS DM送信 |
| ... | ... | 将来追加 |

→ **event_type は VARCHAR で柔軟に**(ENUMにすると追加のたびに ALTER 必要)

## API

### fax-crm 側に追加するエンドポイント

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/customers/:id/timeline?limit=100&channel=fax,call` | 顧客の contact_events を時系列で返す |
| GET | `/api/customers/lookup?fax=03-xxxx&external_callcenter_id=42` | callcenter から顧客を探す用(複数キー対応) |
| POST | `/api/contact-events` | 外部システムからイベント書き込み |

### POST /api/contact-events のボディ例

```json
{
  "customer_id": 12345,            // customer_id 指定 (or 下記 lookup で代替)
  "channel": "call",
  "event_type": "outbound",
  "occurred_at": "2026-05-16T14:30:00+09:00",
  "operator_name": "taro@example.com",
  "result_label": "不在",
  "memo": "営業時間外、明日リトライ予定",
  "source_system": "callcenter-ai",
  "source_event_id": 42,
  "raw_payload": { /* 任意の追加情報 */ }
}
```

#### lookup フォールバック(customer_id が分からないとき)
```json
{
  "lookup": { "external_callcenter_id": 42 },   // または { "fax": "0312345678" }
  "channel": "call",
  "event_type": "outbound",
  ...
}
```
→ 該当 customers を見つけて customer_id を解決してから INSERT。

### 認証(将来)
今は認証なしで POST 可だが、本番運用前に共有シークレット(`X-Internal-Token`)で保護する予定。

## 顧客IDマッピング戦略

callcenter の `companies.id` と fax-crm の `customers.id` の対応は **`customers.external_callcenter_id`** に保存。

### 初期マイグレーション手順(案)

1. callcenter の `companies` を CSV エクスポート
   - 必須カラム: `id`(callcenter側), `company_name`, `phone_number`, (FAX番号があれば)
2. fax-crm 側で CSV インポート時に:
   - phone_number / fax_number でマッチング → 既存 customers に `external_callcenter_id` を更新
   - マッチしなければ新規 customers として追加(`external_callcenter_id` を埋めた状態で)
3. インポートツール: `backend/scripts/import_callcenter_companies.js`(別途実装)

### 移行後の運用
- 新規顧客が callcenter 側に追加された場合 → callcenter のフックで fax-crm の `/api/customers/import` を叩く(将来の改修)
- 暫定: 月1で CSV エクスポート → 手動インポート

## 既存イベントの contact_events への反映

### fax-crm 側(内部)
- `incomingCallService.bulkSave()` 内で受電報告レコード保存後、対応する `contact_events` 行も INSERT
- 抽出時(`extractionService.createBatch()`)の各 customer に対して `channel='fax', event_type='send'` イベントも INSERT(任意、過去履歴の充実用)

### callcenter-ai-system 側(外部、別フェーズ)
- 架電結果保存時(`callsController` 等)に fax-crm の POST /api/contact-events に書き込み
- HTTP リクエスト失敗時はリトライキュー or 単純無視(運用は後で詰める)

## 表示(顧客タイムライン)

`/customers/[id]` ページに **「タイムライン」タブ** を追加:

```
┌────────────────────────────────────────────────┐
│ 株式会社○○                                       │
│ [基本情報] [タイムライン] [受電報告] [...]         │
├────────────────────────────────────────────────┤
│                                                  │
│ ● 2026-05-16 14:30  📞 call/outbound            │
│      → 不在(taro@example.com)                  │
│      memo: 営業時間外                            │
│                                                  │
│ ● 2026-05-15 14:30  📠 fax/response_inquiry     │
│      → 問合せ                                    │
│                                                  │
│ ● 2026-05-15 09:00  📠 fax/send                 │
│      → 原稿NO.3 / PC03                          │
│                                                  │
│ ● 2026-05-08 11:00  📞 call/no_answer           │
│      → 不在                                      │
│                                                  │
└────────────────────────────────────────────────┘
```

## 段階的ロールアウト

| Phase | スコープ | 状態 |
|---|---|---|
| 1 | このドキュメント作成 | Task #9 |
| 2 | contact_events テーブル + 受電報告自動同期 + API実装 | Task #10 |
| 3 | 顧客詳細画面のタイムラインタブ | Task #11 |
| 4 | callcenter-ai-system 側の改修(外部からの書き込み) | Task #12(別フェーズ) |

## 受け入れ条件

- 顧客マスタは fax-crm 一本に集約され、callcenter は HTTP API 経由で参照
- 1顧客の全チャネル履歴が時系列1ビューで見える
- 新チャネル(メール / SNS / オンラインMTG 等)追加時、`channel` 値追加のみで対応可
- 各システム独自の業務テーブル(extraction_batches / recall_tasks 等)はそれぞれのDBに残し、結合度を最小化

## アンチパターン(やらないこと)

- 共有DB内に各システムの内部業務テーブルまで混在させる(C案 → 不採用)
- contact_events を更新可能にする(基本は INSERT only、修正は新規イベントで)
- contact_events の event_type を ENUM にする(追加のたびに ALTER 必要 → VARCHAR)
- callcenter から fax-crm の DB に直接 INSERT する(必ず API 経由、責任境界を明確に)

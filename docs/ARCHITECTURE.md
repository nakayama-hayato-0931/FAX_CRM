# ARCHITECTURE

FAX CRM システムの全体構造リファレンス。

## スタック

| レイヤー | 技術 | 補足 |
|---|---|---|
| Frontend | Next.js 14 (Pages Router) + React 18 + Tailwind CSS | 兄弟 `callcenter-ai-system` と統一 |
| Charts | **recharts 2.13.3**(v3.x は不可) | DECISIONS.md 参照 |
| Backend | Node.js + Express 4 | |
| DB | MySQL 8 | Railway想定 |
| Excel | ExcelJS 4.x | xlsx ではなく ExcelJS |
| CSV | csv-parser | |
| Google API | googleapis 129+(オプション、遅延require) | サービスアカウントJSON |
| デプロイ | Railway(frontend / backend を別サービス) | `railway.toml` あり |

## ディレクトリ

```
fax-crm-system/
├── package.json              # ワークスペース統括スクリプト
├── README.md
├── .gitignore
├── database/
│   └── init.sql              # 全テーブル + VIEW を 1ファイルに統合
├── docs/
│   ├── CHANGELOG.md          # 機能単位の作業ログ
│   ├── ARCHITECTURE.md       # 本ファイル
│   ├── DECISIONS.md          # 設計判断・落とし穴
│   ├── ROADMAP.md            # 残作業
│   ├── sample_customers.csv
│   ├── sample_cpa.csv
│   └── sample_fax_stats.csv
├── backend/
│   ├── package.json
│   ├── .env.example
│   ├── railway.toml
│   ├── config/db.js          # mysql2 pool, 未設定でも import 可能
│   ├── scripts/migrate.js    # init.sql 適用
│   └── src/
│       ├── server.js         # Express セットアップ
│       ├── middlewares/errorHandler.js  # attachRequestId / errorHandler / notFound
│       ├── utils/response.js, logger.js
│       ├── routes/
│       │   ├── customers.js
│       │   ├── batches.js
│       │   ├── manuscripts.js
│       │   ├── incomingCalls.js
│       │   ├── faxStats.js
│       │   ├── cpa.js
│       │   └── settings.js
│       └── services/
│           ├── customerService.js / customerImportService.js
│           ├── extractionService.js          # Excel生成も含む
│           ├── manuscriptService.js          # ensureDriveFolders / getSlotUsage 含む
│           ├── incomingCallService.js        # 受電報告 (副作用: customers 集計更新)
│           ├── faxStatsService.js
│           ├── cpaService.js
│           ├── settingsService.js
│           └── driveService.js               # googleapis 遅延require
└── frontend/
    ├── package.json
    ├── .env.example
    ├── next.config.js / tailwind.config.js / postcss.config.js / jsconfig.json
    ├── railway.toml
    └── src/
        ├── styles/globals.css
        ├── utils/api.js                       # axios + request_id 受信
        ├── components/
        │   ├── Layout.js                      # サイドバー + 領域
        │   ├── CustomerCsvImportModal.js
        │   ├── CpaImportModal.js
        │   ├── FaxStatsImportModal.js
        │   ├── ManuscriptSlotModal.js
        │   └── SlotUsageModal.js              # 原稿スロット使用履歴
        └── pages/
            ├── _app.js / _document.js
            ├── index.js                        # ホーム
            ├── customers/
            │   ├── index.js                   # 一覧 + CSV
            │   └── [id].js                    # 詳細
            ├── lists/
            │   ├── index.js                   # 一覧 (Excel/Drive/受電報告 ボタン)
            │   └── new.js                     # 新規作成
            ├── manuscripts/
            │   ├── index.js                   # 日付別サマリ
            │   └── [date].js                  # 23スロット + 使用履歴バッジ
            ├── reports/
            │   ├── index.js                   # 受電報告一覧
            │   └── batch.js                   # ←バッチ別入力 (id=クエリで保持)
            ├── fax-stats/index.js              # 折れ線 + PC別 + 明細
            ├── cpa/index.js                    # 月次表
            └── settings/index.js               # Drive認証 + トグル
```

## DB スキーマ要約

詳細は `database/init.sql` 参照。9テーブル + 1VIEW:

| テーブル | 役割 | キーポイント |
|---|---|---|
| `users` | 操作者 | role: admin/operator/manager |
| `customers` | 顧客マスタ(90万件想定) | `fax_number` UNIQUE / 集計キャッシュ (`send_count`, `last_sent_at`, `response_count`, `is_blacklisted`) |
| `manuscripts` | 原稿 | (`folder_date`, `slot_number`) UNIQUE / Drive情報 |
| `extraction_batches` | リスト抽出バッチ | フィルタ条件 + Drive保存先 |
| `extraction_records` | 抽出明細 | (`batch_id`, `customer_id`) UNIQUE |
| `incoming_call_reports` | 受電報告(旧: 送信結果) | `result` ENUM 6種、`refusal` で customers.is_blacklisted を1に |
| `fax_send_stats` | FAX機ログ(Sheets / CSV) | (`stat_date`, `pc_number`) UNIQUE |
| `sheets_config` | Sheets連携設定 | シングルトン (id=1) |
| `performance_records` | CPA元データ | (CSV取込対象) |
| `system_settings` | key-value | drive_root_folder_id / drive_auto_upload / manuscript_auto_create_folders |
| `import_jobs` | インポート履歴 | (任意で利用) |
| **VIEW** `v_cpa_monthly` | 月次ロールアップ | 算出指標 (sends/project_rate/CPA/ROAS等) |

**ROAS = first_payment / cost**(見込売上ではない)。

## API一覧

| Method | Path | 機能 |
|---|---|---|
| GET | `/api/health` | ヘルスチェック (DB ping含む) |
| GET | `/api/customers?q=&industry=&prefecture=&blacklisted=&page=&pageSize=` | 顧客一覧 |
| GET | `/api/customers/:id` | 顧客詳細 |
| GET | `/api/customers/facets/industries` `prefectures` | ファセット件数 |
| PATCH | `/api/customers/:id/blacklist` | BL切替 |
| POST | `/api/customers/import` (multipart `file`) | CSV取込 (UPSERT) |
| GET | `/api/batches` | 抽出バッチ一覧 |
| GET | `/api/batches/preview` | 抽出条件にマッチする件数 |
| POST | `/api/batches` | 抽出実行 |
| GET | `/api/batches/:id` | バッチ詳細 + 顧客 |
| GET | `/api/batches/:id/excel` | Excelダウンロード |
| POST | `/api/batches/:id/upload-to-drive` | Excel → Drive保存 |
| GET | `/api/manuscripts` | 日付別サマリ |
| GET | `/api/manuscripts/:date` | 23スロット + usage_count等 |
| POST | `/api/manuscripts/:date` | 日付登録(23スロット作成) |
| POST | `/api/manuscripts/:date/ensure-drive` | Drive 23フォルダ作成 |
| PATCH | `/api/manuscripts/slots/:id` | スロット編集 |
| **GET** | `/api/manuscripts/slots/:id/usage` | **使用履歴(PC別/バッチ別/明細)** |
| DELETE | `/api/manuscripts/:date` | 日付ごと削除 |
| GET | `/api/incoming-calls?from=&to=&pcNumber=&result=&batchId=&customerId=` | 受電報告一覧 |
| GET | `/api/incoming-calls/by-batch/:batchId` | バッチ別入力ビュー |
| POST | `/api/incoming-calls/bulk-save` | バッチ一括保存 (副作用: customers更新) |
| POST | `/api/incoming-calls` | 単独入力 |
| GET | `/api/fax-stats` | 明細 |
| GET | `/api/fax-stats/daily` | 日別サマリ |
| GET | `/api/fax-stats/by-pc` | PC別サマリ |
| GET | `/api/fax-stats/config` | Sheets連携設定 |
| PUT | `/api/fax-stats/config` | 設定更新 |
| POST | `/api/fax-stats/sync` | Sheets同期実行 |
| POST | `/api/fax-stats/import` | CSV取込 |
| GET | `/api/cpa/monthly?months=12` | CPA月次表 (VIEW) |
| GET | `/api/cpa/detail` | 明細 |
| POST | `/api/cpa/import` | CSV取込 (performance_records) |
| GET | `/api/settings` | 設定 + Drive認証状態 |
| PUT | `/api/settings` | 設定一括更新 |
| POST | `/api/settings/drive/test` | Drive接続テスト |

## 全画面のURL(デモモード)

```
http://localhost:3001/?demo=1                                 ホーム
http://localhost:3001/customers?demo=1                        顧客一覧
http://localhost:3001/customers/1?demo=1                      顧客詳細
http://localhost:3001/lists?demo=1                            リスト抽出一覧
http://localhost:3001/lists/new?demo=1                        リスト新規作成
http://localhost:3001/manuscripts?demo=1                      原稿管理(日付別)
http://localhost:3001/manuscripts/2026-05-14?demo=1           原稿23スロット
http://localhost:3001/reports?demo=1                          受電報告一覧
http://localhost:3001/reports/batch?id=7&demo=1               バッチ別一括入力 (キーボード 1〜6/↑↓)
http://localhost:3001/fax-stats?demo=1                        FAX送信実績
http://localhost:3001/cpa?demo=1                              CPA指標
http://localhost:3001/settings?demo=1                         設定
```

## データフロー

```
[CSV] → /api/customers/import → customers (UPSERT by fax_number)
                                    ↓
              抽出条件 + LIMIT → extraction_batches + extraction_records
                                    ↓
                                Excel生成 → ローカルDL or Drive保存
                                    ↓
                            (FAX送信、外部システム)
                                    ↓
   /api/incoming-calls/bulk-save ← オペレータが結果入力(キーボード対応)
                                    ↓
            customers.last_result / response_count / is_blacklisted 自動更新

[FAX機ログ Sheets] → /api/fax-stats/sync → fax_send_stats (UPSERT by date,pc)
                                              ↓
                          /fax-stats: チャート + PC別 + 明細

[CPA CSV] → /api/cpa/import → performance_records
                                ↓
                            /cpa: 月次表(VIEW で算出指標を計算)
```

# FAX-CRM System

FAX リードCRMシステム。本リポジトリは **CPA指標ダッシュボード** から着工。

## ドキュメント

| ファイル | 内容 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | **Claude / 引き継ぎ担当者は最初にここ** — 規約 / デプロイ / 落とし穴 / 直近作業の追い方 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 設計判断 / 用語ルール / 既知の落とし穴 (**必読**) |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 機能単位の作業履歴(時系列) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | スタック / ディレクトリ / API一覧 / DB / デモURL |
| [docs/SHARED_CUSTOMER_MASTER.md](docs/SHARED_CUSTOMER_MASTER.md) | callcenter-ai-system との共通顧客マスタ設計 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 次にやる候補と優先順 |

新しい開発者(あるいは将来の自分)はこの順で読めば全体像と継続作業の入口が分かるようになっている。

## 現状の実装

| 機能 | 状態 |
|---|---|
| CPA指標ダッシュボード(月次表示 / 算出指標自動計算 / CSVインポート) | ✅ |
| 顧客マスタ管理(CSV取込 / 検索 / 業種・地域ファセット / 詳細 / ブラックリスト) | ✅ |
| リスト抽出(条件指定 / 件数プレビュー / 抽出実行 / Excel出力 / 送信回数自動更新) | ✅ |
| Excel書式(タイトル領域 / メタ情報 / オートフィルタ / ゼブラ / ハイパーリンク / ブラックリスト赤背景 / 印刷タイトル行固定) | ✅ |
| 原稿管理(日付×23スロット一括作成 / Drive URL & タイトル & メモ管理 / 進捗バー) | ✅ |
| 受電報告(バッチ別一括入力 / キーボードショートカット / 顧客マスタの反応・拒否を自動反映) | ✅ |
| FAX送信実績(Sheets同期 or CSV取込 / 日別折れ線チャート / PC別成功率・エラー率) | ✅ |
| 設定画面 + Drive連携(リスト抽出のExcel自動Drive保存、認証状態確認、接続テスト) | ✅ |
| 原稿フォルダ自動作成(日付登録時 or 手動ボタンで Drive に 1〜22 サブフォルダを冪等作成) | ✅ |
| エラーハンドリング(request_idミドルウェア / 構造化ログ / フロントのエラーメッセージにreq_id表示) | ✅ |
| マルチチャネル自動アプローチ(フェーズ2: MCP) | 🔜 |

## 技術スタック

- Frontend: Next.js 14 (Pages Router) + React 18 + Tailwind CSS
- Backend: Node.js + Express 4 + mysql2 + multer + csv-parser
- DB: MySQL 8 (Railway想定)
- Deploy: Railway (frontend / backend 別サービス)

## ディレクトリ

```
fax-crm-system/
├── frontend/         # Next.js (Pages Router)
│   └── src/
│       ├── pages/cpa/     # CPA指標ダッシュボード
│       ├── components/    # Layout / CpaImportModal
│       └── utils/api.js
├── backend/          # Express
│   ├── src/
│   │   ├── routes/cpa.js
│   │   ├── services/cpaService.js
│   │   ├── middlewares/
│   │   └── server.js
│   └── config/db.js
├── database/init.sql # performance_records + v_cpa_monthly
└── docs/sample_cpa.csv
```

## セットアップ

```powershell
# 1. 依存
npm --prefix backend install
npm --prefix frontend install

# 2. .env
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env.local
# backend\.env で MySQL 接続情報を設定

# 3. DBマイグレーション
npm --prefix backend run migrate

# 4. 起動 (別ターミナル)
npm --prefix backend run dev    # http://localhost:4001
npm --prefix frontend run dev   # http://localhost:3001
```

DB未設定でもAPI/フロントは起動可能。各ページに `?demo=1` をつけるとデモデータが表示されます:
- `http://localhost:3001/cpa?demo=1`
- `http://localhost:3001/customers?demo=1`
- `http://localhost:3001/customers/1?demo=1`
- `http://localhost:3001/lists?demo=1`
- `http://localhost:3001/lists/new?demo=1`
- `http://localhost:3001/manuscripts?demo=1`
- `http://localhost:3001/manuscripts/2026-05-14?demo=1`
- `http://localhost:3001/reports?demo=1`
- `http://localhost:3001/reports/batch?id=7&demo=1`
- `http://localhost:3001/fax-stats?demo=1`
- `http://localhost:3001/settings?demo=1`

## API

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/health` | ヘルスチェック(DB接続状態を含む) |
| GET | `/api/cpa/monthly?months=12` | 月次CPAダッシュボード(VIEW経由) |
| GET | `/api/cpa/detail?from=&to=&pcNumber=&segment=` | 明細データ |
| POST | `/api/cpa/import` (multipart `file`) | CSVから `performance_records` へ取込 |
| GET | `/api/customers?q=&industry=&prefecture=&blacklisted=&page=&pageSize=` | 顧客一覧 |
| GET | `/api/customers/:id` | 顧客詳細 |
| GET | `/api/customers/facets/industries` | 業種ファセット(件数つき) |
| GET | `/api/customers/facets/prefectures` | 都道府県ファセット(件数つき) |
| PATCH | `/api/customers/:id/blacklist` | ブラックリストON/OFF |
| POST | `/api/customers/import` (multipart `file`) | CSVから `customers` へ取込 (UPSERT) |
| GET | `/api/batches` | 抽出バッチ一覧 |
| GET | `/api/batches/preview?industry=&prefecture=&recentDays=` | 抽出条件に合致する顧客数(事前確認) |
| POST | `/api/batches` | 抽出を実行(バッチ作成 + 顧客集計更新を1トランザクション) |
| GET | `/api/batches/:id` | バッチ詳細 + 含まれる顧客一覧 |
| GET | `/api/batches/:id/excel` | バッチをExcel(.xlsx)としてダウンロード |
| GET | `/api/manuscripts` | 日付ごとのサマリ(タイトル設定数 / Drive URL設定数を含む) |
| GET | `/api/manuscripts/:date` | 特定日の23スロット一覧 (`YYYY-MM-DD`) |
| POST | `/api/manuscripts/:date` | 日付登録(不足スロットを 1〜22 までINSERT、既存は維持) |
| PATCH | `/api/manuscripts/slots/:id` | スロット個別編集(title / drive_folder_url / drive_folder_id / thumbnail_url / memo) |
| DELETE | `/api/manuscripts/:date` | 日付ごと全23スロット削除 |
| GET | `/api/incoming-calls?from=&to=&pcNumber=&result=&batchId=&customerId=` | 受電報告一覧 |
| GET | `/api/incoming-calls/by-batch/:batchId` | バッチ別の入力ビュー(顧客一覧+既存報告) |
| POST | `/api/incoming-calls/bulk-save` | バッチ一括保存(顧客の反応・拒否を自動反映) |
| POST | `/api/incoming-calls` | 単独入力(電話・メール反応の追加記録) |
| GET | `/api/fax-stats?from=&to=&pcNumber=` | FAX送信実績の明細 |
| GET | `/api/fax-stats/daily` | 日別サマリ(送信/成功/エラー + エラー率) |
| GET | `/api/fax-stats/by-pc` | PC別サマリ(成功率/エラー率付き) |
| GET | `/api/fax-stats/config` | Sheets連携設定の取得 |
| PUT | `/api/fax-stats/config` | Sheets連携設定の更新(`sheet_id`, `sheet_range`) |
| POST | `/api/fax-stats/sync` | Google Sheets からの同期実行 |
| POST | `/api/fax-stats/import` (multipart `file`) | CSV取込(Sheets連携できない場合のフォールバック) |
| GET | `/api/settings` | 設定一覧 + Drive認証状態 |
| PUT | `/api/settings` | 設定の一括更新(drive_root_folder_id 等) |
| POST | `/api/settings/drive/test` | Drive API 接続テスト |
| POST | `/api/batches/:id/upload-to-drive` | 抽出バッチのExcelをDriveに保存(設定: drive_root_folder_id 必須) |
| POST | `/api/manuscripts/:date/ensure-drive` | Drive上に YYYY-MM-DD / 1〜22 フォルダを冪等作成(既存スロットはスキップ) |

## CSV取込仕様

UTF-8、カンマ区切り、1行目ヘッダー。自動マッピング対応列:

| CSV列名 | DB列 | 必須 |
|---|---|---|
| 期間 / 月 / period / date | period_date | ◯ |
| PC / pc_number | pc_number |  |
| セグメント / 業種 | segment |  |
| コスト | cost |  |
| コール数 | call_count |  |
| 案件数 | project_count |  |
| 面接数 | interview_count |  |
| 内定 | offer_count |  |
| 不合格 | reject_count |  |
| バラシ/失注 | cancel_count |  |
| 初回入金 | first_payment |  |
| 見込売上 | expected_revenue |  |

期間は以下の表記を許容:
- `2026-05-01` / `2026/05/01`
- `2026/05`
- `2026年5月`
- `5月` → 今年扱い

算出列(VIEW側で自動計算):
- 案件化率 = 案件数 / コール数
- 案件CPA = コスト / 案件数
- 面接CPA = コスト / 面接数
- 面接実施率 = 面接数 / 案件数
- ROAS = 見込売上 / コスト

## リスト抽出の挙動

`POST /api/batches` を呼ぶと 1トランザクションで次の処理を行います:

1. `extraction_batches` に新規バッチ行を INSERT
2. 顧客マスタから条件に合致する行を `FOR UPDATE` でロック取得
   - 除外: ブラックリスト, FAX番号なし, `recentDays`日以内に送信済の顧客
   - 並び順: 送信回数の少ない順 → 最終送信が古い順 → ID昇順
3. `extraction_records` にバッチ × 顧客の明細を一括 INSERT
4. 対象 `customers` の `send_count++`, `last_sent_at = NOW()`, `last_pc_number` を更新
5. `extraction_batches.actual_count` を更新

該当件数が0の場合は status を `failed` に設定。実装は [extractionService.js](backend/src/services/extractionService.js) を参照。

Excel は `/api/batches/:id/excel` でリアルタイム生成(`exceljs`)。ヘッダー行はインディゴ背景の白文字、罫線つき。将来Drive連携を実装する際は、このBufferをそのまま Drive API にアップロードする想定。

## 原稿管理の挙動

業務フローでは1日あたり23スロットの原稿フォルダを Google Drive に作る運用。本システムでは:

- `POST /api/manuscripts/:date` で日付登録すると、`manuscripts` テーブルに `(folder_date, slot_number)` の組を 1〜23 までINSERT。既存スロットがある場合は維持し、不足分のみ追加。
- `UNIQUE KEY (folder_date, slot_number)` で重複防止。
- 各スロットは `PATCH /api/manuscripts/slots/:id` でタイトル / Drive フォルダID / URL / サムネイルURL / メモを編集可能。
- 一覧画面では日付ごとに「タイトル設定数 / Drive URL設定数」をサマリ表示し、進捗バーで充足度を可視化。
- Drive APIによる実フォルダ自動生成は次フェーズ。本フェーズでは手動で作ったDriveフォルダのURLを登録する形。

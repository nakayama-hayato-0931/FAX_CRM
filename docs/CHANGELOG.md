# CHANGELOG

会話履歴がなくても続きから作業できるよう、機能単位で実装履歴を記録する。

書式:
- `[YYYY-MM-DD]` 機能名 — 主要なファイル / DB変更 / 注意点

---

## [2026-05-15] 0.9.0 — 原稿スロットを 22 → 23 に変更(NO.1〜NO.23 PC対応)

**背景**: FAX送信実績シートで判明したPC数(NO.1〜NO.23)に合わせて、原稿管理側も23スロット運用に統一。

**変更**:
- `manuscriptService.TOTAL_SLOTS`: 22 → **23**
- DB: `manuscripts.slot_number` のCOMMENTを「1〜23 のスロット番号」に
- DB: `manuscripts` テーブル全体のCOMMENT, `system_settings.manuscript_auto_create_folders` の description も全部 23 に
- フロント全箇所:
  - 受電報告のスロット番号入力 `min=1 max=23`(`pages/reports/batch.js`)
  - 設定画面のトグルラベル「23フォルダ自動作成」
  - 原稿一覧ページ「23スロット作成」
  - 日付詳細ページ「23スロット / 23フォルダ作成 / 進捗 /23」
  - ホームページの説明文
  - デモデータ(buildDemoSlots `length: 23` / manuscripts/index.js の `slot_count: 23`)
- バックエンドコメント「1..23」「23フォルダ」
- docs(README / ARCHITECTURE / DECISIONS)全部 23 に統一

**何も変えなくていいもの**:
- `parsePivotSheet()`(動的採番なのでPC数増減に強い)
- 既存DB(`TINYINT UNSIGNED` でMAX値は 255、23 は余裕で入る)
- `manuscript_slot` 系のFKや UNIQUE制約

---

## [2026-05-15] 0.8.0 — FAX送信実績のSheets取込: ピボット形式に対応

**背景**: ユーザーから共有された実シート
`https://docs.google.com/spreadsheets/d/1dm7UEBA-OcOmgtCva2xJZkPYEDBx9lTW2k4GFrsxjZQ` がピボット形式
- 1行目: `合計 / 平均 / 4/30 / 5/1 / ...`(横軸=日付)
- 各セクション: 「送信件数」「エラー数」(必要) + 「総数」「エラー総数」「送信数合計」(無視)
- 「NO.1」マーカーがセクション末尾に出る(セクション区切りは「送信件数」行の出現で連番化)

**追加** [`backend/src/services/faxStatsService.js`]:
- `parsePivotSheet(values, opts)` — ピボット形式専用パーサ
  - 日付列の自動検出 (`M/D` → `YYYY-MM-DD`)
  - 「送信件数」行検出で `pcIndex++` → `NO.1, NO.2, ...` を自動割り当て
  - 不要行(総数/エラー総数/送信数合計/合計/平均/空行/NO.X単独行)を全てスキップ
  - 成功 = 送信 - エラー で計算
- `detectPivotFormat(values)` — 1行目に日付列があれば pivot とみなす
- `syncFromSheets()` を分岐対応(pivot / flat 自動判定)
- デフォルトレンジを `A1:AZ200` に拡張

**追加** [`frontend/src/pages/settings/index.js`]:
- 設定画面に「FAX送信実績 Sheets 連携」セクション
- シートID / 範囲 入力欄 + 「シート設定を保存」「今すぐ同期」ボタン
- 最終同期日時 / ステータスバッジ / メッセージ表示

**テスト** [`backend/scripts/test_pivot_parser.js`]:
- 実シート抜粋でパース → NO.1/NO.2 × 5/1〜5/7 = 14行を正確に抽出
- 全ての不要行が除外されることを確認

**DB**: `sheets_config.sheet_range` のデフォルトを `'Sheet1!A:H'` → `'A1:AZ500'`(NO.1〜NO.23対応マージン込み)

**注意**: ユーザーから「NO.1〜NO.23(23台のPC)で運用」と確認済み。テストで全PC欠落なしを検証。

---

## [2026-05-15] 0.7.0 — 原稿管理に使用履歴(業種/地域/PC別)

**追加**:
- バックエンド: 各スロットの `usage_count / distinct_pcs / distinct_industries / distinct_prefectures` を `getByDate()` の応答に追加 [`backend/src/services/manuscriptService.js`]
- 新API: `GET /api/manuscripts/slots/:id/usage` 返却 `{ slot, byPc[], byBatch[], details[] }` [`backend/src/routes/manuscripts.js`]
- フロント: 日付詳細画面の各スロットカード下部に「使用 N件 + PCチップ + 業種/地域」表示 [`frontend/src/pages/manuscripts/[date].js`]
- フロント新規: `SlotUsageModal.js` — タブ(PC別 / バッチ別 / 明細)で履歴表示 [`frontend/src/components/SlotUsageModal.js`]

**注意点**:
- 集計は `incoming_call_reports` JOIN `extraction_batches` で取得。manuscript_id が NULL のレポートは対象外。

---

## [2026-05-15] 0.6.0 — CPA仕様変更

**変更**:
- ラベル「コール数」→「**送信数**」(FAX送信数)
- ROAS計算: `expected_revenue / cost` → **`first_payment / cost`**
- DB View `v_cpa_monthly` の出力列 `calls` → `sends`
- CSVマッピングに `送信数 / FAX送信数 / 送信 / sends` を追加(call_count へマップ。物理カラム名は維持)
- サンプルCSV [`docs/sample_cpa.csv`] のヘッダ更新

**ファイル**:
- `database/init.sql`
- `backend/src/services/cpaService.js`
- `frontend/src/pages/cpa/index.js`
- `frontend/src/components/CpaImportModal.js`

---

## [2026-05-15] 0.5.0 — 磨き込み(Excel書式 / エラーハンドリング)

**Excel書式** [`backend/src/services/extractionService.js`]:
- タイトル領域 (行1) + メタ情報 (行2-5) + ヘッダー (行6) + データ (行7-)
- オートフィルタ / ペイン固定 / 印刷タイトル行
- ゼブラ縞 / ブラックリスト行は赤背景
- URL列はハイパーリンク、FAX/電話は Consolas 等幅
- 列追加: URL / 送信履歴 / 備考(全11列)

**エラーハンドリング** [`backend/src/middlewares/errorHandler.js`, `frontend/src/utils/api.js`]:
- `attachRequestId` ミドルウェアで `req_xxx` 発行
- 構造化ログ(JSON), 500系は内部メッセージ非表示
- フロントの toast に request_id を併記

**削除**: Slack通知関連を全部除去(要件外)
- 削除: `backend/src/services/notificationService.js`
- `settingsService.ALLOWED_KEYS` から `notify_slack_webhook_url` 除外
- `routes/settings.js` の `/slack/test` 削除
- フロント設定画面の通知連携セクション削除

---

## [2026-05-15] 0.4.0 — 原稿フォルダ Drive 自動作成

**追加**:
- `manuscriptService.ensureDriveFolders(date)` — `<root>/<YYYY-MM-DD>/<1..22>/` を冪等に作成、各スロットの `drive_folder_id / url` をDB保存
- 設定 `manuscript_auto_create_folders = '1'` で日付登録時に自動実行
- 手動: `POST /api/manuscripts/:date/ensure-drive`
- フロント: 日付詳細画面に「Drive 22フォルダ作成」ボタン追加

---

## [2026-05-15] 0.3.0 — 設定画面 + Drive連携

**新規**:
- DB: `system_settings` テーブル(key-value)+ 初期キー3つ
- 新サービス: `settingsService` / `driveService`(googleapis を遅延require、scope: drive.file)
- 新エンドポイント:
  - `GET /api/settings` / `PUT /api/settings`
  - `POST /api/settings/drive/test`
  - `POST /api/batches/:id/upload-to-drive`
- フロント:
  - `/settings` ページ(認証状態 / トグル / Drive接続テスト)
  - リスト抽出に「Drive保存」ボタン追加、保存済みは「Drive ↗」リンク

**Drive root folder ID** は環境変数ではなく DB の `drive_root_folder_id` で管理(設定画面から変更可)。

---

## [2026-05-15] 0.2.0 — FAX送信実績(Sheets連携)

**新規**:
- DB: `fax_send_stats` (uniq: date × pc) + `sheets_config`(シングルトン)
- 新サービス: `faxStatsService` — `googleapis` 遅延require + 接続失敗時の `last_sync_status` 記録
- 新エンドポイント: `/api/fax-stats` (一覧/daily/by-pc/config/sync/import)
- フロント `/fax-stats`:
  - KPI 5枚
  - **recharts** 折れ線(送信/成功/エラー)
  - PC別サマリ表 + 明細表

**重要**:
- `recharts` は **v2.x が必須**(v3.x の ResponsiveContainer は SSR + 0幅問題で動かない)
- `ResponsiveContainer` の親 div は `width:100%; height: <数値>px` 必須

---

## [2026-05-15] 0.1.0 — フェーズ1 全機能 着工〜完了

**順序**:
1. CPA指標ダッシュボード(優先実装)
2. 顧客マスタ管理(90万件想定、UPSERT + ファセット + ブラックリスト)
3. リスト抽出 → Excel生成
4. 原稿管理(22スロット / 日付登録)
5. 受電報告(バッチ別一括入力 + キーボードショートカット `1〜6` + `↑↓`)

**主要DBテーブル** (`database/init.sql`):
- `customers`, `manuscripts`, `extraction_batches`, `extraction_records`
- `incoming_call_reports`(旧称「送信結果」→「受電報告」、用語ルールあり)
- `performance_records` + VIEW `v_cpa_monthly`

**重要な用語ルール**:
- 「送信結果入力」は使わず、**「受電報告」** と呼ぶ
- 「コール数」は使わず、**「送信数」** と呼ぶ
- 詳細: `docs/DECISIONS.md`

**動的ルートの落とし穴**:
- Next.js Pages Router の `/foo/bar/[id]` のような深いダイナミックルートは dev mode でスクリプトロード失敗するバグあり
- 対策: クエリパラメータ化(`/reports/batch?id=7`)
- 詳細: `docs/DECISIONS.md`

---

## ゼロからの再現手順

```powershell
# 1. 依存インストール
npm --prefix backend install
npm --prefix frontend install

# 2. 環境変数
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env.local

# 3. DB マイグレーション (Railway MySQL or ローカル)
npm --prefix backend run migrate

# 4. 起動
npm --prefix backend run dev    # http://localhost:4001
npm --prefix frontend run dev   # http://localhost:3001
```

DB 未設定でもフロントは `?demo=1` で全画面プレビュー可能。
全URLリストは README.md または `docs/ARCHITECTURE.md` を参照。

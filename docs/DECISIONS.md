# DECISIONS

設計判断の理由 + 既知の落とし穴 + 守るべき規約。

---

## 1. 用語ルール(運用上の規約)

### 1.1 「送信結果入力」→「**受電報告**」
- **背景**: FAXへの反応は受電(電話の着信)で返ってくる業務フロー
- **影響箇所**: UI文言 / ナビゲーション / DB テーブル名 (`incoming_call_reports`)
- **2回叱責された案件** — 「送信結果」を使わないこと

### 1.2 「コール数」→「**送信数**」(FAX送信数)
- **背景**: コールセンターではなくFAX業務
- **影響箇所**: UI表示ラベル / CSVマッピング / VIEW 列名(`calls` → `sends`)
- **物理カラム名**: `performance_records.call_count` のまま(過去データ互換のため)

### 1.3 ROAS の計算
- `ROAS = 初回入金 / コスト × 100`(percentage表示)
- **見込売上は使わない**(見込売上列は参考表示のみ残してある)

---

## 2. 既存資産は使わない

### 2.1 既存モックアップを参照禁止
- ルート直下の `fax-crm-mockup.html` / `crm-frontend-mockup.html` / `multi-channel-crm-spec.html` を参考にしてはいけない
- **2回叱責された案件** — UI / 配色 / 画面名すべて、会話で合意したものから組み立てる
- ユーザーから AskUserQuestion を dismiss された場合 = 「ノー」と解釈する

### 2.2 兄弟プロジェクトとの関係
- `../callcenter-ai-system/` は**スタック参考**としてのみ利用OK
- 既に Railway / GitHub で稼働中。FAX-CRM はそれと**別リポジトリ**(同スタック)

---

## 3. 技術選択

### 3.1 Next.js Pages Router を選択(App Routerではなく)
- 兄弟 `callcenter-ai-system` がPages Routerなのでスタック統一

### 3.2 MySQL を選択(Postgresではなく)
- 同上(Railway上の運用統一)

### 3.3 ExcelJS を選択(xlsxではなく)
- 書式設定(罫線/フォント/塗り)が必要なため。xlsxは値の入出力のみ。

### 3.4 recharts v2.x 必須
- v3.8.x は `ResponsiveContainer` がSSR + dev mode で 0×0 を計算して描画されないバグあり
- **必ず v2.13.x を使う**
- `package.json` ロック: `"recharts": "^2.13.3"`

### 3.5 googleapis は遅延require
- `driveService.js` / `faxStatsService.js` でファイル先頭ではなく関数内で require
- 理由: 鍵未設定の環境でも他機能を壊さない / 起動が早い

---

## 4. 既知の落とし穴(踏むな)

### 4.1 Next.js Pages Router の深い動的ルートが壊れる
- `/foo/bar/[id].js` のようなネストした動的ルートは、dev mode で `/_next/static/chunks/pages/foo/bar/7.js` を取りに行って 404 になる
- **対策**: クエリパラメータ化する
  - ✘ `/reports/batch/[batchId].js` ← これで失敗した
  - ◯ `/reports/batch.js` + `?id=7` ← この形式で解決
- 詳細: `frontend/src/pages/reports/batch.js` のコメント参照

### 4.2 useRouter の router.isReady が初回 false
- Pages Router で動的セグメント+クエリのページは、初回マウント時 `router.isReady === false`
- 待たずに `router.query.foo` を読むと undefined
- **対策パターン**:
  ```js
  useEffect(() => {
    if (!router.isReady) return;
    // ここで router.query を使う
  }, [router.isReady, router.query.foo]);
  ```

### 4.3 useEffect の race condition
- CPA / customers / その他で `setLoading(true)` のあと API 失敗 → `setRows([])` する流れと、
  デモモードの `setRows(DEMO_ROWS)` が交差して空表示になる現象あり
- **対策**: `let cancelled = false;` を effect 内で持ち、unmount時に true、setStateの前にチェック

### 4.4 MySQL INSERT ... ON DUPLICATE KEY UPDATE の affectedRows
- 新規 = 1, 更新あり = 2, マッチして変更なし = 0
- **CSV取込の inserted/updated 集計はこのルールで計算する** (`customerImportService.js` 参照)

### 4.5 サーバ未設定でも壊さない
- DB / Google API いずれも未設定時に **import が落ちないこと**
- 各サービスで `isConfigured()` を見て早期 return、フロントで空状態を出す設計

---

## 5. データモデル設計の判断

### 5.1 customers の集計キャッシュ
- `send_count / last_sent_at / last_pc_number / last_result / response_count / is_blacklisted` を customers にキャッシュ
- 理由: 90万件規模で「直近結果」「送信回数」を一覧で見せたいが、毎回 incoming_call_reports をJOIN集計するのは重い
- 更新: `incoming_call_reports` への bulk_save 時にトランザクション内で行う

### 5.2 受電報告の結果 ENUM
```
no_response       (受電なし / 未反応)
response_inquiry  (反応あり: 問合せ)
response_order    (反応あり: 発注)
refusal           (拒否)              → customers.is_blacklisted = 1
invalid_number    (番号無効)
other
```

### 5.2.1 FAX送信実績シートはピボット形式

ユーザーが共有した実シート(`1dm7UEBA-OcOmgtCva2xJZkPYEDBx9lTW2k4GFrsxjZQ`)の構造:

```
合計, 平均, 4/30, 5/1, 5/2, 5/3, 5/4, 5/5, 5/6, 5/7      ← ヘッダ(横軸=日付)
送信件数,,,4548,4802,4396,4728,4907,4266,4775,4497      ← NO.1の送信件数
エラー数,,,998,3814,771,749,919,952,1715,591             ← NO.1のエラー数
送信数合計,...                                            ← skip
,...                                                       ← skip (空行)
NO.1,,,,504,                                              ← セクション末尾マーカー
総数,,45756,46062,...                                     ← skip (累積カウンタ)
エラー総数,,5818,5836,...                                ← skip
送信件数,273,,288,289,...                                 ← NO.2の送信件数
エラー数,,,18,19,...                                      ← NO.2のエラー数
```

**ルール**:
- 「**送信件数**」「**エラー数**」のみ取り込む(ユーザー指示)
- 「**総数**」「**エラー総数**」「**送信数合計**」「平均」「合計」「空行」は **無視**
- 「NO.X」マーカー単独行も無視 — 代わりに「送信件数」行が出てくるたびに `pcIndex++` で連番化(NO.1, NO.2, ...)
- 成功件数 = 送信件数 - エラー数(自動計算)
- 日付ヘッダ `M/D` は現在年で補完して `YYYY-MM-DD`

**PC数**: 現在 **NO.1〜NO.23 の 23 台**(将来増減の可能性あり)
- 動的に `pcIndex++` で採番しているため、PC数増減はパーサ変更不要
- ただし読み取り範囲 `sheet_range` は十分に取る必要あり
  - 23PC × 約7行/PC + ヘッダ ≒ 162行
  - デフォルト `A1:AZ500`(マージン込み)を採用

**実装場所**: `backend/src/services/faxStatsService.js` の `parsePivotSheet()` / `detectPivotFormat()`
**動作テスト**: `backend/scripts/test_pivot_parser.js`(ケース1: 実シート抜粋、ケース2: NO.1〜NO.23 合成)

### 5.3 fax_send_stats と incoming_call_reports は別物
- `fax_send_stats`: FAX機の送信ログ(機械的、Sheets同期)
- `incoming_call_reports`: 反応の人手記録(電話受け、営業のあと)
- 同じ「FAX結果」だが粒度と意味が違うので分けてある

### 5.4 system_settings は key-value
- 単一の `settings` シングルトンテーブルにせず、key-value にしたのは将来の項目追加が楽だから
- `ALLOWED_KEYS` で許可リスト管理(任意のキーが書き込まれないように)

### 5.5 manuscripts は 23 スロット固定
- 業務要件:「日付ごとに 23 個の原稿フォルダ」(NO.1〜NO.23 のPC構成に合わせる)
- `(folder_date, slot_number)` UNIQUE で 1..23 を全部INSERT
- `createDate()` は冪等(既存のスロットはスキップ)
- スロット数の単一の出所(SoT)は `backend/src/services/manuscriptService.js` の定数 `TOTAL_SLOTS = 23`
- **歴史**: 当初は 22 スロット固定 (0.1.0)、PCがNO.1〜NO.23の23台と判明したため 0.9.0 で 23 に変更

---

## 6. フロントエンドの規約

### 6.1 デザイン
- ライト基調 / ベース: zinc / アクセント: indigo
- フォント: Noto Sans JP
- レイアウト: 左サイドバー(白) + メインエリア(白カード on `bg-zinc-50` の背景)
- モックアップ参照禁止(項目 2.1 参照)

### 6.2 各ページに `?demo=1` モード
- DBなしでもUI確認できるよう、各ページに DEMO_DATA を持つ
- ヘッダーに琥珀色「デモ表示」バッジを出す
- 保存系操作は `toast('デモ表示中は保存されません')` で no-op

### 6.3 エラー表示
- `axios` インターセプタで `err.userMessage` に request_id を併記
- toast でユーザーに見せる、コンソールは構造化JSON

---

## 7. 廃止した方針(やらないこと)

### 7.1 Slack通知サービス
- 一度実装したが「いらない」とユーザー指示で全削除
- 復活させる場合は `git log -- backend/src/services/notificationService.js` で履歴を辿る

### 7.2 フェーズ2(マルチチャネル化)
- 「FAXがすべて終わってからでいい」とユーザー指示
- 現状の TODO 中で着手しない
- 設計案は `ROADMAP.md` 参照

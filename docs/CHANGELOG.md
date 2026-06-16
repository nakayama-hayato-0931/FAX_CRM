# CHANGELOG

会話履歴がなくても続きから作業できるよう、機能単位で実装履歴を記録する。

**運用ルール**: システムを更新するたびに ここに新エントリを追記する。 1日に複数機能追加でも 機能単位でブロック分けして書く。

書式:
- `[YYYY-MM-DD]` 機能名 — 主要なファイル / DB変更 / 注意点

---

## [2026-06-09] Sidebar: ダーク基調 + セクション分け + アイコン付き nav にリデザイン

**要望**: コールセンター画面のサイドバーレベルにスタイリッシュにしたい (緑ベース)。

**変更**: `Layout.js` のサイドバーを 全面刷新。
- **ダーク基調**: `bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950` で 落ち着いた深色
- **ブランドヘッダ**: 緑グラデーション角丸ロゴ (H) + 「Hitokiwa」 + 「FAX CRM」 uppercase tracking-[0.2em]
- **セクション分け** (6グループ): メイン / 集客運用 / 原稿 / 配信・受電 / 分析 / 管理
  - 各セクションタイトルは `text-[9.5px] tracking-[0.18em]` の薄い uppercase
- **アイコン付き nav** (heroicons 系の inline SVG):
  - home / users / filter / document / folder / phone / chart-bar / chart-pie / cog / shield
  - 絵文字を使わない方針 (stroke-1.5 の細線で統一)
- **active 状態**:
  - 右にグラデーション (`from-emerald-600/20 to-emerald-600/5`)
  - 左端に 3px の緑グラデーション縦バー
  - アイコンも emerald-400 にハイライト
  - 文字白
- **ホバー**: `bg-slate-800/60 hover:text-slate-100` でスムーズに
- **ユーザー枠** 下部:
  - 緑グラデーション円形アバター + イニシャル
  - ロールバッジ (管理者=amber / 営業=emerald) を outlined チップで
  - パスワード / ログアウト を 2 列ボタンに集約
- **カスタムスクロールバー** (`.custom-scrollbar`): 6px 幅、 半透明 slate、 ホバーで緑に
- 各 group は visible items が 0 件なら group ごと非表示 (営業ロールで管理者用 group が空になるケース)

---

## [2026-06-09] UI: 緑ベースに統一 + ブランドアクセントでスタイリッシュに

**要望**: もっとスタイリッシュに。 callcenter は青なので fax-crm は緑ベース。 絵文字禁止 (継続)。

**変更**:
- **一括カラー置換** (31 ファイル): プライマリ `indigo` / `violet` / `fuchsia` / `purple` → **`emerald`** に統一
  - `bg-indigo-600` (96 箇所) → `bg-emerald-600` 等、 すべての prefix (text/bg/border/ring/from/to/via/fill/stroke 等) 一括 sed
  - 残存ゼロ確認 (`bg-emerald-*` のみに正規化)
- **Layout**:
  - sidebar に 上部ブランドアクセント (深緑→緑→ティールのグラデーション帯)
  - ロゴ部分に 緑バー + 「FAX CRM」 サブラベル (uppercase tracking-widest)
  - nav active 項目: 左に 2px の緑インセットボーダー (`shadow-[inset_2px_0_0_0]`) + 文字色強調
  - hover に スムーズトランジション (`transition-all duration-150`)
  - ユーザー枠を `bg-zinc-50/50` に分離、 ロール表示を色分け
  - 全体 bg を `bg-zinc-50` でほんのり階調
- **ホーム**:
  - Hero セクション 新設 — 深緑→ティールのグラデーション + ぼかしブロブ装飾
  - カードに hover translateY + shadow + 色付き Active バッジ
  - 「これから実装」 を dashed border で 視覚的に分離
- **ログイン**:
  - 背景を緑系の柔らかいグラデーションに
  - カードに 上部アクセント帯 + emerald shadow + uppercase ブランドラベル
- **Toaster** (react-hot-toast):
  - 白背景 + 細い緑/赤の左ボーダー
  - 成功: emerald-600 / 失敗: red-600 アイコンテーマ
  - 角丸 + 控えめ shadow

**運用**: callcenter の青系 (`indigo`/`blue`) と視覚的に明確に区別。 絵文字ゼロ確認済 (grep で 0 件)。

---

## [2026-06-09] Layout: max-width 1500px 制限を撤廃 (ワイドモニタ対応)

**要望**: CPA 画面など 横長テーブルが ワイドモニタで全部見れるようにしたい。

**変更**:
- `Layout.js`: メインコンテンツ wrapper の `max-w-[1500px] mx-auto` を削除
- 横方向 padding (`px-8`) と縦方向 (`py-6`) は維持
- 全ページ共通で 「広げた分だけ広がる」 挙動に
- 文章中心ページ (例: 受電報告フォーム等) で間延びが気になる場合は、 ページ内部の wrapper に `max-w-3xl` 等を入れて調整 (今回は触らず)

---

## [2026-06-09] CPA: 売上シート J列 「ビザ」 を含む行を集計から除外 (部分一致化)

**問題**: 売上シートの J列 (status_label) には 「ビザ」 単体だけでなく 「ビザサポ」 「海外\nビザ」 等の派生値があった。 sync 時の判定が **完全一致** だったため、 派生値の行 (DB で 2 件) が CPA の 初回入金 / 見込売上 / 入金実績 / 内定社数 / 面接数 集計に紛れ込んでいた。

**確認した DB 状態**:
```
status_label='ビザサポ'   : 1 件 (payment_actual=55,000)
status_label='海外\nビザ' : 1 件 (payment_actual=88,000)
status_label='ビザ' (完全一致) : 0 件 (sync で除外済み)
```

**変更**:
- `salesProjectService.parseProjectsSheet`: 判定を `jVal === 'ビザ'` → `jVal && jVal.includes('ビザ')` に変更 (部分一致)
- `cpaService.getMonthly` の SQL で sales_projects を引く **3 箇所** に二重ガード追加:
  - 月キー UNION
  - 面接数 UNION の sales_projects 項
  - 内定社数 / 初回入金 / 見込売上 / 入金実績 集計の sp サブクエリ
  - 条件: `AND (status_label IS NULL OR status_label NOT LIKE '%ビザ%')`
- `interviewService.listOfferOnly`: 内定社内訳モーダルの sales_projects 引きにも同条件追加
- `salesProjectService.list`: 内定詳細モーダルの list にも同条件追加 (件数を CPA と一致)

**運用**: 既存の混入 2 件は DB から削除せず SQL WHERE で集計から除外。 次回 sync 時には新しい派生値 (「ビザ更新」 等) があれば即座に skip される。

---

## [2026-06-10] fix: 架電/抽出 N 回フィルタ で ER_NO_SUCH_TABLE → tier3 で fax-crm にフォールバック

**問題**: 「架電 1 回〜」 を入れて検索すると 500 で「Table 'railway.contact_events' doesn't exist」 が返る。 tier3 モードで `listFromCallcenter` が走り、 callcenter DB には `contact_events` テーブルが無いため。

**対策**: `customerRepo.listCustomers` で **`minCallCount` / `minExtractCount` が指定された時は tier3 でも `listFromFaxCrm` に強制フォールバック**。 これらフィルタは fax-crm DB の `contact_events` / `customers.extract_count` を参照するため、 fax-crm read pool が必要。

**運用注意**: tier3 (callcenter DB を主に読む) モードでも、 N 回フィルタを指定すると fax-crm DB から読むので、 callcenter 側にしか居ない顧客 (external_faxcrm_id が紐付いてない 顧客) は結果に出ない。 callcenter 由来のみの顧客に対するこのフィルタは現状未対応。

---

## [2026-06-10] 顧客マスタ: ページ切替ボタン + 架電/抽出 N 回以上フィルタ

**要望**:
1. ページ切替ボタン (現状は 「ページ 1/9851」 表示のみ)
2. フィルタに 「架電回数 N 回以上」 「抽出回数 N 回以上」 を追加

**変更 (1) ページネーション UI** (frontend):
- 「« 最初」 「‹ 前へ」 「[N] / 9851」 「次へ ›」 「最後 »」 ボタンを追加
- ページ番号は input で直接入力可
- 現在ページ + 全件数を表示
- 範囲外/loading 中はボタン disabled
- フィルタ変更時は page=1 にリセット

**変更 (2) フィルタ追加**:
- frontend: 「FAX」 セレクトの隣に **「架電 N 回〜」** **「抽出 N 回〜」** 入力欄
  - 空 or 0 = 制限なし、 1 以上で該当顧客に絞る
- backend `customerRepo.listFromFaxCrm`:
  - `minExtractCount`: `COALESCE(c.extract_count, 0) >= ?`
  - `minCallCount`: `(SELECT COUNT(*) FROM contact_events WHERE customer_id=c.id AND channel='call') >= ?`
  - SELECT に `extract_count` も含めて 一覧に返す
- backend `listFromCallcenter` (tier3 モード) も同等に対応
  - `external_faxcrm_id` 経由で fax-crm.customers / contact_events を JOIN
- 条件クリア時に新フィルタもリセット

**運用例**:
- 「架電 3 回〜」 → 一度も売れてないが営業候補から外れない 「成約見込みの薄い」 顧客の確認
- 「抽出 5 回〜」 → 何度もリストに入ってる古参顧客の確認 / 除外候補抽出

---

## [2026-06-10] タイムライン: 「コール」 → 「架電」 + 担当者名表示 + FAX抽出時の operator 記録

**要望**:
1. タイムラインの 「コール」 を 「架電」 に
2. source_system バッジ (「callcenter-ai」 等) を 架電担当者名 に
3. FAX 抽出時も ログインしている担当者名をタイムラインに

**変更 (1)(2) frontend**:
- `CustomerDetailModal`: `CHANNEL_META.call.label` を 「コール」 → 「架電」
- タイムライン行のバッジを `operator_name` 優先表示に変更
  - `operator_name` があれば 担当者名を表示 (例: 「山田」 「中田 倫哉」)
  - 無ければ従来通り `source_system` を表示 (例: 「callcenter-ai」 「fax-crm」)
- 下段の 「担当: 山田」 は重複表示を避けるため削除 (バッジに統合)

**変更 (3) backend 受電報告**:
- `incomingCallService.createEvent` 呼び出しに `operator_name: it.sales_owner` を追加
  - 受電報告で選択した担当営業がそのままタイムラインに反映

**変更 (4) backend FAX 抽出**:
- `extractionService` に `insertExtractionContactEvents(conn, customers, batchId, pcNumber, operatorName)` ヘルパー追加
  - channel='fax', event_type='send', source_system='fax-crm'
  - `source_event_id = batchId * 1e7 + customer_id` で一意 + INSERT IGNORE で再実行時の重複回避
  - 抽出 commit 時に呼び出し (テストモード時は呼ばない)
- `createBatch` / `createBatchesPerPc` に `operatorName` 引数追加
- `routes/batches.js` POST / extract-and-upload で `req.user.display_name || username` を渡す

**運用**: これで顧客マスタ → タイムラインを開くと、 callcenter からの架電も FAX-crm からの抽出 (FAX送信) も、 担当者の名前が一目で分かるようになる。 callcenter 側からの架電は callcenter のオペレーター名が出る前提 (callcenter 側で operator_name に作業者名を保存している場合)。

---

## [2026-06-10] パスワード最低 6 → 5 文字 + サイドバー アカウント表示の冗長性解消

**要望**:
1. パスワードの最低文字数を 5 文字に
2. サイドバー下部のアカウント表示で 「admin (管理者 admin)」 のように同じ admin が 2 ヶ所に出ているのを整理

**変更 (1) パスワード**:
- backend `userService`: `length < 6` → `length < 5`、 メッセージ 「6文字以上」 → 「5文字以上」 (create / changePassword の 2 箇所)
- frontend `ChangePasswordModal`: バリデーション + ラベル 5 文字に
- frontend `admin/users.js`: 新規作成 / パスワード再設定 の 4 箇所

**変更 (2) サイドバー表示**:
- `Layout.js` ユーザー枠で、 **`display_name === username`** の時は username のサブ表示を省略
  - これまで: 「admin」 + 「管理者 admin」 (= username が 2 ヶ所)
  - これから: 「admin」 + 「管理者」 (username 省略、 すっきり)
  - display_name が独自設定されてるユーザー (例: 「田中太郎」) は 「田中太郎」 + 「営業 tanaka」 のように 両方表示 (変わらず)

---

## [2026-06-10] リスト抽出: 「N回以上抽出済みを除外」 フィルタを追加

**要望**: 抽出条件に 「N回以上抽出を除外」 を追加。 デフォルトは 0 (= 除外しない)。

**変更**:
- backend `buildWhere` に `maxExtractCount` パラメータ追加 — `COALESCE(extract_count, 0) < ?` で WHERE フィルタ
- `previewCount` / `createBatch` / `createBatchesPerPc` / routes (POST `/api/batches` と `/api/batches/extract-and-upload`) 全部で受け渡し
- frontend `lists/new.js`: 入力欄を 「N日以内架電を除外」 の隣に追加
  - default 0 (除外しない)、 0-999 で指定可能
  - 「既存案件を除外」 チェックボックスは別行にレイアウト変更

**運用**:
- `0` (default): 制限なし — 何回抽出されてても候補に
- `3` 等: extract_count が 3 以上の顧客は完全除外。 抽出履歴が積み上がってる古参顧客に上限を設ける用途

---

## [2026-06-10] リスト抽出: 抽出履歴 (extract_count) を最優先のソート条件に

**要望**: 抽出履歴が少ない企業を優先したい。 多ければ多いほど 選ばれにくくする。

**変更**:
- `customers.extract_count` 列を新設 (INT NOT NULL DEFAULT 0 + index)
  - inline ensure migration で 既存環境にも自動追加
- 抽出 SQL の `PRIORITY_ORDER` を改修:
  ```
  ORDER BY extract_count ASC,    -- 1. 過去に抽出された回数が少ない順 (0 → 1 → 2 ...)
           send_count ASC,        -- 2. 同点なら 送信回数が少ない順
           last_sent_at IS NULL DESC,
           last_sent_at ASC,
           id ASC
  ```
- 抽出 commit 時の UPDATE で `extract_count = COALESCE(extract_count, 0) + 1` を加算
  - 単 PC / 複数 PC どちらも対応
  - **テストモードでは加算しない** (顧客マスタに履歴を残さないルールを継承)
- 結果モーダル (`BatchResultModal`) に **「抽出」** 列を新設 (emerald で目立たせる)
- 出力 Excel に **「抽出履歴」** 列を追加 (「送信履歴」 の左)

**運用**: 0 回 → 1 回 → 2 回 ... と機械的に回されるので、 全顧客に偏りなく FAX が回るようになる。 既に send_count が積み上がってる顧客が極端に避けられる現状から、 純粋に 「抽出機会の少ない順」 に修正。

---

## [2026-06-10] 電話 / FAX: 保存時にハイフン除去 + 既存 DB の一括正規化

**要望**:
1. 受電報告 手動入力で 会社名・電話・FAX を部分一致で検索したい
2. 電話 / FAX の ハイフン (-) / 全角ダッシュ (ー) は不要、 間違えて保存した時に自動で削除してほしい

**確認**: backend の `q=` 検索は すでに 部分一致 + 数字のみ比較 (REGEXP_REPLACE) で動作。 fax-crm / callcenter 両モードで対応済み。

**変更 (1) 保存パスのハイフン除去**:
- `customerService._normalizeDigit`: 「数字 / + / -」 のうち **`-` を除外** → 「数字 + プラスのみ」 を残す
- quick-create (受電報告 手動入力の 直接入力モード) や 顧客マスタ直接登録 で 「03-1234-5678」 を渡しても `0312345678` で保存される
- import path (`customerImportService.normalizeFax`) は元から数字のみだったので 変更不要

**変更 (2) 既存 DB の一括正規化**:
- `customerService.normalizePhoneFax`: MySQL `REGEXP_REPLACE(col, '[^0-9+]', '')` で `customers.phone_number` / `fax_number` から 数字以外を一括除去
  - tier3 モードでは `callcenter.companies` も同時処理
  - 変更が必要な行のみ UPDATE
- API: `POST /api/customers/normalize-phone-fax`
- 顧客マスタ ▼メンテナンス に **「ハイフン等の一括除去」** ボタンを追加 (緑 outlined)
  - 結果: fax-crm: phone=N / fax=N、 callcenter: phone=N / fax=N

---

## [2026-06-16] 送信結果集計ページ追加 (地域 × 業種 × 原稿国籍 で受電率/案件化率)

**要望**: 期間を選択したら、 どこの地域 / 業種 / 原稿国籍 で送って、 受電数・率と案件化数・率は何 % か分かる表が欲しい。 「いつ送ったか」 は抽出 / 格納時のフォルダ日付で判断。

**変更**:
- backend `sendResultSummaryService.js` 新規:
  - 集計対象: `contact_events WHERE channel='fax' AND event_type='send'`
    (リスト抽出 commit 時に記録されるレコード)
  - 期間絞り込み: `manuscript_folder_date BETWEEN from AND to` (= Drive フォルダ日付)
  - 受電判定: 同 customer に 抽出日以降の `channel='call'` あり
  - 案件化判定: `sales_projects.company_name` 一致 + `acquired_date >= 抽出日`
  - 軸: region (8地域に CASE マッピング) / industry_category / nationality (manuscript_contents)
  - `manuscript_id` → `manuscript_slot_files` → `manuscript_content_id` → `manuscript_contents.nationality` でリンク
- backend `routes/sendResultSummary.js`: GET `/api/send-result-summary?from=&to=&groupBy=`
- frontend `pages/send-result-summary/index.js`:
  - 期間プリセット (今日 / 当月 / 直近30日 / 直近90日) + 任意 from/to
  - 集計軸セレクト (地域 × 業種 × 国籍 / 各組合せ)
  - KPI カード (送信数 / 受電数 / 受電率 / 案件化数 / 案件化率)
  - 内訳表
- Layout `分析` グループに 「送信結果集計」 (chart-bar アイコン) を追加

**注**: 既存の `contact_events` (channel=fax,send) は前回コミットの 「FAX抽出時に operator 記録」 以降に積まれた分のみ集計対象。 それ以前の抽出履歴は集計に含まれない (今後の抽出から正しい数字が出る)。

---

## [2026-06-10] ドライブ格納の大幅高速化 (PC並列 + フォルダ並列)

**要望**: 2500 件 × N PC を抽出して Drive 格納するのが遅い。

**真因** (Explore で調査):
1. `routes/batches.js` extract-and-upload で PC ごとに for-of 直列処理 → N 倍時間
2. `ensureSlotsExist` (23 スロット) が PC ごとに重複呼び出し
3. `manuscriptService.ensureDriveFolders` で 23 スロット × `findOrCreateFolder` を直列 (= find + create で 46 API 往復)

**変更**:
- `routes/batches.js`:
  - `ensureSlotsExist(date)` を 事前 1 回だけ呼ぶ (PC ごとの重複削除)
  - PC 処理を **`Promise.all`** で並列化 + チャンクで **concurrency cap (5)** (Drive API rate limit 配慮)
  - env `EXTRACT_DRIVE_CONCURRENCY` で上書き可
- `manuscriptService.ensureDriveFolders`:
  - 23 スロット の `findOrCreateFolder` を **2 フェーズ化**
    - Phase 1: 並列 findOrCreate (concurrency 5)
    - Phase 2: DB 更新 + ファイル移動 (順次)
  - env `DRIVE_FOLDER_CONCURRENCY` で上書き可

**期待効果** (PC 23 台 × Excel/Drive で 旧 30-60 秒/PC × 23 = 11-23 分):
- PC 並列化で 23/5 ≈ 5 倍速
- スロットフォルダ並列化で findOrCreate 5 倍速
- 合計 **5-10 倍速** (見込み 2-4 分以内に短縮)

**リスク**: Drive API 並列呼び出し過剰で 5xx (rate limit) 可能性。 concurrency cap 5 で抑えてるが、 もし 429 が出るなら env で 3 等に絞れる。

---

## [2026-06-10] リストインポート: 複数ファイル選択 + 順次取込

**要望**: リストインポートを複数ファイル一気に選択して インポートしたい。

**変更** (`CustomerCsvImportModal.js`):
- `<input type="file">` に **`multiple`** 追加
- state を `file` → `files` (配列) に
- 選択ファイル一覧を 表示 (1 件ずつ × 削除可能、 ファイルサイズ表示)
- submit ロジックを 「順次直列処理」 に:
  - 1 ファイルずつ POST → polling で 完了/失敗を待つ → 次のファイル
  - 各ファイルの結果を `batchResults` に蓄積
  - 全体集計 (insert/update/skip/dupInFile の和) を結果ペインに表示
- 進捗表示に **「N / M ファイル目」** バッジ
- 結果ペインに **ファイル毎の成否一覧** (✓/✗ + 新/肉/SK 件数)
- ボタン文言を 1 ファイル / 複数で出し分け
  - 単一: 「新規リスト として取込」
  - 複数: 「3 ファイルを 新規リスト として順次取込」
  - 実行中: 「処理中… (2/3)」

**NGリストフィルタ動作確認** (ユーザーからの問い合わせ):
- 「新規リスト」 モード: 既存 NG (is_blacklisted=1) との 会社名 / 電話 / FAX いずれか一致 → スキップ
- 「NGリスト」 モード: 一致した既存企業を is_blacklisted=1 に、 未一致は NG 付きで新規登録
- 抽出時: WHERE is_blacklisted = 0 で除外
- 現状 DB: NG 6,657 件 / 通常 590,696 件 — フィルタは正常動作中

---

## [2026-06-10] 定時同期: setInterval 毎分チェック方式に変更 (起動時実行は廃止)

**要望**: 朝 7 時に 1 日 1 回だけ確実に同期してくれれば OK。 起動時に走るのも不要。

**対策**: `startDailyScheduler` を 「次の 7:00 を setTimeout 予約」 から **「毎分 setInterval でチェック」** 方式に置き換え。
- 1 分間隔の `tick()`:
  - JST 現在時刻が 7:00 以降 かつ そのジョブの `_lastRunDate ≠ 今日` の時のみ実行
  - 先に `_lastRunDate = 今日` をセットしてから起動 (二重起動防止)
  - 5 秒 stagger で順次起動 (Sheets API rate limit 回避)
- 起動時の即時実行は廃止 (純粋に 7:00 のみで動く)
- `scheduleStartupFaxStatsCatchup` 関数も削除

**運用**:
- 通常: 1 日 1 回 (朝 7:00:00-7:00:59 のいずれかの分でチェックヒット) で起動
- Railway 再起動が朝 7:01 以降に発生しても、 起動から最大 60 秒以内に tick が走り 「今日まだ動いてない」 を検知して即同期 (= 1 日 1 回は保証)
- 7:00 前に再起動した場合は通常通り 7:00 に 1 回

env (互換性のためそのまま):
- `DAILY_SYNC_HOUR` (default 7) / `DAILY_SYNC_MINUTE` (default 0)
- `DAILY_SYNC_ENABLED=0` で全体無効化
- `FAX_STATS_DAILY_SYNC_*` も後方互換で読む

---

## [2026-06-10] 定時同期: 直列 for-loop → 個別 setTimeout に分離 + 手動 trigger API

**問題**: 朝 7 時 batch を直列 for-loop で実装していたため、 fax-stats が 45 分かかった日に 後続 3 ジョブ (sales-projects / job-postings / interviews) が押し出されて 翌日に走らなかった。 DB を見たら fax-stats だけ今朝 07:45 で更新、 他 3 つは前日のまま。

**対策**:
- batch の for-loop を廃止し、 **各ジョブを個別 setTimeout チェーン** で予約
  - 1 ジョブが長時間化 / 例外で落ちても他に影響しない
  - 起動順は 5 秒ずつ stagger で Google Sheets API rate limit を回避
- `runJob(name)` を共通化 (進行状況を `SCHEDULER_STATE` に記録)
- 手動 trigger API 追加:
  - `POST /api/admin/scheduler/run-now?job=all|fax-stats|sales-projects|job-postings|interviews` — 即時 202 でバックグラウンド実行
  - `GET /api/admin/scheduler/status` — 各ジョブの state / startedAt / finishedAt / elapsedSec / result / error
- 詳細ログ: 各ジョブの START / DONE / FAILED と stack trace を console に出力

**運用**: 定時が外れた時は 手動で再実行できる。 朝 7 時を待たずにすぐ CPA データを最新化したい時にも便利。

---

## [2026-06-09] 定時同期に CPA 関連シート 3 種 (売上 / 案件 / 面接) を追加

**要望**: CPA にまつわる同期も朝 7 時に走らせたい。

**変更**:
- `server.js` の `startFaxStatsDailyScheduler` を **`startDailyScheduler`** に拡張
- 毎朝 JST 07:00 に **4 ジョブを直列実行**:
  1. FAX 送信実績 (`faxStatsSvc.syncFromSheets({ recentOnly: true, recentDays: 7 })`)
  2. 売上シート (`salesProjectsSvc.syncFromSheets()`)
  3. 案件シート (`jobPostingsSvc.syncFromSheets()`)
  4. 面接シート (`interviewsSvc.syncFromSheets()`)
- 1 ジョブの失敗で他を止めない **fail-soft** (各 try/catch で 続行)
- env リネーム + 互換:
  - 新: `DAILY_SYNC_HOUR` / `DAILY_SYNC_MINUTE` / `DAILY_SYNC_ENABLED`
  - 旧 `FAX_STATS_DAILY_SYNC_HOUR/MINUTE/ENABLED` も後方互換で読む
- ログ: `[scheduler] daily sync batch: START (4 jobs)` → 各ジョブの DONE/FAILED → `COMPLETE elapsed=Xs`

---

## [2026-06-09] Import 結果クリア + FAX 送信実績 朝 7 時 定時同期

**要望**:
1. インポート結果が出っぱなしで次のリストをインポートできない
2. FAX 送信実績を 毎朝 7 時に自動同期したい

**変更**:
- backend: DELETE `/api/customers/import/status` 追加 — done/failed のジョブ状態をクリア (running は 409 で拒否)
- frontend `CustomerCsvImportModal`:
  - モーダル open 時の auto resume を **running のみ** に変更
  - done/failed なジョブは自動で DELETE して fresh フォーム表示
  - 結果ペインに **「次のインポートへ」** ボタン追加 (DELETE + フォーム復帰)
  - 「閉じる」 も DELETE してから onCompleted を呼ぶ
- backend `server.js`: **定時スケジューラ** 追加
  - 毎朝 JST 07:00 に `faxStatsSvc.syncFromSheets({ recentOnly: true, recentDays: 7 })` を実行
  - `node-cron` を入れず 軽量 `setTimeout` チェーンで実装 (毎回 次の 7:00 を計算)
  - env で時刻 (`FAX_STATS_DAILY_SYNC_HOUR/MINUTE`) と日数 (`FAX_STATS_DAILY_SYNC_DAYS`) を上書き可
  - `FAX_STATS_DAILY_SYNC_ENABLED=0` で無効化可
  - Railway は UTC で動くので JST 計算は server.js 内部で実施

---

## [2026-06-09] 大規模 Import を Background Job 化 + 進捗 polling UI

**問題**: 60万行 import は 30-60 分かかり、 Railway proxy timeout (約 5 分) に必ず引っかかって ERR_FAILED / CORS エラー。 backend は処理を続けるが フロントには結果が返らない。

**対策 (本格)**:
- backend: POST `/api/customers/import` を 即時 **202 Accepted** + jobId 返却に変更
  - 実処理は 非同期 (fire-and-forget) で バックグラウンド継続
  - グローバル `importJob` 状態 (id/state/progress/result/error) で 1 ジョブ管理
  - 重複ジョブは 409 JOB_BUSY で拒否
- backend: GET `/api/customers/import/status` 新設 — 現在のジョブ進捗を返す
- `customerImportService.importCsv` に `onProgress` callback を貫通させ、 走査済み行数 / 有効 / insert / update / skip を リアルタイム反映
- frontend `CustomerCsvImportModal`:
  - 送信後 即時 202 を受け取り polling (3 秒間隔) で進捗を表示
  - 走査済み / 有効行数 / 新規追加 / 肉付け / スキップ / ファイル内重複 をリアルタイム表示
  - モーダル open 時に既存ジョブを auto resume (閉じても処理は継続するので、 再 open で復帰)
  - sky 系の progress box + animate-pulse でステータス可視化

**運用**: 60万行クラスでも UI は即時応答、 バックグラウンドで完走。 モーダルを閉じても処理は続き、 再 open で状況確認可能。 ERR_FAILED / CORS 問題は根絶。

---

## [2026-06-09] Import 失敗の真因 — Duplicate FAX (UNIQUE) 対策 + ファイル内 dedup

**問題**: 60万行 import が `Duplicate entry '0758135331' for key 'customers.uk_customers_fax'` で 500。 ファイル内に同じ FAX を持つ複数行が存在し、 chunk 跨ぎで UNIQUE 制約に衝突していた。

**対応**:
- `customerImportService.processImportStream`: ストリーム冒頭で `seenFax` / `seenPhone` (Set) でファイル内重複を事前 dedup。 同じ番号は最初の 1 行のみ buffer に積む。 結果に `dupInFile` 件数を含める
- `customerImportService.insertSingle`: `ER_DUP_ENTRY` を catch → 衝突した FAX/電話 で既存 ID を取得 → `updateExisting` (肉付け) にフォールバック → 取得できなければ `null` 返却で skip 扱い (例外を上に伝播させない)
- 呼び出し側 2 箇所 (new / existing-ng) で `newId === null` を skip に振り分け
- フロントの結果ペインに 「ファイル内重複」 行を追加 (件数あれば)

**運用**: これで chunk 跨ぎでも 1 ファイル内に同じ番号が複数あっても import は完走する。 fail-soft 設計。

---

## [2026-06-09] 大規模 Import 失敗 (500) 対策: timeout 緩和 + chunk 2000 化 + 詳細ログ

**問題**: 60万行 xlsx をリストインポートすると 500 エラー。 真因は ログ不足で未確定 (HTTP timeout / DB connection / メモリ / 例外 のいずれか)。

**短期対策**:
- `routes/customers.js`: POST /api/customers/import の req/res に `setTimeout(2h)` を設定。 START / DONE / FAILED を console.log
- `server.js`: HTTP server の `requestTimeout=0` / `headersTimeout=2h` / `keepAliveTimeout=2h` / `timeout=2h` を設定。 Node 18 default 65秒 → 2時間に
- `customerImportService.processImportStream`:
  - CHUNK 500 → **2000** に増 (DB ラウンドトリップ 1/4)
  - env `IMPORT_CHUNK_SIZE` で上書き可
  - 10 秒ごとに console.log で 経過時間/scanned/valid/insert/update/skip/black を出力 (Railway logs で進捗追える)

**次のアクション**: ユーザーに再試行 + Railway logs を確認してもらう。 真因に応じて
追加対策 (background job 化 / 行制限 / chunked upload 等) を検討。

---

## [2026-06-09] 都道府県: バグ値クリーンアップ + チェックボックスUI + 県名選択時の地域名 OR

**問題**: 都道府県セレクタに 「岐阜市水海道」 「大阪市都」 「府中市府」 「磐田市国府」 等のバグ値が大量混入。 + 個別県選択しても callcenter.companies の prefecture が 「関東」 等の地域名で保存されているため 0 件になっていた。

**変更**:
- `extractPrefecture` の正規表現フォールバック (`^([^\s\d]+?[都道府県])`) を**完全除去**。 今後は 47都道府県厳密一致のみ
- `normalizePrefectures` に `mode='invalid'` 追加 — 47県以外の値を address から再抽出、 不可は NULL に戻す。 cleared 件数も返却
- POST `/api/customers/normalize-prefecture?mode=invalid`
- ▼メンテナンス > 都道府県 に **「無効値クリーンアップ (推奨)」** ボタン追加 (rose ボーダー)
- 顧客マスタ画面の都道府県セレクタ: facet 由来 → **47県固定の地域グループ チェックボックス UI** に置換 (lists/new.js と統一)。 state を `prefecture` (string) → `prefectures` (string[])
- `utils/prefectures` に `withRegionNames()` 追加: 県名選択時に所属地域名を OR に自動追加 (例: `['茨城県']` → IN `['茨城県','関東']`)。 旧データに 「関東」 のまま残ってる行も県名選択でヒットする
- `customerService` / `customerRepo` (×2) の prefecture フィルタを `withRegionNames` ベースに統一

**注意**: クリーンアップ実行後は地域名は消えるので、 `withRegionNames` の地域名 OR は 「過渡期データの救済策」 兼 「全選択時の利便」 として残す。

---

## [2026-06-09] 顧客マスタ Import: 法人名称形式 + 大規模 xlsx (60万行) ストリーミング対応

**要望**: 「全業界まとめ.xlsx」 (60万行/108MB、 法人名称/法人サマリー/サイトURL 等のヘッダ) を取り込めるように。

**変更**:
- HEADER_ALIASES 拡張: 法人名称 → company_name / サイトURL → url / 業種(中分類1) → industry / 法人サマリー → note 本文 / メールアドレス/法人番号/法人種別/設立年月日/資本金(円) → note メタ集約
- `parseFileStream` 新設 (async generator): `.xlsx`/`.xlsm` は ExcelJS `WorkbookReader` でストリーミング (5,000行/3秒、 メモリ 119MB)、 `.xls` は SheetJS で全件、 `.csv` は csv-parser stream
- `processImportStream` 新設: iterator から 500件 buffer flush。 メモリは CHUNK 分だけ
- `importCsv` を新ストリーミング版に切替 (旧 `parseFile`/`processImport` も配列版として残す)
- multer `MAX_UPLOAD_SIZE_MB` default を 20MB → **500MB** に
- frontend axios timeout を 10分 → 60分 に
- モーダル説明文に 「.xlsx ストリーミング対応 (最大 500MB)」 追記

---

## [2026-06-09] 受電報告: 担当営業 マスタ管理 + トグル選択 + 新規追加

**要望**: 担当営業を自由入力からトグル選択に。 選択肢になければその場で新規追加。

**変更**:
- `sales_owners` テーブル新設 (id, name UNIQUE, is_active, sort_order)
- runtime migration ⑤d + `salesOwnerService.ensureTable` で inline ensure
- 既存 `incoming_call_reports.sales_owner` の DISTINCT 値を初期投入
- API: GET/POST/PATCH/DELETE `/api/sales-owners`
- `incomingCallService.createSingle` で `findOrCreate` を呼んでマスタ自動登録
- 受電報告 手動入力モーダル: input → トグルボタン群 (indigo) + 「+ 新規追加」 → インライン入力 (Enter で追加)

---

## [2026-06-09] CPA: ROAS の右に 入金実績 + 入金実績ROAS + 受電数手動入力モーダル独立

**変更**:
- CPA表 ROAS の右に **入金実績** (`sales_projects.payment_actual` = シート CC列 × 10000、 取消/辞退は 0) と **入金実績ROAS** (= 入金実績 ÷ コスト合算 × 100) を追加
- 受電数の手動入力UIをコスト入力モーダルから分離 → 独立した **`CpaIncomingInputModal`** (sky 系)。 CPA表の受電数セルクリックで開く
- `cpa_monthly_costs` に `incoming_picked_manual` / `incoming_missed_manual` 列追加 (NULL = 自動集計)、 手動値があれば zp_* 集計を上書き
- PUT `/api/cpa/monthly-incoming/:month`
- 表セルに 「手動」 バッジ (sky-100)

---

## [2026-06-09] 電話番号正規化 + zp_* と顧客マスタの紐付け

**要望**: 顧客タイムラインに zp 受電を表示、 受電報告手動入力で番号から顧客サジェスト。

**変更**:
- `utils/phone.js` 新設 — `normalizePhone` / `digitsOnly` で +81/0081/全角/ハイフン を吸収して国内 digits-only に
- 顧客検索 `q=` の +81 対応 (customerService / customerRepo ×2)
- `customerService.findByPhoneNormalized` + GET `/api/customers/lookup-by-phone?phone=...`
- `contactEventService.getTimeline` で `zp_recordings` / `zp_missed_calls` を顧客の正規化phone/fax で照合してマージ表示。 channel='call' / source_system='zoom-phone' / id prefix `zp_rec_` `zp_miss_`
- フロント CustomerDetailModal の SOURCE_BADGE に 'zoom-phone' (sky-50) 追加

---

## [2026-06-09] リスト抽出: NGワード機能 (DB管理 + 自動除外) + テストモード + 結果モーダル等 多数強化

**変更**:
- **NGワード**: `ng_words` テーブル (field × word × enabled)、 6 field (company_name/industry/address/note/url/representative) × 部分一致 LIKE で抽出から自動除外。 リスト抽出画面に管理モーダル
- **テストモード**: `extraction_batches.is_test` 列追加。 ON で `customers.send_count`/`last_sent_at`/`last_pc_number` を更新しない。 バッチ名末尾に `_TEST`、 一覧で TEST バッジ
- **N日以内架電 除外** (`contact_events` channel=call) と **既存案件 除外** (sales_projects/job_postings の company_name 一致) を抽出条件に追加
- **原稿同時格納**: 抽出時に原稿管理から選択した PDF も同じスロットに自動コピー (`attachContentToSlot`)
- **スロットタイトル自動設定**: 抽出時に 業種 / 都道府県 でタイトル埋め (空欄時のみ)
- **Excel ボタン → 結果モーダル**: window.open で 401 になっていたのを axios + blob に。 BatchResultModal で 検索 + 顧客一覧 + Excel DL ボタン
- **Excel フォーマット**: タイトル/メタ 5 行 + No. 列を削除。 1 行目からヘッダ
- **都道府県 multi-select**: REGION_GROUPS で地域グループ化 + 地域ボタンで一括選択。 prefecture[] = ['東京都',...] 配列対応 (IN(?))
- デフォルト名 「リスト_20260602」 → 「リスト」 (日付重複解消)

---

## [2026-06-09] 顧客マスタ: NG リスト追加 + FAX有無フィルタ + ボタン整理 + リストインポート改名

**変更**:
- 顧客詳細モーダル フッターに **NG リストに追加 / 解除** ボタン (赤 / 緑)。 prompt() で理由入力。 callcenter-only 顧客 (sentinel 負id) も `callcenter.companies` 直接更新で対応
- **FAX有無フィルタ** UI 表示可能に (grid-cols-5 → 6)。 `listFromCallcenter` にも has_fax フィルタを追加 (callcenter モードで効いてない bug 修正)
- トップバー整理: 再読み込み / ▼同期 / ▼メンテナンス / **リストインポート** (旧 CSVインポート) の 4 ボタンに集約
- 業種カテゴリ 再分類 / 都道府県 正規化 を callcenter.companies にも同時適用 (両DB処理)

---

## [2026-06-09] 受電報告: 担当営業 (sales_owner) 必須フィールド追加 + Urizo (.xls) 取込対応 + 業種カテゴリキーワード大幅拡張

**変更**:
- 受電報告に **担当営業** (sales_owner VARCHAR(100)) フィールド追加。 結果の上に配置、 必須バリデーション、 直前報告から自動補完
- `xlsx` パッケージ追加で **Urizo (売り蔵) .xls 形式** 直接取込 (BIFF8)。 〒/従業員数の正規化、 placeholder FAX (0000000000 等) を null化
- 業種カテゴリ自動分類: import 時に `industry_category` を 2段階判定 (業種 → ダメなら note 本文) で設定。 normalizeIndustry のキーワード大幅拡張 (縫製/印刷/加工/コンビニ/ベーカリー/介護関連 等)。 「飲食」 単体マッチも対応 (lookahead で 「飲食料品」 を除外)
- 既存 27 万件の再分類: ▼業種カテゴリ > 未分類のみ 再分類 ボタン (両DB対応)

---

## [2026-06-08] ログイン機能 + ユーザー管理 + CLAUDE.md 引き継ぎ整備

**変更**:
- JWT 認証 (bcryptjs + jsonwebtoken)。 admin / sales ロール
- ログイン画面: 受電報告 (パスワードなし、 guest-sales JWT) / 管理者 (要パスワード) の選択式
- ユーザー管理画面 (admin のみ): list/create/update/changePassword/remove。 last-admin 保護
- 起動時 `bootstrapInitialAdmin` で admin/admin123 作成
- プロジェクトルートに **CLAUDE.md** 新設 — 規約 / デプロイ / 落とし穴 / 直近作業の追い方を集約。 別の人が同じ Claude アカウントで開いた時に即引き継げる状態に

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

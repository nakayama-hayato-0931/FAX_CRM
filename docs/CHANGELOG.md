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

# CLAUDE.md — このリポジトリで作業する Claude への引き継ぎノート

> **このファイルは Claude Code が自動で読み込みます。** 別の人が同じ Claude
> アカウントでこのプロジェクトを開いた時に、 そのまま文脈を引き継げるよう
> 維持してください。 個人メモは `~/.claude` 側に、 プロジェクト共通の
> 規約・知識は ここ (CLAUDE.md) に書く分担です。

## 0. これは何

**Hitokiwa FAX-CRM System** — FAX 配信を起点とした B2B 営業 CRM。
顧客マスタ管理 / リスト抽出 / Excel + Drive 連携 / 受電報告 / CPA 指標 /
原稿管理 / 業種・地域フィルタ / NGワード除外 / callcenter-ai-system との
双方向同期 を備える。

スタック: **Next.js 14 (Pages Router) + Express 4 + MySQL 8 (Railway)**。
Frontend / Backend は Railway の別サービスでデプロイ。 GitHub の `main` push で
自動デプロイされる。

## 1. まず読むドキュメント (この順で)

| 優先 | ファイル | 内容 |
|---|---|---|
| 1 | このファイル | 全体 + 規約 + デプロイ + 直近の作業 |
| 2 | [docs/DECISIONS.md](docs/DECISIONS.md) | **必読** — 用語規約 / 既知の落とし穴 / 過去に叱責された案件 |
| 3 | [docs/CHANGELOG.md](docs/CHANGELOG.md) | 機能単位の作業履歴。 直近2-3エントリを読めば現状把握できる |
| 4 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | スタック / ディレクトリ / API 一覧 / DB スキーマ |
| 5 | [docs/SHARED_CUSTOMER_MASTER.md](docs/SHARED_CUSTOMER_MASTER.md) | callcenter-ai-system との共通顧客マスタ設計 |
| 6 | [docs/ROADMAP.md](docs/ROADMAP.md) | 次にやる候補 |

## 2. 絶対に守る規約 (これを破ると叱責される)

### 2.1 用語ルール
- 「送信結果入力」 ではなく **「受電報告」** と呼ぶ
  - DB テーブル名も `incoming_call_reports`
  - UI / コミットメッセージも 「受電報告」
- 「コール数」 ではなく **「送信数」** (FAX 送信数)
  - VIEW 列名は `sends` (旧 `calls` から rename 済)
- CSV インポートは **「リストインポート」** と表示
  (顧客マスタ画面のボタンも 「リストインポート」)

### 2.2 既存モックアップ参照禁止
- ルート直下や別リポジトリの `fax-crm-mockup.html` / `crm-frontend-mockup.html`
  / `multi-channel-crm-spec.html` は **絶対に見ない・転用しない**
- UI / 配色 / 画面名 すべて 会話で合意したものから組み立てる
- **2回叱責された案件**

### 2.3 絵文字禁止
- UI / トースト / confirm / コメント / コミットメッセージ いずれにも絵文字を使わない
- アイコン的に絵文字を使いたい場面でも、 テキスト記号 (▼ / ✕ / × / ←/→) で代用

### 2.4 Slack 通知いらない
- Slack 連携の話が出ても スコープ外。 提案しない

## 3. デプロイ ワークフロー

### 3.1 通常の変更
1. ローカルで編集
2. `git add` → `git commit` → `git push origin main`
3. Railway が自動で frontend / backend 両サービスをデプロイ
4. デプロイ完了通知は無いので、 ユーザーに反映時間 1-3 分を伝える

### 3.2 コミットメッセージ規約
```
<type>(<scope>): <要約>

<本文 — 背景 / 変更点 / 検証>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

type は `feat` / `fix` / `refactor` / `chore` / `docs` から選ぶ。 scope は
`customers`, `lists`, `reports`, `cpa`, `manuscripts`, `industry-category`,
`prefecture` 等 機能名。

絵文字、 hype 表現 (「" beautifully done"」 等) は不要。 淡々と。

### 3.3 DB スキーマ変更
新しいテーブル / 列 を増やしたら以下を **必ず** 全部対応:

1. `database/init.sql` を更新 (新規環境の clean 構築用)
2. `backend/src/migrations/runtime.js` に冪等な `ALTER TABLE` / `CREATE TABLE`
   を追加 (起動時マイグレーション、 既存環境向け)
3. 該当 service にも **inline ensure 関数** を仕込む
   - Railway の zero-downtime デプロイで 新コードが migration 完了前に走る
     race condition を回避するため
   - 例: `incomingCallService.ensureSalesOwnerColumn()` /
     `extractionService.ensureIsTestColumn()` 等

これを守らないと 本番で 500 (`Unknown column ...`) を踏みます。 過去に
何度も踏んでいます。

## 4. 重要な接続情報 (Railway 環境変数)

実値は `<https://railway.app>` の各サービス → Variables にあります。
Claude Code からは触らない。 ユーザーに依頼する形で。

| サービス | env var | 用途 |
|---|---|---|
| backend | `DATABASE_URL` (or `DB_HOST/PORT/USER/PASS`) | fax-crm MySQL |
| backend | `CALLCENTER_DB_URL` | callcenter-ai-system 側 MySQL (直接書込み用) |
| backend | `CALLCENTER_API_BASE_URL` / `CALLCENTER_API_TOKEN` | HTTP 同期 (レガシー、 Phase 2 で実質不要) |
| backend | `JWT_SECRET` | ログイン認証 (callcenter と統一して `callcenter_crm_jwt_secret_2026_railway_prod`) |
| backend | `INIT_ADMIN_USERNAME` / `INIT_ADMIN_PASSWORD` | 初回起動時の admin ブートストラップ (デフォルト admin / admin123) |
| backend | `DRIVE_SHARED_FOLDER_ID` (system_settings 経由) | Drive ルートフォルダ ID |
| backend | `GOOGLE_APPLICATION_CREDENTIALS_JSON` | サービスアカウント JSON (起動時に `/tmp/sa.json` に書き出すブートスクリプト経由) |
| backend | `FRONTEND_ORIGIN` | CORS 許可元 |
| backend | `DISABLE_AUTH=1` | 開発時の auth bypass (本番では使わない) |
| frontend | `NEXT_PUBLIC_API_BASE_URL` | backend の URL |

サービスアカウント: `fax-crm-backend@fax-crm-497000.iam.gserviceaccount.com`

## 5. アーキテクチャ メモ

### 5.1 顧客マスタ の 2 重 DB 構造 (重要)
- **fax-crm.customers** — このシステムが主に書き込むテーブル
- **callcenter.companies** — callcenter-ai-system 側のテーブル

`USE_CALLCENTER_DB` env var で読み取り元が切り替わる:
- 未設定 / `0` → fax-crm.customers から読む
- `1` / `tier1` → 一覧は callcenter.companies、 詳細も同じ
- `tier2` → 一覧 + 詳細とも callcenter から

**重要**: バックフィル系の admin 操作 (prefecture 正規化 / 業種カテゴリ再分類)
は **両 DB を必ず処理する** こと。 fax-crm 側だけ更新しても tier1+ モード
では表示に反映されない (過去に何度もハマっている)。
パターンは `customerService.normalizePrefectures` / `recategorizeIndustries`
を参照。

### 5.2 zp_* テーブル群 (CPA 受電数 ソース)
BigQuery から毎時自動投入される Zoom Phone データ:
- `zp_recordings` (~62k) — 通話/録音メタ
- `zp_transcriptions` (~62k) — 文字起こし
- `zp_analysis_results` (~62k) — 分析結果
- `zp_missed_calls` (~3k) — 不在着信
- `zp_exclusion_numbers` / `zp_sync_status` — 除外番号 / 同期状態

CPA View の 「受電数」 / 「不在数」 は `cpaService.getZpPickedCountsByMonth` /
`getZpMissedCountsByMonth` で集計。 **2 ヶ月クールダウン dedup** を JS で
実装 (`applyCooldownDedup`)。 LAG では実装できないので注意。

`caller_number` が国際フォーマット (+81 80 ...) で入っているのに
customers.phone_number は国内フォーマット (080 ...) なので、 顧客紐付け
には正規化が必要。

### 5.3 抽出 と Drive 連携の流れ
```
新規抽出フォーム (lists/new.js)
  → POST /api/batches/extract-and-upload
    1. createBatchesPerPc — 1 トランザクションで totalWant 件 FOR UPDATE
    2. PC ごと: Excel 生成 → スロット確保 → Drive にアップ
    3. manuscriptContentId が指定されてれば attachContentToSlot で原稿 PDF も Drive にコピー
    4. スロットタイトルが空なら "業種 / 都道府県" で自動設定
  → 結果カード ※ Excel ダウンロードは結果モーダルから (axios + blob、 window.open は 401)
```

### 5.4 NG リスト と NGワード の違い
- **NG リスト** (ブラックリスト) = 顧客個別フラグ (`customers.is_blacklisted`)
  - 顧客詳細モーダルの 「NG リストに追加」 で 1 件ずつ
  - 「リストインポート」 の `mode=ng` で一括
- **NGワード** = 部分文字列マッチで顧客を抽出から除外
  - リスト抽出画面の 「NGワード」 ボタンで管理
  - `ng_words` テーブル × 6 フィールド (company_name/industry/address/note/url/representative)

## 6. よく使うコマンド

```bash
# ローカル開発
cd backend && npm run dev    # nodemon で backend
cd frontend && npm run dev   # Next.js dev server

# DB マイグレーション (Railway 上では起動時に自動実行)
cd backend && npm run migrate

# git
git status
git log --oneline -20        # 直近の作業を確認
git push origin main         # Railway 自動デプロイ
```

## 7. 直近の作業を追う

新規セッション開始時は **必ず**:

1. このファイル + DECISIONS.md を読む
2. `git log --oneline -20` で 直近コミットを確認
3. CHANGELOG.md の上位 2-3 エントリを読む
4. 必要なら `git show <hash>` で個別コミットを確認

## 8. 既知の落とし穴 (時系列で蓄積)

- **scope creep を避ける** — ユーザー要望は最小スコープで解決。
  「ついでに」 リファクタや スタイル変更 は提案しない (会話を停めて確認する)
- **AskUserQuestion を dismiss されたら NO の意味** — 勝手に進めない
- **Excel ダウンロードに `window.open` を使うと 401** — axios + blob 必須
- **Railway デプロイで `Unknown column` 500** — inline ensure (§3.3) を仕込んで防ぐ
- **prefecture / industry の callcenter 同期忘れ** (§5.1)
- **placeholder の電話番号 / FAX (0000000000 等)** は UNIQUE 制約に衝突するので
  importService 側で normalize 段階で null 化済み (`normalizeFax`)
- **callcenter-only 顧客の id は負数 sentinel** (`-callcenter.companies.id`)
  — routes の正規表現を `\d+` から `-?\d+` に広げる必要 (例: NG ボタン)

## 9. このファイルを更新するタイミング

- 新しい規約 / 用語が決まった時
- DB スキーマに大きな変更が入った時
- デプロイ手順が変わった時
- 落とし穴を新たに踏んだ時 (§8 に追記)
- 引き継ぎ時に必要な情報が足りないと気付いた時

更新したら同じコミットに含めて push する。

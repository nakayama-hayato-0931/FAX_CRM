# コントリビューションガイド

このリポジトリで作業する全員 (人間 / AI 問わず) が読むドキュメント。 短くまとめてあります。

---

## 1. 絶対に守る規約

[CLAUDE.md §2](CLAUDE.md#2-絶対に守る規約-これを破ると叱責される) と [docs/DECISIONS.md](docs/DECISIONS.md) に詳しく書いてあります。 抜粋:

- **用語**: 「送信結果入力」 ではなく **「受電報告」**。 「コール数」 ではなく **「送信数」**。
- **既存モックアップ参照禁止**: `fax-crm-mockup.html` / `crm-frontend-mockup.html` 等は **見ない・転用しない**。
- **絵文字禁止**: UI / トースト / confirm / コメント / コミットメッセージ いずれにも絵文字を使わない。 テキスト記号 (✕ / × / ▼) で代用。
- **Slack 連携の話はスコープ外**。

---

## 2. ブランチ運用

main に直接 push しない。 機能単位でブランチを切って PR を出す。

### ブランチ命名

| プレフィクス | 用途 | 例 |
|---|---|---|
| `feature/` | 新機能追加 | `feature/cpa-monthly-override` |
| `fix/` | バグ修正 | `fix/lists-pc-checkbox-scroll` |
| `chore/` | 設定 / リファクタ / ドキュメント | `chore/update-changelog-format` |
| `hotfix/` | 本番障害の緊急修正 | `hotfix/extract-batch-500` |

ブランチ名は **kebab-case + 内容が分かる短い英語**。 1 ブランチ = 1 PR = 1 機能。

### 開発フロー

```bash
# 1. 最新の main を取得
git checkout main
git pull origin main

# 2. ブランチを切る
git checkout -b feature/your-feature

# 3. 作業 → コミット
git add ...
git commit -m "feat(scope): ..."

# 4. push して PR を作成
git push -u origin feature/your-feature
gh pr create        # または GitHub UI から
```

---

## 3. コミットメッセージ規約

[CLAUDE.md §3.2](CLAUDE.md#32-コミットメッセージ規約) と揃える。

```
<type>(<scope>): <要約>

<本文 — 背景 / 変更点 / 検証>

Co-Authored-By: ...  (任意)
```

| type | 使いどころ |
|---|---|
| `feat` | 新機能 |
| `fix` | バグ修正 |
| `refactor` | 振る舞いを変えないコード整理 |
| `chore` | 設定 / 依存更新 / ドキュメント |
| `docs` | ドキュメントのみ |

scope は機能名 (例: `customers`, `lists`, `reports`, `cpa`, `manuscripts`, `industry-category`, `prefecture`)。

絵文字や hype 表現 (「beautifully done」 等) は不要。 淡々と。

---

## 4. PR フロー

### 4.1 PR テンプレートに沿って書く

ブランチを push して PR を作ると [PULL_REQUEST_TEMPLATE](.github/PULL_REQUEST_TEMPLATE.md) が自動で本文に入ります。 全項目を埋めてください。

### 4.2 PR タイトル

コミットメッセージと同じ規約: `<type>(<scope>): <要約>`。 マージ時に Squash されると このタイトルが 1 個のコミットになるので、 簡潔かつ意味のあるものに。

### 4.3 必須チェックリスト (PR 本文に含める)

- [ ] [docs/CHANGELOG.md](docs/CHANGELOG.md) に新エントリを追記した (規約は §5 参照)
- [ ] `node --check` で syntax エラーが出ない
- [ ] DB スキーマを変えた場合、 `database/init.sql` + `backend/src/migrations/runtime.js` + サービス層の inline ensure の 3 点を全部更新した ([CLAUDE.md §3.3](CLAUDE.md#33-db-スキーマ変更))
- [ ] 関連 Issue があれば PR 本文に `Closes #N` を含める

### 4.4 レビュー & マージ

- 最低 1 名のレビュー承認が必要 (GitHub 側のブランチ保護で設定)
- 「Squash and merge」 を使う (1 PR = 1 コミット履歴に圧縮)
- マージ後、 ローカルでは `git checkout main && git pull` で同期

### 4.5 hotfix の例外

本番障害で 即時 fix が必要な場合は、 `hotfix/` ブランチで作業 → セルフレビューで即マージ可。 ただし PR は必ず作る (履歴を残すため)。 マージ後 Slack ではなく 口頭 or 別チャネルで周知。

---

## 5. CHANGELOG.md の更新ルール (必須)

[CLAUDE.md §3.3](CLAUDE.md#33-changelogmd-は-毎更新-都度追記-必須) と同じ。

- **1 PR = 1 機能 = 1 CHANGELOG エントリ** が理想
- PR を作るタイミングで [docs/CHANGELOG.md](docs/CHANGELOG.md) の最上段に追記
- 既存エントリは触らない
- フォーマット:

```md
## [YYYY-MM-DD] 機能名 — 1行サマリ

**背景 / 要望**: 何のためか

**変更**:
- 主要なファイル / DB変更 / API 変更
- 注意点 / 互換性

**検証** (任意): どう確認したか
```

これを守ると 1Mコンテキスト圧縮後でも、 CHANGELOG を読めば直近の作業が時系列で把握できる。 git log と CHANGELOG.md は 引き継ぎの 2 大資産。

---

## 6. DB スキーマ変更時の 3点セット (必須)

新しいテーブル / 列 を増やしたら **必ず** 3 つ全部対応:

1. `database/init.sql` を更新 (新規環境の clean 構築用)
2. `backend/src/migrations/runtime.js` に冪等な `ALTER TABLE` / `CREATE TABLE` を追加 (起動時マイグレーション、 既存環境向け)
3. 該当 service にも **inline ensure 関数** を仕込む (Railway zero-downtime デプロイで 新コードが migration 完了前に走る race を回避)

これを守らないと 本番で `Unknown column ...` 500 を踏みます。 過去に何度も踏んでいます。

例: `extractionService.ensureIsTestColumn()` / `incomingCallService.ensureSalesOwnerColumn()`

---

## 7. デプロイ (再掲)

`main` への merge で Railway が自動デプロイ。 反映 1〜3 分。

- backend 起動ログで migration の `applied` / `failed` を確認
- `/api/health` で scheduler が動いてるか確認

---

## 8. よくある落とし穴

[CLAUDE.md §8](CLAUDE.md#8-既知の落とし穴-時系列で蓄積) の方が詳しいが、 入りたての人が踏みやすいのを抜粋:

- **「ついで」 のリファクタを混ぜない** — スコープ外の変更は別 PR
- **scope creep を避ける** — ユーザー要望は最小スコープで解決
- **顧客マスタは 2 重 DB 構造** ([CLAUDE.md §5.1](CLAUDE.md#51-顧客マスタ-の-2-重-db-構造-重要))。 fax-crm.customers と callcenter.companies の **両方** を更新する操作がある
- **Excel ダウンロードに `window.open` を使うと 401** — axios + blob 必須
- **callcenter-only 顧客の id は負数 sentinel** (`-callcenter.companies.id`) — route の正規表現を `\d+` から `-?\d+` に広げる必要

---

## 9. 質問するときは

- 仕様 / 規約: まず [CLAUDE.md](CLAUDE.md) + [docs/DECISIONS.md](docs/DECISIONS.md) を読む
- 「これって何のため？」: `git log --oneline -20` と [docs/CHANGELOG.md](docs/CHANGELOG.md) の上位エントリで大体掴める
- それでも分からなければ Issue を立てて議論

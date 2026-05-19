# ROADMAP

優先度順、ユーザーが明示した要件 + 提案中のもの。

---

## 着手しない(明示的に保留)

### マルチチャネル化(フェーズ2)
> 「FAXがすべて終わってからでいい」(ユーザー指示)

FAX領域が完全に固まった後に着手する。設計メモ:

- メール / AIオートコール / SNS DM を **MCP サーバー**として実装
- オーケストレーター(Temporal / Inngest / 自前)が状態機械を管理
- 1リードに対し: `FAX → 待機 → メール → 待機 → AI コール → 待機 → 別チャネル` を自動でループ
- 反応あれば営業に通知(チャネル横断の通知ハブ)
- 既存の `customers` を MCP 全体の中央マスタとして使う

---

## 着手候補(優先順)

### 1. リスト抽出時の Drive 自動アップロード(設定ONケース)
- 現状: 「Drive保存」ボタンを手で押す必要あり
- 改修案: `extractionService.createBatch()` 内で `drive_auto_upload === '1'` を見て、生成完了後に自動アップロード
- 失敗してもバッチ作成は成功扱い(ベストエフォート)

### 2. 受電報告 CSV取込(FAX機ログから自動マッチング)
- 現状: バッチ別UI で手動入力のみ
- 改修案: FAX機が吐く結果CSV(成功/失敗/通信時間)を `POST /api/incoming-calls/import`
  - FAX番号で `customers` にマッチング → `incoming_call_reports` に UPSERT
  - 結果 ENUM へのマッピング: `success → no_response`, `通信エラー → invalid_number` 等
- マッチしない行は別ペインで「手動確認」キューに

### 3. 顧客マスタの一括編集
- 現状: ブラックリスト切替のみ
- 改修案: チェックボックスで複数選択 → 「業種を一括変更」「メモ追加」など

### 4. ユーザー認証 + 権限ロール
- 現状: 認証なし(VPN前提)
- 改修案: NextAuth + Google Workspace ログイン
  - role: admin / operator / manager
  - operator は顧客削除不可、admin だけ設定変更可、等

### 5. CSVプレビュー
- インポート前に最初の5行をプレビュー表示
- カラムマッピング画面(現在の自動マッピングを上書きできる)

### 6. エラーバウンダリ
- React error boundary でページ全体が真っ白にならないように
- 「再読み込み」ボタン付きのフォールバックUI

### 7. 通知ハブ(汎用)
- Slack通知は一度削除したが、もし必要なら復活
- ただし汎用化: 「受電 反応あり」「Drive同期失敗」「インポート完了」など複数イベントを購読する仕組み

---

## 完成済み(参考)

`docs/CHANGELOG.md` 参照。

| バージョン | 機能 | 日付 |
|---|---|---|
| 0.7.0 | 原稿管理に使用履歴(業種/地域/PC別) | 2026-05-15 |
| 0.6.0 | CPA仕様変更(送信数 / ROAS=初回入金/コスト) | 2026-05-15 |
| 0.5.0 | Excel書式 / エラーハンドリング / Slack削除 | 2026-05-15 |
| 0.4.0 | 原稿フォルダ Drive 自動作成 | 2026-05-15 |
| 0.3.0 | 設定画面 + Drive連携 | 2026-05-15 |
| 0.2.0 | FAX送信実績 (Sheets連携) | 2026-05-15 |
| 0.1.0 | フェーズ1 全機能(CPA / 顧客 / 抽出 / 原稿 / 受電報告) | 2026-05-14 |

---

## 「すぐに復元」のための最小手順

万一会話履歴が消えた場合、新しいセッションで以下を見れば再開可能:

1. `fax-crm-system/README.md` — 概要 + 全機能の状態
2. `fax-crm-system/docs/CHANGELOG.md` — どこまで何を作ったか時系列
3. `fax-crm-system/docs/ARCHITECTURE.md` — 全構造 + API一覧 + デモURL
4. `fax-crm-system/docs/DECISIONS.md` — 守るべき規約 + 落とし穴
5. `fax-crm-system/docs/ROADMAP.md`(本ファイル) — 次にやることの優先順
6. ユーザーのClaude メモリ:
   - `feedback_no_existing_mockups.md` — 既存モックを参照禁止
   - `project_fax_crm_terminology.md` — 受電報告 / 送信数 ルール
   - `project_fax_crm_repo.md` — リポジトリ位置と構成

これだけ揃っていれば、新しいセッションでも続きから着手できる。

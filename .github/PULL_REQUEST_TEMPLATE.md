<!--
PR タイトルは <type>(<scope>): <要約> 形式で。 例: feat(cpa): 月別 指標 7 列の手動上書き
CONTRIBUTING.md §3-4 を参照。
-->

## 概要

<!-- 何を変えたか 1-2 行で -->

## 背景 / 要望

<!-- なぜ必要だったか。 関連 Issue があれば「Closes #N」 を入れる -->

## 変更点

<!-- 主要なファイル / DB変更 / API 変更 / UI 変更を箇条書きで -->

-
-

## 動作確認

<!-- どう確認したか。 ローカル / デモ表示 (?demo=1) / 本番想定の手順 など -->

-

## チェックリスト

- [ ] [docs/CHANGELOG.md](../docs/CHANGELOG.md) に新エントリを追記した
- [ ] `node --check` で syntax エラーが出ない
- [ ] DB スキーマ変更があれば `database/init.sql` + `backend/src/migrations/runtime.js` + サービス層 inline ensure の 3 点全部更新した
- [ ] 用語ルール / 絵文字禁止 / 既存モックアップ参照禁止 を守った
- [ ] 関連 Issue があれば本文に `Closes #N` を入れた

## 影響範囲 / 注意点

<!-- 既存機能への影響、 互換性、 ロールバック手順、 オペ向けの注意 など -->

# Hitokiwa FAX-CRM System

FAX 配信を起点とした B2B 営業 CRM。 顧客マスタ管理 / リスト抽出 / Excel + Drive 連携 / 受電報告 / CPA 指標 / 原稿管理 / 業種・地域フィルタ / NGワード除外 / callcenter-ai-system との双方向同期 を備える。

スタック: **Next.js 14 (Pages Router) + Express 4 + MySQL 8 (Railway)**

---

## 直近の状況を知る

| 知りたいこと | どこを見る |
|---|---|
| 直近の変更履歴 (機能単位の作業ログ) | [docs/CHANGELOG.md](docs/CHANGELOG.md) |
| 現在進行中の作業 | [Pull Requests](../../pulls) (open) |
| 未対応 / 議論中の課題 | [Issues](../../issues) (open) |
| 自動デプロイ状況 | Railway (`fax-crm-frontend` / `fax-crm-backend` サービス) |
| backend / scheduler 死活 | `/api/health` (認証不要) |
| 過去の決定事項 / 既知の落とし穴 | [docs/DECISIONS.md](docs/DECISIONS.md) |
| アーキテクチャ / API / DB スキーマ | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 次にやる候補 | [docs/ROADMAP.md](docs/ROADMAP.md) |
| 引き継ぎノート (規約 / 接続情報 / 落とし穴) | [CLAUDE.md](CLAUDE.md) |

---

## 開発に参加する

新しく入る人は **必ず** [CONTRIBUTING.md](CONTRIBUTING.md) を読んでください。 ブランチ運用 / コミット規約 / PR フロー / CHANGELOG 更新ルール / 絶対に守る規約 が書いてあります。

### クイックスタート

```powershell
# 1. 依存
npm --prefix backend install
npm --prefix frontend install

# 2. .env
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env.local
# backend\.env で MySQL 接続情報 / GOOGLE_APPLICATION_CREDENTIALS_JSON 等を設定

# 3. DB マイグレーション (起動時にも自動実行されるが、 手動でも可)
npm --prefix backend run migrate

# 4. 起動 (別ターミナル)
npm --prefix backend run dev    # http://localhost:4001
npm --prefix frontend run dev   # http://localhost:3001
```

### 必要な環境変数

詳細は [CLAUDE.md §4](CLAUDE.md#4-重要な接続情報-railway-環境変数)。 主なもの:

| サービス | 変数 | 用途 |
|---|---|---|
| backend | `DATABASE_URL` (or `DB_HOST/PORT/USER/PASS`) | fax-crm MySQL |
| backend | `CALLCENTER_DB_URL` | callcenter-ai-system 側 MySQL |
| backend | `JWT_SECRET` | ログイン認証 |
| backend | `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Google Drive / Sheets API |
| frontend | `NEXT_PUBLIC_API_BASE_URL` | backend の URL |

### デモ表示 (DB 未接続でも動く)

各ページに `?demo=1` をつけるとデモデータが表示されます。 PR レビュー時の動作確認に便利:
- `http://localhost:3001/cpa?demo=1`
- `http://localhost:3001/customers?demo=1`
- `http://localhost:3001/lists?demo=1`
- `http://localhost:3001/manuscripts?demo=1`
- `http://localhost:3001/fax-stats?demo=1`

---

## デプロイ

`main` への push で Railway が自動デプロイ (frontend / backend 各サービス、 反映 1〜3 分)。 PR のマージで本番反映、 と覚えれば OK。

デプロイ後の確認:
- `https://fax-crm-backend-production.up.railway.app/api/health` で backend の状態 + scheduler の直近実行を確認

---

## リポジトリ構成

```
fax-crm-system/
├── backend/                    Express + MySQL
│   ├── src/
│   │   ├── routes/             HTTP エンドポイント
│   │   ├── services/           ビジネスロジック (DB / 外部 API)
│   │   ├── migrations/         起動時マイグレーション (冪等)
│   │   └── server.js           エントリ + 定時スケジューラ
│   └── package.json
├── frontend/                   Next.js 14 (Pages Router) + Tailwind
│   ├── src/
│   │   ├── pages/              画面 (1 ファイル = 1 ルート)
│   │   ├── components/         共有 UI
│   │   ├── contexts/           認証等の Context
│   │   └── utils/              api クライアント等
│   └── package.json
├── database/
│   └── init.sql                新規環境向け 全テーブル DDL
├── docs/
│   ├── CHANGELOG.md            機能単位の作業履歴 (毎更新追記)
│   ├── DECISIONS.md            用語規約 / 過去の決定 / 既知の落とし穴
│   ├── ARCHITECTURE.md         全体構成 / API / DB スキーマ
│   ├── ROADMAP.md              次にやる候補
│   └── SHARED_CUSTOMER_MASTER.md
├── .github/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── ISSUE_TEMPLATE/
├── CLAUDE.md                   Claude Code 用 引き継ぎノート
├── CONTRIBUTING.md             コントリビューションガイド
└── README.md                   このファイル
```

---

## ライセンス

社内利用のみ。 外部公開はしない。

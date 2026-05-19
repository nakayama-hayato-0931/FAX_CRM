# DEPLOY

FAX-CRM を公開する手順。Railway(MySQL + backend + frontend の3サービス)を想定。

---

## 全体構成

```
                    GitHub Repo (fax-crm-system)
                              │ auto-deploy
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       Railway Service  Railway Service  Railway MySQL
       ───────────────  ───────────────  ─────────────
        backend         frontend          DB
        (Express)       (Next.js)         (8.0)
        Port: $PORT     Port: $PORT
              ▲               │
              └───── API ─────┘
              (NEXT_PUBLIC_API_BASE_URL)
                 (FRONTEND_ORIGIN ←CORS)

       Google Cloud Platform
       ─────────────────────
        - Service Account JSON
        - Drive API enabled
        - Sheets API enabled
        - シート/フォルダをサービスアカウントに「閲覧者」or「編集者」共有
```

---

## ステップ 1. ローカルGit + GitHub

### 1.1 ローカル(私が実行済みの場合は次へ)

```powershell
cd fax-crm-system
git init
git add .
git commit -m "Initial commit: FAX-CRM System v0.9.0"
```

### 1.2 GitHub に空リポジトリを作成

- https://github.com/new
- 名前: `fax-crm-system`(callcenter-ai-system と同じorgがおすすめ)
- **Private を推奨**(顧客データを扱う設計のため)
- README / .gitignore は **追加しない**(ローカルに既にある)
- 作成すると `https://github.com/{user}/fax-crm-system.git` が表示される

### 1.3 push

```powershell
cd fax-crm-system
git remote add origin https://github.com/{user}/fax-crm-system.git
git branch -M main
git push -u origin main
```

---

## ステップ 2. Google Cloud(API キー)

「Drive 連携」と「Sheets 同期」を本番で使う場合のみ必要。試運用ならスキップ可。

### 2.1 GCP プロジェクト作成

- https://console.cloud.google.com/ → New Project
- 名前: `fax-crm` 等

### 2.2 API 有効化

「APIs & Services」→「Enable APIs」で:
- **Google Drive API**
- **Google Sheets API**

### 2.3 サービスアカウント作成

- 「IAM & Admin」→「Service Accounts」→「Create Service Account」
- 名前: `fax-crm-backend`
- ロール: 何も付けない(Drive/Sheets は共有設定で個別付与する設計)
- 作成後、そのアカウントを開き → Keys タブ → Add Key → JSON → ダウンロード
  - 例: `fax-crm-461510-abcd1234.json`
- **このファイルは秘密情報** (リポジトリにコミットしない)

### 2.4 共有設定

ダウンロードJSON内の `client_email`(例: `fax-crm-backend@fax-crm.iam.gserviceaccount.com`)を控える。

- **Drive ルートフォルダ**: そのフォルダを開く → 共有 → 上記メールに「編集者」権限を付与 → URL内のフォルダIDを控える(例: `1AbCdEfG...`)
- **FAX送信実績シート**(`1dm7UEBA-OcOmgtCva2xJZkPYEDBx9lTW2k4GFrsxjZQ`): 共有 → 上記メールに「閲覧者」権限を付与

---

## ステップ 3. Railway デプロイ

### 3.1 プロジェクト作成 + DB

- https://railway.app/ → New Project → Empty Project
- Add Service → **Database → MySQL** を追加
- 作成後、MySQL を開いて「Connect」タブで以下を控える:
  - `MYSQLHOST` / `MYSQLPORT` / `MYSQLUSER` / `MYSQLPASSWORD` / `MYSQLDATABASE`
  - または `MYSQL_URL`(全部入りURL)

### 3.2 backend サービス

- Add Service → **GitHub Repo** → 先ほどpushした `fax-crm-system` を選択
- Settings:
  - Service Name: `fax-crm-backend`
  - **Root Directory**: `backend` ← 重要
  - Build Command: 既定でOK(`npm install`)
  - Start Command: `npm start`(railway.toml 経由でも可)
- Variables(環境変数):
  ```
  NODE_ENV=production
  PORT=4001                      # Railway が自動で割当てる場合は不要
  DB_HOST=${{MySQL.MYSQLHOST}}
  DB_PORT=${{MySQL.MYSQLPORT}}
  DB_USER=${{MySQL.MYSQLUSER}}
  DB_PASSWORD=${{MySQL.MYSQLPASSWORD}}
  DB_NAME=${{MySQL.MYSQLDATABASE}}
  FRONTEND_ORIGIN=https://<frontend公開URL>     # ← 3.3 で発行後に追記
  UPLOAD_DIR=./uploads
  MAX_UPLOAD_SIZE_MB=50
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./config/google-service-account.json
  ```
- Google認証JSONの配置:
  - Railway は通常ファイルアップロード機能がないので、以下のいずれか:
    - (推奨) `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` 環境変数にJSON文字列を入れる + サーバ起動時に書き出す
    - もしくは小さなブートスクリプトで `process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON` を `./config/google-service-account.json` に書き出す
    - → 後述の **3.5 サービスアカウントJSON配置**を参照
- Deploy → ログで `[server] FAX CRM Backend listening on :4001` を確認
- 公開URLを「Settings → Networking → Generate Domain」で発行 → 控える(例: `https://fax-crm-backend-production.up.railway.app`)

### 3.3 frontend サービス

- Add Service → 同じGitHub Repo
- Settings:
  - Service Name: `fax-crm-frontend`
  - **Root Directory**: `frontend` ← 重要
  - Build Command: `npm install && npm run build`
  - Start Command: `npm start`(`-p $PORT` を package.json で対応するなら不要だが、現状は `-p 3001` 固定。Railway 用にはこれを `-p $PORT` に変えるとよい)
- Variables:
  ```
  NEXT_PUBLIC_API_BASE_URL=https://<backend公開URL>   # 3.2 のURL
  ```
- Deploy → 公開URLを発行 → 控える

### 3.4 仕上げ: CORS と相互参照

- backend サービスの `FRONTEND_ORIGIN` に 3.3 で発行した frontend のURLを設定 → 再デプロイ
- ブラウザで frontend URL を開く → ダッシュボードが表示されることを確認

### 3.5 サービスアカウントJSON配置(backend)

Railway は永続ファイルがないので、起動時に環境変数からJSONを書き出す方式を推奨。
`backend/scripts/prepare.js` を作って package.json の `start` 前に走らせる:

```js
// backend/scripts/prepare.js
const fs = require('fs');
const path = require('path');
const json = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
if (json) {
  const dir = path.resolve(__dirname, '../config');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dst = path.resolve(dir, 'google-service-account.json');
  fs.writeFileSync(dst, json);
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH = dst;
  console.log('[prepare] service account JSON written to', dst);
}
```

`backend/package.json` の scripts:
```json
"start": "node scripts/prepare.js && node src/server.js",
```

Railway Variables に:
```
GOOGLE_SERVICE_ACCOUNT_KEY_JSON=<JSONを1行貼り付け>
```

---

## ステップ 4. DBマイグレーション

backend サービスのRailwayターミナルから:

```
npm run migrate
```

または、ローカルから Railway MySQL に接続して `database/init.sql` を流す:

```powershell
$env:DB_HOST="containers-us-west-xxx.railway.app"
$env:DB_PORT="6543"
$env:DB_USER="root"
$env:DB_PASSWORD="xxxx"
$env:DB_NAME="railway"
npm --prefix fax-crm-system\backend run migrate
```

成功すると `[migrate] success` が出る。

---

## ステップ 5. 初期データ投入

1. ブラウザで `https://<frontend公開URL>/` を開く
2. 顧客マスタ → CSVインポート → 実際のCSVをアップロード
3. 設定 → Drive ルートフォルダID を入力 → 保存
4. 設定 → FAX送信実績 Sheets → シートID(`1dm7UEBA-...`)を入力 → 保存 → 今すぐ同期

---

## ステップ 6. 運用

### 自動デプロイ
GitHub の `main` ブランチに push する度に Railway が自動再デプロイ。

### ログ確認
Railway のサービスごとに「Deployments → View Logs」。
backend のエラーログは構造化JSONで出る(`{level, request_id, ...}`)。

### バックアップ
Railway MySQL は Backups タブで自動スナップショット設定可能(プラン依存)。

### ドメイン
無料プランの `*.up.railway.app` をそのまま使うか、Settings → Networking → Custom Domain で独自ドメインを設定。

---

## 公開前チェックリスト

- [ ] git push 済み(main ブランチ)
- [ ] Railway: MySQL / backend / frontend の3サービスがGreen
- [ ] backend `/api/health` が `{ status: 'ok', db: { ok: true } }` を返す
- [ ] frontend → backend へのAPI呼び出しが CORS で通る(FRONTEND_ORIGIN 設定)
- [ ] 設定画面のGoogle認証ステータスが「✓ 設定済」「✓ 利用可能」
- [ ] Drive接続テスト OK
- [ ] FAX送信実績 Sheets同期 OK
- [ ] (必要なら) ベーシック認証 or VPN前提アクセス制限(現状アプリ層に認証なし)

## 認証について

現状アプリ側に認証はありません。本番で外部公開する前に最低でも以下のどれかを:

1. **Railway の Network Settings で IP制限**(VPN固定IPがあるなら)
2. **Cloudflare Access** などで前段BASIC認証
3. アプリ層に **NextAuth + Google Workspaceログイン** を追加(将来仕様、ROADMAP.md 参照)

---

## トラブルシュート

| 症状 | 対処 |
|---|---|
| build失敗: `Module not found` | Root Directory が `backend` / `frontend` になっているか確認 |
| Cannot connect to MySQL | DB_HOST 等が `${{MySQL.MYSQLHOST}}` 形式か / MySQL サービスが Green か |
| CORS エラー | backend `FRONTEND_ORIGIN` を frontend URL(末尾 `/` なし)に設定 |
| Drive接続テスト 401 | サービスアカウントメールに該当フォルダ/シートが共有されているか |
| Sheets同期 0件 | sheet_range が広めに取れているか(`A1:AZ500`)/ シート構造がpivotか |
| `recharts` で `ResponsiveContainer` が空 | `recharts@2.13.x` を使う(v3は不可) |

---

## 関連ドキュメント

- `docs/CHANGELOG.md` — 変更履歴
- `docs/ARCHITECTURE.md` — システム構造
- `docs/DECISIONS.md` — 設計判断 + 落とし穴
- `docs/ROADMAP.md` — 今後の予定

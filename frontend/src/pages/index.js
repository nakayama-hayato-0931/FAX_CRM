import Link from 'next/link';

const DONE = [
  {
    href: '/cpa',
    title: 'CPA指標ダッシュボード',
    desc: 'コスト・コール数・案件化率・案件CPA・面接CPA・ROAS を月次で表示。CSVから実績データをインポート。',
  },
  {
    href: '/customers',
    title: '顧客マスタ管理',
    desc: '会社名・業種・地域などの顧客データをCSV取込で蓄積。FAX番号で重複排除、ブラックリスト管理、検索・フィルタに対応。',
  },
  {
    href: '/lists',
    title: 'リスト抽出',
    desc: '顧客マスタから業種・地域・件数で絞り込み、送信回数の少ない順に自動抽出してExcel出力。送信回数・最終送信日時を自動更新。',
  },
  {
    href: '/manuscripts',
    title: '原稿管理',
    desc: '日付ごとに23スロットの原稿フォルダを管理。1クリックで23個のスロットを一括作成。各スロットにDriveフォルダURL/タイトル/メモを記録。',
  },
  {
    href: '/reports',
    title: '受電報告',
    desc: 'FAX送信に対する受電(問合せ/発注/拒否等)をバッチ単位で一括入力。キーボードショートカット対応。反応・拒否を顧客マスタに自動反映。',
  },
  {
    href: '/fax-stats',
    title: 'FAX送信実績',
    desc: 'FAX機のスプレッドシートログをGoogle Sheets APIで同期。日別の折れ線チャート、PC別の成功率/エラー率、明細をひとつの画面で確認。',
  },
];

const PENDING = [
  { title: 'Drive連携', desc: 'リスト抽出結果・原稿フォルダをGoogle Drive APIで自動同期' },
  { title: 'マルチチャネル(将来構想)', desc: 'メール/AIオートコール/SNS DMをMCP連携。1リードに対し自動アプローチ、反応あれば営業に通知' },
];

export default function HomePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-zinc-900">FAX-CRM</h1>
      <p className="text-zinc-500 mt-1">FAX リードCRMシステム</p>

      <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mt-8 mb-3">実装済み</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {DONE.map((d) => (
          <Link key={d.href} href={d.href}
                className="block p-5 bg-white border border-zinc-200 rounded-lg hover:border-indigo-300 hover:shadow-sm transition">
            <div className="text-xs text-indigo-600 font-medium">実装済み</div>
            <div className="text-lg font-semibold text-zinc-900 mt-1">{d.title}</div>
            <div className="text-sm text-zinc-500 mt-2">{d.desc}</div>
          </Link>
        ))}
      </div>

      <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mt-8 mb-3">これから実装</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PENDING.map((p) => (
          <div key={p.title} className="block p-5 bg-zinc-50 border border-zinc-200 rounded-lg">
            <div className="text-xs text-zinc-500 font-medium">未着手</div>
            <div className="text-lg font-semibold text-zinc-700 mt-1">{p.title}</div>
            <div className="text-sm text-zinc-500 mt-2">{p.desc}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 p-5 bg-white border border-zinc-200 rounded-lg">
        <h2 className="font-semibold text-zinc-800 mb-2 text-sm">セットアップ</h2>
        <ol className="list-decimal pl-5 text-sm text-zinc-600 space-y-1">
          <li><code>backend/.env</code> を作成し MySQL 情報を設定</li>
          <li><code>npm --prefix backend run migrate</code> でテーブル作成</li>
          <li><code>npm --prefix backend run dev</code> で API 起動 (4001)</li>
          <li><code>npm --prefix frontend run dev</code> で UI 起動 (3001)</li>
          <li>DB未設定でも <code>?demo=1</code> でサンプルデータ表示可能</li>
        </ol>
      </div>
    </div>
  );
}

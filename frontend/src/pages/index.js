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
    href: '/scripts',
    title: '原稿管理',
    desc: 'PDF原稿を登録 + 登録番号/国籍/性別/業種カテゴリを記録。 送信日/PC/受電結果別件数で使用履歴を管理。',
  },
  {
    href: '/manuscripts',
    title: 'ドライブ格納',
    desc: '日付ごとに23スロットの Drive フォルダを管理 (旧「原稿管理」)。 1クリックで23個のスロットを一括作成、 Drive URL/タイトル/メモを記録。',
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
    <div className="max-w-6xl">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-700 px-8 py-7 shadow-sm">
        <div className="absolute -right-10 -top-10 w-48 h-48 bg-emerald-400/20 rounded-full blur-3xl" />
        <div className="absolute -left-10 -bottom-16 w-56 h-56 bg-teal-300/20 rounded-full blur-3xl" />
        <div className="relative">
          <div className="text-[11px] font-medium text-emerald-100 tracking-widest uppercase">Hitokiwa</div>
          <h1 className="text-2xl font-bold text-white mt-1">FAX CRM System</h1>
          <p className="text-emerald-50/80 text-sm mt-2">FAX 配信から 受電 / 案件化 / 売上 までを 1 つの動線で。</p>
        </div>
      </div>

      <h2 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mt-8 mb-3 flex items-center gap-2">
        <span className="w-1 h-3 bg-emerald-500 rounded-sm" />
        実装済み
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {DONE.map((d) => (
          <Link key={d.href} href={d.href}
                className="group block p-5 bg-white border border-zinc-200 rounded-lg hover:border-emerald-400 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150">
            <div className="flex items-center gap-2 text-[10px] text-emerald-700 font-semibold tracking-wider uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Active
            </div>
            <div className="text-base font-semibold text-zinc-900 mt-1.5 group-hover:text-emerald-800 transition-colors">{d.title}</div>
            <div className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{d.desc}</div>
          </Link>
        ))}
      </div>

      <h2 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mt-8 mb-3 flex items-center gap-2">
        <span className="w-1 h-3 bg-zinc-400 rounded-sm" />
        これから実装
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PENDING.map((p) => (
          <div key={p.title} className="block p-5 bg-zinc-50/60 border border-dashed border-zinc-300 rounded-lg">
            <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-semibold tracking-wider uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
              Planned
            </div>
            <div className="text-base font-semibold text-zinc-700 mt-1.5">{p.title}</div>
            <div className="text-xs text-zinc-500 mt-1.5 leading-relaxed">{p.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

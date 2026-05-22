import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const DEMO_DATES = [
  { folder_date: '2026-05-14', slot_count: 23, filled_count: 23, drive_count: 23, created_at: '2026-05-14T08:00:00Z' },
  { folder_date: '2026-05-01', slot_count: 23, filled_count: 18, drive_count: 14, created_at: '2026-05-01T07:30:00Z' },
  { folder_date: '2026-04-15', slot_count: 23, filled_count: 23, drive_count: 23, created_at: '2026-04-15T07:00:00Z' },
  { folder_date: '2026-04-01', slot_count: 23, filled_count: 10, drive_count: 6,  created_at: '2026-04-01T07:00:00Z' },
];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ManuscriptsIndex() {
  const router = useRouter();
  const isDemo = router.query.demo === '1';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [newDate, setNewDate] = useState(todayIso());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) { setLoading(false); setItems(DEMO_DATES); return; }
      setLoading(true);
      try {
        const { data } = await api.get('/api/manuscripts');
        if (!cancelled) setItems(data.data || []);
      } catch (e) {
        if (!cancelled) { toast.error(e.userMessage || '読み込み失敗'); setItems([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo, reloadKey]);

  const createDate = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      toast.error('日付を選択してください'); return;
    }
    if (isDemo) {
      toast('デモ表示中は実DBには書き込みません', { icon: 'ℹ' });
      router.push(`/manuscripts/${newDate}?demo=1`);
      return;
    }
    setCreating(true);
    try {
      const { data } = await api.post(`/api/manuscripts/${newDate}`);
      toast.success(`${newDate} に ${data.data.createdSlots} スロット作成`);
      router.push(`/manuscripts/${newDate}`);
    } catch (e) {
      toast.error(e.userMessage || '日付登録失敗');
    } finally {
      setCreating(false);
    }
  };

  // 年月でグループ化
  const grouped = items.reduce((acc, x) => {
    const ym = String(x.folder_date).slice(0, 7);
    (acc[ym] ||= []).push(x);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">ドライブ格納</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            日付ごとに23スロットの Drive フォルダを管理 (旧「原稿管理」 / Drive の 2026/0501/{'{'}1..23{'}'} に対応)
            {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
          </p>
        </div>
        <button onClick={() => setReloadKey((k) => k + 1)}
                className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50">
          再読み込み
        </button>
      </div>

      {/* 新規日付登録 */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-6">
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">新規日付登録</label>
            <input type="date" className="border border-zinc-300 rounded-md px-3 py-2 text-sm"
                   value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          </div>
          <button onClick={createDate} disabled={creating}
                  className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">
            {creating ? '作成中…' : `${newDate} に 23スロット作成`}
          </button>
          <span className="text-xs text-zinc-500 ml-2">既存スロットはそのまま、不足分のみ追加</span>
        </div>
      </div>

      {/* 日付グループ */}
      {loading && <div className="text-zinc-400 py-12 text-center">読み込み中…</div>}
      {!loading && items.length === 0 && (
        <div className="bg-white border border-zinc-200 rounded-lg py-16 text-center text-zinc-400">
          まだ登録された日付がありません。上の「日付登録」から作成してください。
        </div>
      )}

      {!loading && Object.entries(grouped).map(([ym, dates]) => (
        <section key={ym} className="mb-6">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            {ym.replace('-', '年')}月
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {dates.map((d) => {
              const filled = Number(d.filled_count);
              const drive = Number(d.drive_count);
              const slot = Number(d.slot_count);
              const completed = filled === slot && drive === slot;
              return (
                <Link key={d.folder_date}
                      href={`/manuscripts/${d.folder_date}${isDemo ? '?demo=1' : ''}`}
                      className="block bg-white border border-zinc-200 rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition">
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-semibold text-zinc-900">
                      {d.folder_date}
                    </div>
                    {completed ? (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-emerald-100 text-emerald-700">完了</span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-700">未完了</span>
                    )}
                  </div>
                  <div className="mt-3 text-xs text-zinc-500 space-y-1">
                    <div>タイトル設定済: <span className="tabular-nums text-zinc-800 font-medium">{filled} / {slot}</span></div>
                    <div>Drive URL設定: <span className="tabular-nums text-zinc-800 font-medium">{drive} / {slot}</span></div>
                  </div>
                  {/* 進捗バー */}
                  <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 transition-all"
                         style={{ width: `${(filled / slot) * 100}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

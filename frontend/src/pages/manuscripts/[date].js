import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';
import ManuscriptSlotModal from '@/components/ManuscriptSlotModal';
import SlotUsageModal from '@/components/SlotUsageModal';

function buildDemoSlots(date) {
  const sample = [
    { slot: 1, title: '製造業-AB案', drive_folder_url: 'https://drive.google.com/drive/folders/demo1',
      usage_count: 420, distinct_pcs: 'PC01,PC02,PC03', distinct_industries: '製造業', distinct_prefectures: '東京都,神奈川県' },
    { slot: 2, title: '製造業-C案', drive_folder_url: 'https://drive.google.com/drive/folders/demo2',
      usage_count: 180, distinct_pcs: 'PC02', distinct_industries: '製造業', distinct_prefectures: '愛知県' },
    { slot: 3, title: '建設業-A案', drive_folder_url: 'https://drive.google.com/drive/folders/demo3',
      usage_count: 95, distinct_pcs: 'PC04,PC05', distinct_industries: '建設業', distinct_prefectures: '北海道,東北6県' },
    { slot: 4, title: '情報通信-AI案', drive_folder_url: 'https://drive.google.com/drive/folders/demo4',
      usage_count: 240, distinct_pcs: 'PC01,PC03', distinct_industries: '情報通信', distinct_prefectures: '東京都' },
    { slot: 5, title: '卸売-季節案', drive_folder_url: '',
      usage_count: 60, distinct_pcs: 'PC01', distinct_industries: '卸売業', distinct_prefectures: '大阪府' },
    { slot: 6, title: '食料品-キャンペーン', drive_folder_url: 'https://drive.google.com/drive/folders/demo6',
      usage_count: 0, distinct_pcs: null, distinct_industries: null, distinct_prefectures: null },
  ];
  return Array.from({ length: 23 }, (_, i) => {
    const slotNumber = i + 1;
    const known = sample.find((s) => s.slot === slotNumber);
    return {
      id: i + 1000,
      folder_date: date,
      slot_number: slotNumber,
      title: known?.title || null,
      drive_folder_url: known?.drive_folder_url || null,
      drive_folder_id: null,
      thumbnail_url: null,
      memo: null,
      usage_count:        known?.usage_count        ?? 0,
      distinct_pcs:       known?.distinct_pcs       ?? null,
      distinct_industries: known?.distinct_industries ?? null,
      distinct_prefectures: known?.distinct_prefectures ?? null,
    };
  });
}

export default function ManuscriptDatePage() {
  const router = useRouter();
  const { date } = router.query;
  const isDemo = router.query.demo === '1';
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(null);
  const [usageSlot, setUsageSlot] = useState(null);

  useEffect(() => {
    if (!router.isReady || !date) return;
    let cancelled = false;
    (async () => {
      if (isDemo) {
        setLoading(false);
        setSlots(buildDemoSlots(String(date)));
        return;
      }
      setLoading(true);
      try {
        const { data } = await api.get(`/api/manuscripts/${date}`);
        if (!cancelled) setSlots(data.data || []);
      } catch (e) {
        if (!cancelled) { toast.error(e.userMessage || '読み込み失敗'); setSlots([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router.isReady, date, isDemo, reloadKey]);

  const handleSlotSaved = (updated) => {
    setSlots((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setEditing(null);
  };

  const deleteDate = async () => {
    if (isDemo) { toast('デモ表示中は削除できません', { icon: 'ℹ' }); return; }
    if (!confirm(`${date} の23スロットを全削除します。よろしいですか?`)) return;
    try {
      await api.delete(`/api/manuscripts/${date}`);
      toast.success('削除しました');
      router.push('/manuscripts');
    } catch (e) {
      toast.error(e.userMessage || '削除失敗');
    }
  };

  const ensureDrive = async () => {
    if (isDemo) { toast('デモ表示中はDrive作成できません', { icon: 'ℹ' }); return; }
    if (!confirm(`Drive上に ${date}/1〜23 のフォルダを作成します。既存スロットは保持されます。`)) return;
    try {
      const { data } = await api.post(`/api/manuscripts/${date}/ensure-drive`);
      const r = data.data;
      toast.success(`Drive作成: 新規 ${r.slotsCreated} / スキップ ${r.slotsSkipped}`);
      if (r.dateFolder?.webViewLink) window.open(r.dateFolder.webViewLink, '_blank');
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e.userMessage || 'Drive作成失敗');
    }
  };

  const filledCount = slots.filter((s) => s.title && s.title.trim()).length;
  const driveCount = slots.filter((s) => s.drive_folder_url && s.drive_folder_url.trim()).length;

  return (
    <div>
      <Link href={`/manuscripts${isDemo ? '?demo=1' : ''}`}
            className="text-sm text-indigo-700 hover:underline">← 原稿一覧へ</Link>

      <div className="mt-3 flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{date}</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            23スロット / タイトル設定 <span className="font-medium text-zinc-700">{filledCount}/23</span>
            <span className="mx-2">·</span>
            Drive URL設定 <span className="font-medium text-zinc-700">{driveCount}/23</span>
            {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setReloadKey((k) => k + 1)}
                  className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50">
            再読み込み
          </button>
          <button onClick={ensureDrive}
                  className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
            Drive 23フォルダ作成
          </button>
          <button onClick={deleteDate}
                  className="px-3 py-2 text-sm bg-white border border-red-200 text-red-700 rounded-md hover:bg-red-50">
            日付ごと削除
          </button>
        </div>
      </div>

      {loading && <div className="text-zinc-400 py-12 text-center">読み込み中…</div>}

      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {slots.map((s) => {
            const hasTitle = s.title && s.title.trim();
            const hasDrive = s.drive_folder_url && s.drive_folder_url.trim();
            const usageCount = Number(s.usage_count || 0);
            const pcs = (s.distinct_pcs || '').split(',').filter(Boolean);
            const industries = (s.distinct_industries || '').split(',').filter(Boolean);
            const prefectures = (s.distinct_prefectures || '').split(',').filter(Boolean);
            return (
              <div
                key={s.id}
                className={[
                  'rounded-lg border p-3 transition flex flex-col',
                  hasTitle
                    ? 'bg-white border-zinc-200 hover:border-indigo-300 hover:shadow-sm'
                    : 'bg-zinc-50 border-dashed border-zinc-300 hover:bg-white hover:border-zinc-400',
                ].join(' ')}
              >
                <button type="button" onClick={() => setEditing(s)} className="text-left flex-1">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">
                      {s.slot_number}
                    </span>
                    <div className="flex gap-1">
                      {hasDrive && (
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">Drive</span>
                      )}
                    </div>
                  </div>
                  <div className={`mt-2 text-sm font-medium ${hasTitle ? 'text-zinc-900' : 'text-zinc-400'}`}>
                    {hasTitle ? s.title : '(未設定)'}
                  </div>
                  {s.memo && (
                    <div className="mt-1 text-[11px] text-zinc-500 line-clamp-2">{s.memo}</div>
                  )}
                </button>

                {/* 使用履歴サマリ */}
                <div className="mt-2 pt-2 border-t border-zinc-100">
                  {usageCount > 0 ? (
                    <>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-500">
                          使用 <span className="font-bold text-zinc-800 tabular-nums">{usageCount.toLocaleString()}</span> 件
                        </span>
                        <button type="button" onClick={() => setUsageSlot(s)}
                                className="text-indigo-700 hover:underline">履歴 →</button>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {pcs.map((pc) => (
                          <span key={pc} className="px-1.5 py-0.5 text-[10px] bg-indigo-50 text-indigo-700 rounded font-mono">{pc}</span>
                        ))}
                      </div>
                      {(industries.length > 0 || prefectures.length > 0) && (
                        <div className="mt-1 text-[10px] text-zinc-500 truncate">
                          {industries.length > 0 && <span>{industries.slice(0, 2).join('・')}{industries.length > 2 ? '…' : ''}</span>}
                          {industries.length > 0 && prefectures.length > 0 && <span> / </span>}
                          {prefectures.length > 0 && <span>{prefectures.slice(0, 2).join('・')}{prefectures.length > 2 ? '…' : ''}</span>}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-[11px] text-zinc-400">未使用</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ManuscriptSlotModal
          slot={editing}
          isDemo={isDemo}
          onClose={() => setEditing(null)}
          onSaved={handleSlotSaved}
        />
      )}

      {usageSlot && (
        <SlotUsageModal
          slot={usageSlot}
          isDemo={isDemo}
          onClose={() => setUsageSlot(null)}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const DEMO_BATCHES = [
  { id: 7, name: '関東-製造業-PC03', filter_industry: '製造業', filter_prefecture: '東京都', target_count: 200, actual_count: 200, pc_number: 'PC03', status: 'ready', drive_file_url: null, created_at: '2026-05-12T09:00:00Z' },
  { id: 6, name: '関西-卸売-100件', filter_industry: '卸売業', filter_prefecture: '大阪府', target_count: 100, actual_count: 100, pc_number: 'PC01', status: 'sent', drive_file_url: null, created_at: '2026-05-08T14:30:00Z' },
  { id: 5, name: '東海-情報通信-50件', filter_industry: '情報通信', filter_prefecture: '愛知県', target_count: 50, actual_count: 47, pc_number: 'PC02', status: 'ready', drive_file_url: null, created_at: '2026-05-05T11:00:00Z' },
];

const STATUS_LABEL = {
  draft: { label: '下書き', cls: 'bg-zinc-100 text-zinc-700' },
  ready: { label: '送信待ち', cls: 'bg-indigo-100 text-indigo-700' },
  sent:  { label: '送信済', cls: 'bg-emerald-100 text-emerald-700' },
  failed:{ label: '失敗',   cls: 'bg-red-100 text-red-700' },
};

export default function ListsPage() {
  const router = useRouter();
  const isDemo = router.query.demo === '1';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) { setLoading(false); setItems(DEMO_BATCHES); return; }
      setLoading(true);
      try {
        const { data } = await api.get('/api/batches');
        if (!cancelled) setItems(data.data || []);
      } catch (e) {
        if (!cancelled) { toast.error(e.userMessage || '読み込み失敗'); setItems([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo, reloadKey]);

  const downloadExcel = (batchId) => {
    if (isDemo) { toast('デモ表示中は実Excelダウンロードできません', { icon: 'ℹ' }); return; }
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4001';
    window.open(`${base}/api/batches/${batchId}/excel`, '_blank');
  };

  const uploadToDrive = async (batchId) => {
    if (isDemo) { toast('デモ表示中はDrive保存できません', { icon: 'ℹ' }); return; }
    try {
      const { data } = await api.post(`/api/batches/${batchId}/upload-to-drive`);
      toast.success('Driveに保存しました');
      if (data.data?.driveFile?.webViewLink) {
        window.open(data.data.driveFile.webViewLink, '_blank');
      }
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error(e.userMessage || 'Drive保存失敗');
    }
  };

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">リスト抽出</h1>
          <p className="text-zinc-500 mt-1 text-sm">
            業種・地域・件数で顧客を絞り込み、Excel化して配信に使うリストを作成
            {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setReloadKey((k) => k + 1)}
                  className="px-3 py-2 text-sm bg-white border border-zinc-300 rounded-md hover:bg-zinc-50">
            再読み込み
          </button>
          <Link href={`/lists/new${isDemo ? '?demo=1' : ''}`}
                className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700">
            + 新規抽出
          </Link>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">バッチ名</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">業種</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">都道府県</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">指定/実件数</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">PC</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">状態</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">作成日</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-zinc-600 uppercase">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-zinc-400">読み込み中…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-zinc-400">
                  抽出バッチがありません。「+ 新規抽出」から作成してください。
                </td></tr>
              )}
              {!loading && items.map((b) => {
                const s = STATUS_LABEL[b.status] || { label: b.status, cls: 'bg-zinc-100 text-zinc-700' };
                return (
                  <tr key={b.id} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                    <td className="px-4 py-2.5 font-medium text-zinc-900">{b.name}</td>
                    <td className="px-4 py-2.5 text-zinc-700">{b.filter_industry || '—'}</td>
                    <td className="px-4 py-2.5 text-zinc-700">{b.filter_prefecture || '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {b.target_count.toLocaleString()} / <span className="font-semibold">{b.actual_count.toLocaleString()}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{b.pc_number || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 text-xs rounded-full ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 text-xs">
                      {new Date(b.created_at).toLocaleDateString('ja-JP')}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex gap-1 justify-end flex-wrap">
                        <button
                          className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700"
                          onClick={() => downloadExcel(b.id)}
                        >
                          Excel ↓
                        </button>
                        {b.drive_file_url ? (
                          <a href={b.drive_file_url} target="_blank" rel="noreferrer"
                             className="px-2 py-1 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200">
                            Drive ↗
                          </a>
                        ) : (
                          <button
                            className="px-2 py-1 text-xs bg-white border border-zinc-300 text-zinc-700 rounded hover:bg-zinc-50"
                            onClick={() => uploadToDrive(b.id)}
                          >
                            Drive保存
                          </button>
                        )}
                        <Link
                          href={`/reports/batch?id=${b.id}${isDemo ? '&demo=1' : ''}`}
                          className="px-2 py-1 text-xs bg-white border border-zinc-300 text-zinc-700 rounded hover:bg-zinc-50"
                        >
                          受電報告
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

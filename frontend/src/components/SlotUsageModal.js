import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const RESULT_LABEL = {
  no_response:      { label: '受電なし', cls: 'bg-zinc-100 text-zinc-700' },
  response_inquiry: { label: '問合せ',   cls: 'bg-amber-100 text-amber-800' },
  response_order:   { label: '発注',     cls: 'bg-emerald-100 text-emerald-800' },
  refusal:          { label: '拒否',     cls: 'bg-red-100 text-red-700' },
  invalid_number:   { label: '番号無効', cls: 'bg-zinc-100 text-zinc-500' },
  other:            { label: 'その他',   cls: 'bg-zinc-100 text-zinc-700' },
};

function buildDemo(slot) {
  const pcs = (slot.distinct_pcs || '').split(',').filter(Boolean);
  const industries = (slot.distinct_industries || '').split(',').filter(Boolean);
  const prefectures = (slot.distinct_prefectures || '').split(',').filter(Boolean);
  if (!pcs.length) return { byPc: [], byBatch: [], details: [] };

  const totalSent = Number(slot.usage_count || 0);
  const perPc = Math.max(Math.round(totalSent / pcs.length), 1);

  const byPc = pcs.map((pc, i) => ({
    pc_number: pc,
    count: i === pcs.length - 1 ? totalSent - perPc * (pcs.length - 1) : perPc,
    industries: industries.join(','),
    prefectures: prefectures.join(','),
    response_count: Math.max(Math.round(perPc * 0.04), 0),
  }));

  const byBatch = pcs.flatMap((pc, i) =>
    industries.slice(0, 2).map((ind, j) => ({
      batch_id: 100 + i * 10 + j,
      batch_name: `${ind}-${prefectures[0] || '関東'}-${pc}`,
      filter_industry: ind,
      filter_prefecture: prefectures[j % prefectures.length] || prefectures[0] || '東京都',
      pc_number: pc,
      sent_count: Math.max(Math.round(perPc / Math.max(industries.length, 1)), 1),
      response_count: 1,
      first_send: '2026-05-08',
      last_send: '2026-05-14',
    }))
  ).slice(0, 6);

  const details = [];
  const today = new Date('2026-05-14');
  for (let i = 0; i < Math.min(totalSent, 20); i++) {
    const pc = pcs[i % pcs.length];
    const ind = industries[i % Math.max(industries.length, 1)] || '製造業';
    const pref = prefectures[i % Math.max(prefectures.length, 1)] || '東京都';
    const d = new Date(today); d.setDate(d.getDate() - (i % 7));
    const resultKeys = ['no_response', 'no_response', 'no_response', 'response_inquiry', 'response_order', 'refusal'];
    details.push({
      id: 9000 + i,
      send_date: d.toISOString().slice(0, 10),
      pc_number: pc,
      result: resultKeys[i % resultKeys.length],
      responded_at: null,
      batch_id: 100,
      batch_name: `${ind}-${pref}-${pc}`,
      filter_industry: ind,
      filter_prefecture: pref,
      company_name: `デモ会社${String.fromCharCode(65 + (i % 26))}${i + 1}`,
      fax_number: `0${(3 + i % 7)}-${(1000 + i).toString().padStart(4, '0')}-${(5000 + i).toString().padStart(4, '0')}`,
    });
  }
  return { byPc, byBatch, details };
}

export default function SlotUsageModal({ slot, isDemo, onClose }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('byPc');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isDemo) {
        setLoading(false);
        setData(buildDemo(slot));
        return;
      }
      setLoading(true);
      try {
        const { data: r } = await api.get(`/api/manuscripts/slots/${slot.id}/usage`);
        if (cancelled) return;
        setData(r.data);
      } catch (e) {
        if (!cancelled) { toast.error(e.userMessage || '読み込み失敗'); setData(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slot, isDemo]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              {slot.folder_date} / スロット {slot.slot_number} の使用履歴
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {slot.title || '(タイトル未設定)'}
            </p>
          </div>
          <button className="text-zinc-400 hover:text-zinc-600 text-xl" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 border-b border-zinc-200 flex gap-4 text-sm">
          {[
            { key: 'byPc',    label: 'PC別' },
            { key: 'byBatch', label: 'バッチ別' },
            { key: 'details', label: '明細' },
          ].map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
                    className={[
                      'pb-2 -mb-px border-b-2 transition',
                      tab === t.key
                        ? 'border-indigo-600 text-indigo-700 font-medium'
                        : 'border-transparent text-zinc-500 hover:text-zinc-700',
                    ].join(' ')}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && <div className="text-center text-zinc-400 py-12">読み込み中…</div>}
          {!loading && !data && <div className="text-center text-zinc-400 py-12">データなし</div>}
          {!loading && data && tab === 'byPc' && <ByPcTable rows={data.byPc} />}
          {!loading && data && tab === 'byBatch' && <ByBatchTable rows={data.byBatch} />}
          {!loading && data && tab === 'details' && <DetailsTable rows={data.details} />}
        </div>
      </div>
    </div>
  );
}

function ByPcTable({ rows }) {
  if (!rows?.length) return <div className="text-center text-zinc-400 py-12">使用履歴がありません</div>;
  return (
    <table className="w-full text-sm">
      <thead className="bg-zinc-50 border-b border-zinc-200 text-xs text-zinc-600 uppercase">
        <tr>
          <th className="text-left px-3 py-2">PC</th>
          <th className="text-right px-3 py-2">送信件数</th>
          <th className="text-right px-3 py-2">反応</th>
          <th className="text-left px-3 py-2">業種</th>
          <th className="text-left px-3 py-2">地域</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.pc_number} className="border-b border-zinc-100">
            <td className="px-3 py-2 font-mono">{r.pc_number}</td>
            <td className="px-3 py-2 text-right tabular-nums font-semibold">{Number(r.count).toLocaleString()}</td>
            <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{Number(r.response_count || 0).toLocaleString()}</td>
            <td className="px-3 py-2 text-xs text-zinc-700">{r.industries || '—'}</td>
            <td className="px-3 py-2 text-xs text-zinc-700">{r.prefectures || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ByBatchTable({ rows }) {
  if (!rows?.length) return <div className="text-center text-zinc-400 py-12">使用履歴がありません</div>;
  return (
    <table className="w-full text-sm">
      <thead className="bg-zinc-50 border-b border-zinc-200 text-xs text-zinc-600 uppercase">
        <tr>
          <th className="text-left px-3 py-2">バッチ</th>
          <th className="text-left px-3 py-2">業種</th>
          <th className="text-left px-3 py-2">地域</th>
          <th className="text-left px-3 py-2">PC</th>
          <th className="text-right px-3 py-2">送信</th>
          <th className="text-right px-3 py-2">反応</th>
          <th className="text-left px-3 py-2">期間</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.batch_id || `${r.pc_number}-${r.filter_industry}`} className="border-b border-zinc-100">
            <td className="px-3 py-2">{r.batch_name || '—'}</td>
            <td className="px-3 py-2 text-xs">{r.filter_industry || '—'}</td>
            <td className="px-3 py-2 text-xs">{r.filter_prefecture || '—'}</td>
            <td className="px-3 py-2 font-mono text-xs">{r.pc_number || '—'}</td>
            <td className="px-3 py-2 text-right tabular-nums">{Number(r.sent_count).toLocaleString()}</td>
            <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{Number(r.response_count || 0).toLocaleString()}</td>
            <td className="px-3 py-2 text-xs text-zinc-500">{r.first_send} 〜 {r.last_send}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailsTable({ rows }) {
  if (!rows?.length) return <div className="text-center text-zinc-400 py-12">明細がありません</div>;
  return (
    <table className="w-full text-sm">
      <thead className="bg-zinc-50 border-b border-zinc-200 text-xs text-zinc-600 uppercase">
        <tr>
          <th className="text-left px-3 py-2">送信日</th>
          <th className="text-left px-3 py-2">PC</th>
          <th className="text-left px-3 py-2">会社名</th>
          <th className="text-left px-3 py-2">業種</th>
          <th className="text-left px-3 py-2">地域</th>
          <th className="text-left px-3 py-2">結果</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const meta = RESULT_LABEL[r.result] || RESULT_LABEL.other;
          return (
            <tr key={r.id} className="border-b border-zinc-100">
              <td className="px-3 py-2 text-xs">{r.send_date}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.pc_number}</td>
              <td className="px-3 py-2">{r.company_name || '—'}</td>
              <td className="px-3 py-2 text-xs">{r.filter_industry || '—'}</td>
              <td className="px-3 py-2 text-xs">{r.filter_prefecture || '—'}</td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 text-xs rounded-full ${meta.cls}`}>{meta.label}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

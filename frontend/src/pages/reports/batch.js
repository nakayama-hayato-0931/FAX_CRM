import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const RESULTS = [
  { key: 'no_response',      label: '受電なし',          short: '受電なし', shortcut: '1', cls: 'bg-zinc-100 text-zinc-700' },
  { key: 'response_inquiry', label: '反応あり (問合せ)', short: '問合せ',   shortcut: '2', cls: 'bg-amber-100 text-amber-800' },
  { key: 'response_order',   label: '反応あり (発注)',   short: '発注',     shortcut: '3', cls: 'bg-emerald-100 text-emerald-800' },
  { key: 'refusal',          label: '拒否(送るな)',    short: '拒否',     shortcut: '4', cls: 'bg-red-100 text-red-700' },
  { key: 'invalid_number',   label: '番号無効',          short: '番号無効', shortcut: '5', cls: 'bg-zinc-100 text-zinc-500' },
  { key: 'other',            label: 'その他',            short: 'その他',   shortcut: '6', cls: 'bg-zinc-100 text-zinc-700' },
];

function buildDemo() {
  const batch = {
    id: 7,
    name: '関東-製造業-PC03',
    filter_industry: '製造業',
    filter_prefecture: '東京都',
    pc_number: 'PC03',
    actual_count: 5,
    status: 'ready',
    created_at: '2026-05-12T09:00:00Z',
  };
  const rows = [
    { row_index: 1, customer_id: 1, company_name: '株式会社サンプル製作所',  fax_number: '0312345678', industry: '製造業', prefecture: '東京都', is_blacklisted: 0, report_id: null, result: 'no_response' },
    { row_index: 2, customer_id: 2, company_name: '合同会社テスト商事',     fax_number: '0623456789', industry: '製造業', prefecture: '東京都', is_blacklisted: 0, report_id: 902, result: 'response_inquiry', result_detail: 'デモ問合せ' },
    { row_index: 3, customer_id: 5, company_name: '株式会社モック食品',     fax_number: '0925678901', industry: '製造業', prefecture: '東京都', is_blacklisted: 0, report_id: null, result: 'no_response' },
    { row_index: 4, customer_id: 8, company_name: '株式会社ダミー精機',     fax_number: '0445678901', industry: '製造業', prefecture: '東京都', is_blacklisted: 0, report_id: null, result: 'no_response' },
    { row_index: 5, customer_id: 9, company_name: '株式会社サンプル工業',   fax_number: '0335789012', industry: '製造業', prefecture: '東京都', is_blacklisted: 0, report_id: null, result: 'no_response' },
  ];
  return { batch, rows };
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function BatchInputPage() {
  const router = useRouter();
  const batchId = router.query.id;
  const isDemo = router.query.demo === '1';

  const [batch, setBatch] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [sendDate, setSendDate] = useState(todayIso());
  const [pcNumber, setPcNumber] = useState('');
  const [manuscriptDate, setManuscriptDate] = useState('');
  const [manuscriptSlot, setManuscriptSlot] = useState('');

  const detailRefs = useRef([]);

  useEffect(() => {
    if (!router.isReady || !batchId) return;
    let cancelled = false;
    (async () => {
      if (isDemo) {
        const { batch, rows } = buildDemo();
        setBatch(batch);
        setItems(rows.map((r) => ({ ...r, result: r.result || 'no_response', result_detail: r.result_detail || '' })));
        setPcNumber(batch.pc_number || '');
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const { data } = await api.get(`/api/incoming-calls/by-batch/${batchId}`);
        if (cancelled) return;
        setBatch(data.data.batch);
        setItems((data.data.rows || []).map((r) => ({
          ...r,
          result: r.result || 'no_response',
          result_detail: r.result_detail || '',
        })));
        if (data.data.batch?.pc_number) setPcNumber(data.data.batch.pc_number);
      } catch (e) {
        if (!cancelled) { toast.error(e.userMessage || '読み込み失敗'); setItems([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router.isReady, batchId, isDemo]);

  // キーボードショートカット
  useEffect(() => {
    const handler = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (activeIdx < 0 || activeIdx >= items.length) return;

      const found = RESULTS.find((r) => r.shortcut === e.key);
      if (found) {
        e.preventDefault();
        applyResult(activeIdx, found.key);
        setActiveIdx((i) => Math.min(i + 1, items.length - 1));
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeIdx, items.length]);

  const applyResult = (idx, key) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, result: key } : it)));
  };
  const updateDetail = (idx, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, result_detail: value } : it)));
  };
  const bulkSetAll = (key) => {
    setItems((prev) => prev.map((it) => ({ ...it, result: key })));
    toast.success(`全件を「${RESULTS.find((r) => r.key === key)?.short}」に変更`);
  };

  const summary = useMemo(() => {
    const counts = { no_response: 0, response_inquiry: 0, response_order: 0, refusal: 0, invalid_number: 0, other: 0 };
    for (const it of items) counts[it.result] = (counts[it.result] || 0) + 1;
    return counts;
  }, [items]);

  const save = async () => {
    if (!sendDate || !pcNumber) { toast.error('送信日とPC番号は必須です'); return; }
    if (isDemo) { toast('デモ表示中は保存されません', { icon: 'ℹ' }); return; }
    setSaving(true);
    try {
      const payload = {
        batchId: Number(batchId),
        sendDate, pcNumber,
        manuscriptDate: manuscriptDate || null,
        manuscriptSlot: manuscriptSlot ? Number(manuscriptSlot) : null,
        items: items.map((it) => ({
          customerId: it.customer_id,
          result: it.result,
          result_detail: it.result_detail || null,
        })),
      };
      const { data } = await api.post('/api/incoming-calls/bulk-save', payload);
      toast.success(`保存しました: ${data.data.saved} 件`);
    } catch (e) {
      toast.error(e.userMessage || '保存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-zinc-400 py-12 text-center">読み込み中…</div>;
  if (!batch) return (
    <div>
      <Link href={`/reports${isDemo ? '?demo=1' : ''}`} className="text-sm text-indigo-700 hover:underline">← 受電報告一覧へ</Link>
      <div className="text-zinc-400 py-12 text-center">バッチが見つかりません</div>
    </div>
  );

  return (
    <div>
      <Link href={`/reports${isDemo ? '?demo=1' : ''}`} className="text-sm text-indigo-700 hover:underline">← 受電報告一覧へ</Link>

      <div className="mt-3 mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">受電報告 - {batch.name}</h1>
        <p className="text-zinc-500 mt-1 text-sm">
          抽出 {batch.actual_count} 件
          {isDemo && <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">デモ表示</span>}
        </p>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="送信日">
          <input type="date" className="rep-input" value={sendDate} onChange={(e) => setSendDate(e.target.value)} />
        </Field>
        <Field label="PC番号">
          <input type="text" className="rep-input" value={pcNumber} onChange={(e) => setPcNumber(e.target.value)} placeholder="PC03" />
        </Field>
        <Field label="原稿フォルダ日付">
          <input type="date" className="rep-input" value={manuscriptDate} onChange={(e) => setManuscriptDate(e.target.value)} />
        </Field>
        <Field label="原稿スロット (1-23)">
          <input type="number" min="1" max="23" className="rep-input" value={manuscriptSlot} onChange={(e) => setManuscriptSlot(e.target.value)} />
        </Field>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {RESULTS.map((r) => (
              <span key={r.key} className={`px-2 py-1 rounded ${r.cls}`}>
                {r.short}: <span className="font-bold tabular-nums">{summary[r.key] || 0}</span>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">一括:</span>
            <button onClick={() => bulkSetAll('no_response')}
                    className="px-2 py-1 bg-zinc-100 text-zinc-700 rounded hover:bg-zinc-200">全件 受電なし</button>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-zinc-500">
          キーボード: <kbd className="rep-kbd">1</kbd>受電なし · <kbd className="rep-kbd">2</kbd>問合せ · <kbd className="rep-kbd">3</kbd>発注 · <kbd className="rep-kbd">4</kbd>拒否 · <kbd className="rep-kbd">5</kbd>番号無効 · <kbd className="rep-kbd">6</kbd>その他 · <kbd className="rep-kbd">↑</kbd>/<kbd className="rep-kbd">↓</kbd> 行移動
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="w-12 text-center px-2 py-2.5 text-xs font-medium text-zinc-600 uppercase">#</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-600 uppercase">会社名</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-600 uppercase">FAX</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-600 uppercase">結果</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-zinc-600 uppercase">詳細</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => {
                const active = activeIdx === idx;
                return (
                  <tr key={it.customer_id}
                      onClick={() => setActiveIdx(idx)}
                      className={[
                        'border-t border-zinc-100 cursor-pointer transition',
                        active ? 'bg-indigo-50/60' : 'hover:bg-zinc-50/60',
                      ].join(' ')}>
                    <td className="text-center px-2 py-2 tabular-nums text-xs text-zinc-500">{it.row_index}</td>
                    <td className="px-3 py-2 font-medium text-zinc-900">
                      {it.company_name}
                      {it.report_id && <span className="ml-2 text-[10px] text-emerald-700 bg-emerald-50 px-1 rounded">入力済</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-700">{it.fax_number}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 flex-wrap">
                        {RESULTS.map((r) => (
                          <button key={r.key}
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); applyResult(idx, r.key); }}
                                  className={[
                                    'px-2 py-0.5 text-xs rounded transition',
                                    it.result === r.key ? r.cls + ' ring-1 ring-current' : 'bg-white border border-zinc-200 text-zinc-500 hover:bg-zinc-50',
                                  ].join(' ')}>
                            {r.short}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 w-[280px]">
                      <input
                        ref={(el) => (detailRefs.current[idx] = el)}
                        type="text"
                        value={it.result_detail || ''}
                        onChange={(e) => updateDetail(idx, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        placeholder="メモ(任意)"
                        className="w-full border border-zinc-200 rounded px-2 py-1 text-xs"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Link href={`/reports${isDemo ? '?demo=1' : ''}`}
              className="px-4 py-2 text-sm bg-white border border-zinc-300 rounded-md">キャンセル</Link>
        <button onClick={save} disabled={saving}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50">
          {saving ? '保存中…' : `${items.length} 件をまとめて保存`}
        </button>
      </div>

      <style jsx global>{`
        .rep-input {
          width: 100%;
          border: 1px solid #d4d4d8;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          background: white;
        }
        .rep-input:focus { outline: 2px solid #6366f1; outline-offset: -1px; border-color: transparent; }
        .rep-kbd {
          display: inline-block;
          padding: 1px 5px;
          font-family: ui-monospace, monospace;
          font-size: 10px;
          background: #f4f4f5;
          border: 1px solid #d4d4d8;
          border-bottom-width: 2px;
          border-radius: 3px;
          color: #18181b;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

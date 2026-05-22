import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

/**
 * 原稿詳細モーダル: 基本情報 + 使用記録 (送信日 × PC × 受電結果) の閲覧/追加
 */
export default function ManuscriptContentDetailModal({ manuscriptId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [usageForm, setUsageForm] = useState(initUsageForm());

  function initUsageForm() {
    return {
      send_date: new Date().toISOString().slice(0, 10),
      pc_number: '',
      sent_count: 0,
      no_response_count: 0,
      response_inquiry_count: 0,
      response_order_count: 0,
      refusal_count: 0,
      invalid_number_count: 0,
      other_count: 0,
      note: '',
    };
  }

  const reload = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/api/manuscript-contents/${manuscriptId}`);
      setData(r.data.data);
    } catch (e) { toast.error(e.userMessage || '読込失敗'); }
    finally { setLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [manuscriptId]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const addUsage = async (e) => {
    e.preventDefault();
    if (!usageForm.send_date || !usageForm.pc_number) { toast.error('送信日とPCは必須'); return; }
    try {
      await api.post(`/api/manuscript-contents/${manuscriptId}/usage`, usageForm);
      toast.success('使用記録を保存しました');
      setUsageForm(initUsageForm());
      reload();
      onChanged?.();
    } catch (err) {
      toast.error(err.userMessage || '保存失敗');
    }
  };

  const removeUsage = async (usageId) => {
    if (!window.confirm('この使用記録を削除しますか?')) return;
    try {
      await api.delete(`/api/manuscript-contents/${manuscriptId}/usage/${usageId}`);
      toast.success('削除しました');
      reload();
      onChanged?.();
    } catch (err) { toast.error(err.userMessage || '削除失敗'); }
  };

  const date = (v) => v ? new Date(v).toLocaleDateString('ja-JP') : '—';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-[1100px] max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <div className="p-12 text-center text-zinc-400">読み込み中…</div>
        ) : !data ? (
          <div className="p-12 text-center text-zinc-400">取得できませんでした</div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between px-6 py-4 border-b border-zinc-200 flex-shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">
                  {data.title || `原稿 #${data.id}`}
                </h2>
                <p className="text-zinc-500 mt-0.5 text-xs">
                  ID: {data.id} {data.registration_no && <>/ 登録番号: <span className="font-mono">{data.registration_no}</span></>}
                </p>
              </div>
              <button className="text-zinc-400 hover:text-zinc-600 text-xl leading-none" onClick={onClose}>✕</button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
              {/* Meta + PDF preview */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-800 mb-2">メタデータ</h3>
                  <dl className="text-sm grid grid-cols-[100px_1fr] gap-y-1.5">
                    <Row k="国籍" v={data.nationality} />
                    <Row k="性別" v={data.gender} />
                    <Row k="業種" v={data.industry_category} />
                    <Row k="ファイル" v={data.pdf_original_name} />
                    <Row k="サイズ" v={data.pdf_size_bytes ? `${Math.round(data.pdf_size_bytes / 1024)} KB` : '—'} />
                    <Row k="登録日" v={data.created_at ? new Date(data.created_at).toLocaleString('ja-JP') : '—'} />
                    <Row k="メモ" v={data.memo} />
                  </dl>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-800 mb-2">PDF プレビュー</h3>
                  {data.pdf_file_path ? (
                    <div className="border border-zinc-200 rounded h-[300px] overflow-hidden">
                      <iframe src={`${api.defaults.baseURL || ''}/api/manuscript-contents/${data.id}/pdf`} className="w-full h-full" title="PDF preview" />
                    </div>
                  ) : (
                    <div className="text-zinc-400 text-sm border border-dashed border-zinc-300 rounded p-6 text-center">PDF未登録</div>
                  )}
                </div>
              </div>

              {/* Usage table */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-800 mb-2">送信使用記録</h3>
                <div className="border border-zinc-200 rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 border-b border-zinc-200">
                      <tr>
                        <Th>送信日</Th><Th>PC</Th>
                        <Th align="right">送信</Th>
                        <Th align="right">未反応</Th>
                        <Th align="right">問合せ</Th>
                        <Th align="right">発注</Th>
                        <Th align="right">拒否</Th>
                        <Th align="right">番号無効</Th>
                        <Th align="right">その他</Th>
                        <Th>メモ</Th>
                        <Th></Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.usage || []).map((u) => (
                        <tr key={u.id} className="border-t border-zinc-100">
                          <Td>{date(u.send_date)}</Td>
                          <Td className="font-mono">{u.pc_number}</Td>
                          <Td align="right" className="tabular-nums">{u.sent_count}</Td>
                          <Td align="right" className="tabular-nums">{u.no_response_count}</Td>
                          <Td align="right" className="tabular-nums">{u.response_inquiry_count}</Td>
                          <Td align="right" className="tabular-nums">{u.response_order_count}</Td>
                          <Td align="right" className="tabular-nums">{u.refusal_count}</Td>
                          <Td align="right" className="tabular-nums">{u.invalid_number_count}</Td>
                          <Td align="right" className="tabular-nums">{u.other_count}</Td>
                          <Td>{u.note || ''}</Td>
                          <Td>
                            <button onClick={() => removeUsage(u.id)} className="text-red-600 hover:underline text-xs">削除</button>
                          </Td>
                        </tr>
                      ))}
                      {(!data.usage || data.usage.length === 0) && (
                        <tr><td colSpan={11} className="text-center text-zinc-400 py-6 text-xs">使用記録なし</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 新規追加フォーム */}
                <form onSubmit={addUsage} className="mt-3 bg-zinc-50 border border-zinc-200 rounded p-3">
                  <div className="text-xs font-semibold text-zinc-700 mb-2">新しい使用記録を追加 (送信日 + PC が同じなら上書き)</div>
                  <div className="grid grid-cols-9 gap-2 text-xs items-end">
                    <div>
                      <Lbl>送信日</Lbl>
                      <input type="date" required value={usageForm.send_date}
                             onChange={(e) => setUsageForm({ ...usageForm, send_date: e.target.value })}
                             className="rep-input" />
                    </div>
                    <div>
                      <Lbl>PC</Lbl>
                      <input type="text" required value={usageForm.pc_number}
                             onChange={(e) => setUsageForm({ ...usageForm, pc_number: e.target.value })}
                             placeholder="NO.3" className="rep-input font-mono" />
                    </div>
                    <NumField label="送信" v={usageForm.sent_count} onChange={(v) => setUsageForm({ ...usageForm, sent_count: v })} />
                    <NumField label="未反応" v={usageForm.no_response_count} onChange={(v) => setUsageForm({ ...usageForm, no_response_count: v })} />
                    <NumField label="問合せ" v={usageForm.response_inquiry_count} onChange={(v) => setUsageForm({ ...usageForm, response_inquiry_count: v })} />
                    <NumField label="発注" v={usageForm.response_order_count} onChange={(v) => setUsageForm({ ...usageForm, response_order_count: v })} />
                    <NumField label="拒否" v={usageForm.refusal_count} onChange={(v) => setUsageForm({ ...usageForm, refusal_count: v })} />
                    <NumField label="番号無効" v={usageForm.invalid_number_count} onChange={(v) => setUsageForm({ ...usageForm, invalid_number_count: v })} />
                    <NumField label="その他" v={usageForm.other_count} onChange={(v) => setUsageForm({ ...usageForm, other_count: v })} />
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2 mt-2 items-end">
                    <div>
                      <Lbl>メモ</Lbl>
                      <input type="text" value={usageForm.note}
                             onChange={(e) => setUsageForm({ ...usageForm, note: e.target.value })}
                             className="rep-input" />
                    </div>
                    <button type="submit"
                            className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">
                      追加 / 上書き
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-zinc-200 flex justify-end flex-shrink-0">
              <button onClick={onClose} className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">閉じる</button>
            </div>
          </>
        )}

        <style jsx global>{`
          .rep-input { width: 100%; border: 1px solid #d4d4d8; border-radius: 6px; padding: 6px 8px; font-size: 13px; background: white; }
          .rep-input:focus { outline: 2px solid #6366f1; outline-offset: -1px; border-color: transparent; }
        `}</style>
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }) {
  return <th className={`px-2 py-1.5 font-medium text-zinc-600 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>;
}
function Td({ children, align = 'left', className = '' }) {
  return <td className={`px-2 py-1 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>{children}</td>;
}
function Row({ k, v }) {
  return (<>
    <dt className="text-xs text-zinc-500">{k}</dt>
    <dd className="text-sm text-zinc-800">{v ? String(v) : <span className="text-zinc-300">—</span>}</dd>
  </>);
}
function Lbl({ children }) {
  return <div className="text-[10px] text-zinc-500 mb-0.5">{children}</div>;
}
function NumField({ label, v, onChange }) {
  return (
    <div>
      <Lbl>{label}</Lbl>
      <input type="number" min="0" value={v} onChange={(e) => onChange(Number(e.target.value) || 0)} className="rep-input tabular-nums" />
    </div>
  );
}

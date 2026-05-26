import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

/**
 * 原稿詳細モーダル: メタ + PDF + 自動集計 送信使用履歴
 *   送信使用履歴は ドライブ格納 スロット 紐づけ から自動集計:
 *     格納日 / PC / 地域 / 反応(クリックで詳細) / 案件化
 */
export default function ManuscriptContentDetailModal({ manuscriptId, onClose, onChanged: _onChanged }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // 反応詳細サブモーダル: { slotId, slotLabel, rows, loading }
  const [responseDetail, setResponseDetail] = useState(null);

  const reload = async () => {
    setLoading(true);
    setHistoryLoading(true);
    try {
      const [r, h] = await Promise.all([
        api.get(`/api/manuscript-contents/${manuscriptId}`),
        api.get(`/api/manuscript-contents/${manuscriptId}/storage-history`).catch(() => ({ data: { data: [] } })),
      ]);
      setData(r.data.data);
      setHistory(h.data.data || []);
    } catch (e) { toast.error(e.userMessage || '読込失敗'); }
    finally { setLoading(false); setHistoryLoading(false); }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [manuscriptId]);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !responseDetail && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, responseDetail]);

  const openResponseDetail = async (row) => {
    const slotLabel = `${row.folder_date?.slice(0, 10) || '—'} / NO.${row.slot_number}`;
    setResponseDetail({ slotId: row.slot_id, slotLabel, rows: [], loading: true });
    try {
      const { data: resp } = await api.get(
        `/api/manuscript-contents/${manuscriptId}/storage-history/${row.slot_id}/responses`
      );
      setResponseDetail((cur) => cur && ({ ...cur, rows: resp.data || [], loading: false }));
    } catch (e) {
      toast.error(e.userMessage || '反応詳細の取得に失敗');
      setResponseDetail((cur) => cur && ({ ...cur, loading: false }));
    }
  };

  const date = (v) => v ? new Date(v).toLocaleDateString('ja-JP') : '—';
  const dateTime = (v) => v ? new Date(v).toLocaleString('ja-JP') : '—';

  // 合計
  const total = history.reduce(
    (a, r) => ({
      response:  a.response + Number(r.response_count || 0),
      project:   a.project  + Number(r.project_count  || 0),
      ng:        a.ng       + Number(r.ng_count       || 0),
      recall:    a.recall   + Number(r.recall_count   || 0),
      material:  a.material + Number(r.material_count || 0),
      other:     a.other    + Number(r.other_count    || 0),
    }),
    { response: 0, project: 0, ng: 0, recall: 0, material: 0, other: 0 }
  );

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
              <button className="text-zinc-400 hover:text-zinc-600 text-xl leading-none" onClick={onClose}>×</button>
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
                  {data.pdf_file_path || data.pdf_drive_file_id ? (
                    <div className="border border-zinc-200 rounded h-[300px] overflow-hidden">
                      <iframe src={`${api.defaults.baseURL || ''}/api/manuscript-contents/${data.id}/pdf`} className="w-full h-full" title="PDF preview" />
                    </div>
                  ) : (
                    <div className="text-zinc-400 text-sm border border-dashed border-zinc-300 rounded p-6 text-center">PDF未登録</div>
                  )}
                </div>
              </div>

              {/* 送信使用履歴 (自動集計) */}
              <div>
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-sm font-semibold text-zinc-800">
                    送信使用履歴 <span className="text-xs font-normal text-zinc-500">(自動集計)</span>
                  </h3>
                  <span className="text-[11px] text-zinc-500">
                    ドライブ格納 スロット に紐づけたタイミングで自動加算 / 反応 をクリックで明細表示
                  </span>
                </div>
                <div className="border border-zinc-200 rounded overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 border-b border-zinc-200">
                      <tr>
                        <Th>格納日</Th>
                        <Th>PC</Th>
                        <Th>地域</Th>
                        <Th>業種</Th>
                        <Th align="right">反応</Th>
                        <Th align="right">案件化</Th>
                        <Th align="right">NG</Th>
                        <Th align="right">リコール</Th>
                        <Th align="right">資料送付</Th>
                        <Th align="right">その他</Th>
                        <Th>Drive</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyLoading && (
                        <tr><td colSpan={11} className="text-center text-zinc-400 py-6">読み込み中…</td></tr>
                      )}
                      {!historyLoading && history.length === 0 && (
                        <tr><td colSpan={11} className="text-center text-zinc-400 py-6">
                          まだ ドライブ格納 スロット に紐づけられていません
                        </td></tr>
                      )}
                      {!historyLoading && history.map((r) => (
                        <tr key={r.slot_file_id} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                          <Td>{date(r.folder_date)}</Td>
                          <Td className="font-mono">NO.{r.slot_number}</Td>
                          <Td className="max-w-[140px] truncate" title={r.prefectures || ''}>
                            {r.prefectures || <span className="text-zinc-300">—</span>}
                          </Td>
                          <Td className="max-w-[120px] truncate" title={r.industries || ''}>
                            {r.industries || <span className="text-zinc-300">—</span>}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {Number(r.response_count) > 0 ? (
                              <button type="button"
                                      onClick={() => openResponseDetail(r)}
                                      className="text-indigo-600 hover:text-indigo-800 underline font-medium"
                                      title="反応詳細を表示">
                                {r.response_count}
                              </button>
                            ) : (
                              <span className="text-zinc-300">0</span>
                            )}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {Number(r.project_count) > 0
                              ? <span className="text-emerald-700 font-semibold">{r.project_count}</span>
                              : <span className="text-zinc-300">0</span>}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {Number(r.ng_count) > 0 ? <span className="text-red-600">{r.ng_count}</span> : <span className="text-zinc-300">0</span>}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {Number(r.recall_count) > 0 ? <span className="text-sky-700">{r.recall_count}</span> : <span className="text-zinc-300">0</span>}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {Number(r.material_count) > 0 ? <span className="text-amber-700">{r.material_count}</span> : <span className="text-zinc-300">0</span>}
                          </Td>
                          <Td align="right" className="tabular-nums">
                            {Number(r.other_count) > 0 ? r.other_count : <span className="text-zinc-300">0</span>}
                          </Td>
                          <Td>
                            {r.drive_url ? (
                              <a href={r.drive_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline text-xs">開く ↗</a>
                            ) : <span className="text-zinc-300">—</span>}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                    {!historyLoading && history.length > 0 && (
                      <tfoot className="bg-zinc-50 border-t-2 border-zinc-300">
                        <tr className="font-semibold">
                          <Td colSpan={4} align="right" className="text-zinc-700">合計 ({history.length} スロット)</Td>
                          <Td align="right" className="tabular-nums">{total.response}</Td>
                          <Td align="right" className="tabular-nums text-emerald-700">{total.project}</Td>
                          <Td align="right" className="tabular-nums text-red-600">{total.ng}</Td>
                          <Td align="right" className="tabular-nums text-sky-700">{total.recall}</Td>
                          <Td align="right" className="tabular-nums text-amber-700">{total.material}</Td>
                          <Td align="right" className="tabular-nums">{total.other}</Td>
                          <Td></Td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
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

      {/* 反応詳細サブモーダル */}
      {responseDetail && (
        <ResponseDetailModal
          state={responseDetail}
          onClose={() => setResponseDetail(null)}
          dateTime={dateTime}
        />
      )}
    </div>
  );
}

const RESULT_LABEL = {
  project:          { label: '案件化',   cls: 'bg-emerald-100 text-emerald-800' },
  ng:               { label: 'NG',       cls: 'bg-red-100 text-red-700' },
  recall:           { label: 'リコール', cls: 'bg-sky-100 text-sky-700' },
  material_sent:    { label: '資料送付', cls: 'bg-amber-100 text-amber-800' },
  other:            { label: 'その他',   cls: 'bg-zinc-100 text-zinc-700' },
  no_response:      { label: '受電なし', cls: 'bg-zinc-100 text-zinc-500' },
  response_inquiry: { label: '問合せ',   cls: 'bg-amber-100 text-amber-800' },
  response_order:   { label: '発注',     cls: 'bg-emerald-100 text-emerald-800' },
  refusal:          { label: '拒否',     cls: 'bg-red-100 text-red-700' },
  invalid_number:   { label: '番号無効', cls: 'bg-zinc-100 text-zinc-500' },
};

function ResponseDetailModal({ state, onClose, dateTime }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200">
          <div>
            <h3 className="text-lg font-semibold text-zinc-900">反応詳細</h3>
            <p className="text-xs text-zinc-500 mt-0.5">スロット: {state.slotLabel} / {state.rows.length} 件</p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-auto">
          {state.loading ? (
            <div className="text-center text-zinc-400 py-12">読み込み中…</div>
          ) : state.rows.length === 0 ? (
            <div className="text-center text-zinc-400 py-12">反応データなし</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-zinc-600">受電日時</th>
                  <th className="text-left px-3 py-2 font-medium text-zinc-600">企業</th>
                  <th className="text-left px-3 py-2 font-medium text-zinc-600">業種</th>
                  <th className="text-left px-3 py-2 font-medium text-zinc-600">地域</th>
                  <th className="text-left px-3 py-2 font-medium text-zinc-600">結果</th>
                  <th className="text-left px-3 py-2 font-medium text-zinc-600">詳細</th>
                </tr>
              </thead>
              <tbody>
                {state.rows.map((r) => {
                  const meta = RESULT_LABEL[r.result] || RESULT_LABEL.other;
                  return (
                    <tr key={r.id} className="border-t border-zinc-100 hover:bg-zinc-50/60">
                      <td className="px-3 py-1.5 text-zinc-700">{dateTime(r.responded_at)}</td>
                      <td className="px-3 py-1.5 font-medium text-zinc-900 max-w-[200px] truncate" title={r.company_name || ''}>
                        {r.company_name || '—'}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-700">{r.industry_category || '—'}</td>
                      <td className="px-3 py-1.5 text-zinc-700">{r.prefecture || '—'}</td>
                      <td className="px-3 py-1.5">
                        <span className={`px-1.5 py-0.5 text-[10px] rounded ${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="px-3 py-1.5 text-zinc-700 max-w-[280px] truncate" title={r.result_detail || ''}>
                        {r.result_detail || <span className="text-zinc-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-5 py-3 border-t border-zinc-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">閉じる</button>
        </div>
      </div>
    </div>
  );
}

function Th({ children, align = 'left' }) {
  return <th className={`px-2 py-1.5 font-medium text-zinc-600 ${align === 'right' ? 'text-right' : 'text-left'}`}>{children}</th>;
}
function Td({ children, align = 'left', className = '', colSpan }) {
  return <td colSpan={colSpan} className={`px-2 py-1 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}>{children}</td>;
}
function Row({ k, v }) {
  return (<>
    <dt className="text-xs text-zinc-500">{k}</dt>
    <dd className="text-sm text-zinc-800">{v ? String(v) : <span className="text-zinc-300">—</span>}</dd>
  </>);
}

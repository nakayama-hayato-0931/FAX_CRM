import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const NATIONALITIES = ['ベトナム','ミャンマー','ネパール','モンゴル','スリランカ','バングラディシュ'];
const GENDERS = ['男','女'];
const INDUSTRIES = ['飲食','製造','小売','宿泊','建設','その他'];

/**
 * 原稿管理 (manuscript_contents) から1件選択するピッカーモーダル
 *   - 検索 + 国籍/性別/業種フィルタ
 *   - 行クリック (または「選択」ボタン) で onSelect(content) → onClose
 *
 * Props:
 *   - onClose: 閉じる
 *   - onSelect(content): 選択した content オブジェクトを渡す
 *   - excludeContentIds?: 既に紐づいている content の id 配列 (= 重複防止のため非活性化表示)
 */
export default function ManuscriptContentPicker({ onClose, onSelect, excludeContentIds = [] }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ q: '', nationality: '', gender: '', industry: '' });

  // body scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // ESC で閉じる
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const load = async (override) => {
    setLoading(true);
    try {
      const params = { page: 1, pageSize: 100, ...(override || filters) };
      const { data } = await api.get('/api/manuscript-contents', { params });
      setItems(data.data || []);
    } catch (e) {
      toast.error(e.userMessage || '読み込み失敗');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filters.nationality, filters.gender, filters.industry]);

  const excluded = new Set(excludeContentIds || []);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">原稿を選択</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              原稿管理 (/scripts) に事前登録した原稿から選択してください
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="text-zinc-400 hover:text-zinc-600 text-xl leading-none">×</button>
        </div>

        {/* Filters */}
        <div className="px-5 py-3 border-b border-zinc-200 flex-shrink-0 bg-zinc-50 grid grid-cols-5 gap-2">
          <input type="text" placeholder="検索 (タイトル/登録番号/メモ)"
                 value={filters.q}
                 onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                 onKeyDown={(e) => e.key === 'Enter' && load()}
                 className="col-span-2 mc-input" />
          <select value={filters.nationality}
                  onChange={(e) => setFilters({ ...filters, nationality: e.target.value })}
                  className="mc-input">
            <option value="">国籍 (すべて)</option>
            {NATIONALITIES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={filters.industry}
                  onChange={(e) => setFilters({ ...filters, industry: e.target.value })}
                  className="mc-input">
            <option value="">業種 (すべて)</option>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <select value={filters.gender}
                  onChange={(e) => setFilters({ ...filters, gender: e.target.value })}
                  className="mc-input">
            <option value="">性別 (すべて)</option>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="px-4 py-16 text-center text-zinc-400 text-sm">読み込み中…</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-16 text-center text-zinc-400 text-sm">
              該当する原稿がありません。先に <a href="/scripts" className="text-indigo-700 underline">原稿管理</a> で登録してください。
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 sticky top-0 z-10 border-b border-zinc-200">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600">タイトル / 登録番号</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600">国籍</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600">性別</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600">業種</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-zinc-600">PDF</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-zinc-600 w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const isExcluded = excluded.has(r.id);
                  const hasPdf = !!(r.pdf_drive_file_id || r.pdf_file_path);
                  return (
                    <tr key={r.id} className={`border-t border-zinc-100 ${isExcluded ? 'bg-zinc-50/80' : 'hover:bg-indigo-50/40'}`}>
                      <td className="px-3 py-2">
                        <div className={`text-sm ${r.title ? 'text-zinc-900 font-medium' : 'text-zinc-400'}`}>
                          {r.title || `原稿 #${r.id}`}
                        </div>
                        {r.registration_no && (
                          <div className="text-[10px] text-zinc-500 font-mono">{r.registration_no}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-700">{r.nationality || '—'}</td>
                      <td className="px-3 py-2 text-xs text-zinc-700">{r.gender || '—'}</td>
                      <td className="px-3 py-2 text-xs text-zinc-700">{r.industry_category || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {hasPdf
                          ? <span className="text-emerald-700">あり</span>
                          : <span className="text-red-500">無し</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isExcluded ? (
                          <span className="text-[10px] text-zinc-400">紐付け済み</span>
                        ) : (
                          <button type="button"
                                  disabled={!hasPdf}
                                  onClick={() => { onSelect(r); onClose(); }}
                                  className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-40">
                            選択
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 flex justify-end gap-2 flex-shrink-0">
          <button type="button" onClick={() => load()}
                  className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
            再読み込み
          </button>
          <button type="button" onClick={onClose}
                  className="px-3 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
            キャンセル
          </button>
        </div>

        <style jsx global>{`
          .mc-input { width: 100%; border: 1px solid #d4d4d8; border-radius: 6px; padding: 6px 10px; font-size: 13px; background: white; }
          .mc-input:focus { outline: 2px solid #6366f1; outline-offset: -1px; border-color: transparent; }
        `}</style>
      </div>
    </div>
  );
}

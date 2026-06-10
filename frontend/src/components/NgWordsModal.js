import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/utils/api';

const FIELDS = [
  { key: 'company_name',   label: '会社名',   sample: '○○警察署 / ○○大学 / ○○役場 等を除外' },
  { key: 'industry',       label: '業種',     sample: '宗教法人 / 官公庁 等' },
  { key: 'address',        label: '住所',     sample: '特定エリアを除外する場合' },
  { key: 'note',           label: '備考',     sample: 'コメントに含まれる NG キーワード' },
  { key: 'url',            label: 'URL',      sample: '特定ドメイン (gov.jp 等)' },
  { key: 'representative', label: '代表者',   sample: '特定の代表者名 (まれに利用)' },
];

/**
 * NGワード 管理モーダル (リスト抽出から開く)
 *   - 一覧表示 (field 別グループ)
 *   - 新規追加 (field セレクト + word 入力 + memo 任意)
 *   - 有効/無効 トグル + 削除
 *   - 保存内容は次回以降のリスト抽出に自動適用される
 */
export default function NgWordsModal({ onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newField, setNewField] = useState('company_name');
  const [newWord, setNewWord] = useState('');
  const [newMemo, setNewMemo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/ng-words');
      setItems(data.data || []);
    } catch (e) {
      toast.error(e.userMessage || '読み込み失敗');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const add = async (e) => {
    e.preventDefault();
    if (!newWord.trim()) { toast.error('NGワードを入力してください'); return; }
    setBusy(true);
    try {
      await api.post('/api/ng-words', {
        field: newField,
        word: newWord.trim(),
        memo: newMemo.trim() || null,
        enabled: 1,
      });
      setNewWord(''); setNewMemo('');
      toast.success('NGワード を追加しました');
      await load();
    } catch (err) {
      toast.error(err.userMessage || '追加失敗');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (it) => {
    try {
      await api.patch(`/api/ng-words/${it.id}`, { enabled: it.enabled ? 0 : 1 });
      await load();
    } catch (e) {
      toast.error(e.userMessage || '更新失敗');
    }
  };

  const remove = async (it) => {
    if (!window.confirm(`NGワード 「${it.word}」 (${FIELDS.find(f => f.key === it.field)?.label || it.field}) を削除しますか？`)) return;
    try {
      await api.delete(`/api/ng-words/${it.id}`);
      toast.success('削除しました');
      await load();
    } catch (e) {
      toast.error(e.userMessage || '削除失敗');
    }
  };

  // field でグループ化
  const byField = new Map(FIELDS.map((f) => [f.key, []]));
  for (const it of items) {
    if (!byField.has(it.field)) byField.set(it.field, []);
    byField.get(it.field).push(it);
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-zinc-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">NGワード管理</h2>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              指定した部分文字列を含む顧客はリスト抽出から自動で除外されます。
              <br />会社名 / 業種 / 住所 / 備考 / URL / 代表者 のいずれかにマッチした時点で除外。
            </p>
          </div>
          <button className="text-zinc-400 hover:text-zinc-600 text-xl leading-none" onClick={onClose} title="閉じる (Esc)">
            ✕
          </button>
        </div>

        {/* 追加フォーム */}
        <form onSubmit={add} className="px-6 py-3 border-b border-zinc-200 bg-zinc-50 flex-shrink-0">
          <div className="grid grid-cols-[120px_1fr_140px_auto] gap-2">
            <select value={newField} onChange={(e) => setNewField(e.target.value)}
                    disabled={busy}
                    className="border border-zinc-300 rounded px-2 py-1.5 text-sm bg-white">
              {FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <input type="text" placeholder="NGワード (部分一致)"
                   value={newWord}
                   onChange={(e) => setNewWord(e.target.value)}
                   disabled={busy}
                   className="border border-zinc-300 rounded px-2 py-1.5 text-sm" />
            <input type="text" placeholder="メモ (任意)"
                   value={newMemo}
                   onChange={(e) => setNewMemo(e.target.value)}
                   disabled={busy}
                   className="border border-zinc-300 rounded px-2 py-1.5 text-sm" />
            <button type="submit" disabled={busy || !newWord.trim()}
                    className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50">
              + 追加
            </button>
          </div>
          <div className="text-[11px] text-zinc-500 mt-1.5">
            例: {FIELDS.find(f => f.key === newField)?.sample}
          </div>
        </form>

        {/* 一覧 */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {loading ? (
            <div className="text-center text-zinc-400 py-12 text-sm">読み込み中…</div>
          ) : items.length === 0 ? (
            <div className="text-center text-zinc-400 py-12 text-sm">
              NGワード が登録されていません。 上のフォームから追加してください。
            </div>
          ) : (
            <div className="space-y-4">
              {FIELDS.map((f) => {
                const list = byField.get(f.key) || [];
                if (!list.length) return null;
                return (
                  <div key={f.key}>
                    <div className="text-xs font-semibold text-zinc-700 mb-2 flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-zinc-100 rounded">{f.label}</span>
                      <span className="text-[11px] text-zinc-400 font-normal">({list.length})</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((it) => (
                        <div key={it.id}
                             className={[
                               'inline-flex items-center gap-1.5 border rounded-full pl-3 pr-1 py-1 text-xs',
                               it.enabled
                                 ? 'border-red-200 bg-red-50 text-red-700'
                                 : 'border-zinc-200 bg-zinc-50 text-zinc-400 line-through',
                             ].join(' ')}
                             title={it.memo || ''}>
                          <span>{it.word}</span>
                          <button type="button"
                                  onClick={() => toggle(it)}
                                  className="px-1.5 py-0.5 text-[10px] bg-white border border-zinc-300 rounded hover:bg-zinc-50"
                                  title={it.enabled ? '一時的に無効化 (削除はしない)' : '有効化'}>
                            {it.enabled ? '無効化' : '有効化'}
                          </button>
                          <button type="button"
                                  onClick={() => remove(it)}
                                  className="px-1.5 py-0.5 text-[10px] bg-white border border-zinc-300 text-zinc-500 rounded hover:bg-red-50 hover:text-red-700"
                                  title="完全削除">
                            削除
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-zinc-200 flex justify-end flex-shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 text-sm bg-white border border-zinc-300 rounded hover:bg-zinc-50">
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

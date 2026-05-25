/**
 * Google Drive 連携の共通サービス。
 *   - googleapis を遅延 require して未インストールでも他機能を壊さない
 *   - サービスアカウントJSONで認証 (scope: drive.file)
 *   - 公開メソッド:
 *       getStatus()                         認証/設定の状態
 *       uploadFile({ filePath, mimeType, name, parentId })
 *       findOrCreateFolder({ name, parentId })
 *       createFolder({ name, parentId })
 *       testConnection()                    list を1件叩いて疎通確認
 */
const fs = require('fs');
const path = require('path');
const settings = require('./settingsService');

let _drive = null;     // googleapis Drive client (cached)
let _initError = null;

function tryLoad() {
  if (_drive) return _drive;
  if (_initError) throw _initError;

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath || !fs.existsSync(keyPath)) {
    _initError = Object.assign(new Error('Google認証ファイルが未設定です'), {
      status: 400, code: 'NO_SA_KEY',
    });
    throw _initError;
  }
  let google;
  try { google = require('googleapis').google; }
  catch (_e) {
    _initError = Object.assign(new Error('googleapis 未インストール'), {
      status: 500, code: 'GOOGLEAPIS_MISSING',
    });
    throw _initError;
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  _drive = google.drive({ version: 'v3', auth });
  return _drive;
}

function getStatus() {
  const sa = settings.getGoogleAuthStatus();
  let driveReady = false;
  let driveError = null;
  if (sa.configured) {
    try { tryLoad(); driveReady = true; }
    catch (e) { driveError = e.message; }
  }
  return {
    serviceAccount: sa,
    driveReady,
    driveError,
  };
}

async function testConnection() {
  const drive = tryLoad();
  try {
    const resp = await drive.files.list({
      pageSize: 1,
      fields: 'files(id,name)',
    });
    return { ok: true, sample: resp.data.files?.[0] || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 親フォルダ直下から name でフォルダを検索 (複数返却版)。
 *   includeTrashed: true なら ゴミ箱内のフォルダも返す
 *   重複や trashed が混在しているケースの完全クリーンアップに使う。
 */
async function findFolders({ name, parentId, includeTrashed = false }) {
  const drive = tryLoad();
  const q = [
    `mimeType = 'application/vnd.google-apps.folder'`,
    `name = '${String(name).replace(/'/g, "\\'")}'`,
  ];
  if (!includeTrashed) q.push(`trashed = false`);
  if (parentId) q.push(`'${parentId}' in parents`);
  const resp = await drive.files.list({
    q: q.join(' and '),
    fields: 'files(id,name,webViewLink,trashed)',
    pageSize: 50,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: 'allDrives',
  });
  return resp.data.files || [];
}

/**
 * 親フォルダ直下から name でフォルダを検索。見つからなければ null を返す。
 *   (findOrCreateFolder と違って作成はしない。trashed は除外)
 */
async function findFolder({ name, parentId }) {
  const all = await findFolders({ name, parentId, includeTrashed: false });
  return all[0] || null;
}

/**
 * 親フォルダ直下から name で検索、存在すればその id を返す。無ければ作成。
 */
async function findOrCreateFolder({ name, parentId }) {
  const existing = await findFolder({ name, parentId });
  if (existing) return { ...existing, created: false };
  return createFolder({ name, parentId });
}

async function createFolder({ name, parentId }) {
  const drive = tryLoad();
  const resp = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id,name,webViewLink',
    supportsAllDrives: true,
  });
  return { ...resp.data, created: true };
}

async function uploadFile({ filePath, mimeType, name, parentId }) {
  const drive = tryLoad();
  if (!fs.existsSync(filePath)) {
    const err = new Error(`ファイルが存在しません: ${filePath}`);
    err.status = 400; err.code = 'FILE_NOT_FOUND';
    throw err;
  }
  const resp = await drive.files.create({
    requestBody: {
      name: name || path.basename(filePath),
      parents: parentId ? [parentId] : undefined,
    },
    media: {
      mimeType: mimeType || 'application/octet-stream',
      body: fs.createReadStream(filePath),
    },
    fields: 'id,name,webViewLink,webContentLink',
    supportsAllDrives: true,   // 共有ドライブ対応 (My Drive はサービスアカウントの quota 制限で書き込み不可、 共有ドライブなら OK)
  });
  return resp.data;
}

/**
 * Drive ファイルをストリームで取得 (PDF プレビュー / ダウンロード用)
 *   res: Express の Response を渡せばそのまま pipe して返せる
 */
async function downloadFileStream(fileId) {
  const drive = tryLoad();
  const resp = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  return resp.data; // stream
}

/**
 * Drive ファイルのメタデータ (size / mime 等) を取得
 */
async function getFileMeta(fileId) {
  const drive = tryLoad();
  const resp = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,size,webViewLink,webContentLink',
    supportsAllDrives: true,
  });
  return resp.data;
}

/**
 * Drive ファイル/フォルダ削除
 *   - 1) まず files.delete (permanent delete) を試す
 *        → Drive から実際に消える (ゴミ箱にも残らない)
 *        → 共有ドライブでは "コンテンツ管理者" or "管理者" ロールが必要
 *   - 2) 権限不足 (403) 等で失敗したら trashed:true (ゴミ箱移動) にフォールバック
 *        → "投稿者" ロールでも実行可能
 *        → Drive 上は元の場所からは消えるが「ゴミ箱」に 30 日残る
 *   - findFolder / findOrCreateFolder は trashed=false で除外するため
 *     trash 後に同じ名前で再作成しても重複は起きない。
 *   - 戻り値の mode で deleted (永久削除) / trashed (ゴミ箱移動) を判別可能。
 */
async function deleteFile(fileId) {
  const drive = tryLoad();
  // 1) permanent delete を試す
  try {
    await drive.files.delete({ fileId, supportsAllDrives: true });
    return { ok: true, mode: 'deleted' };
  } catch (e1) {
    // 2) 失敗 → trash (ゴミ箱移動) にフォールバック
    try {
      await drive.files.update({
        fileId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      });
      return { ok: true, mode: 'trashed', deleteError: e1.errors?.[0]?.message || e1.message };
    } catch (e2) {
      const detail = e2.errors?.[0]?.message || e2.message;
      const err = new Error(
        `Drive 削除失敗 (${detail})。 サービスアカウントに該当フォルダの編集権限があるか確認してください。`
      );
      err.cause = e2;
      throw err;
    }
  }
}

/**
 * Drive ファイルを別フォルダにコピー (Drive 内コピー: ダウンロード→アップロード より高速)
 *   元ファイルは残り、新規 fileId が発行される
 */
async function copyFile({ fileId, name, parentId }) {
  const drive = tryLoad();
  const resp = await drive.files.copy({
    fileId,
    requestBody: {
      name,
      parents: parentId ? [parentId] : undefined,
    },
    fields: 'id,name,webViewLink,size,mimeType',
    supportsAllDrives: true,
  });
  return resp.data;
}

/**
 * Drive ファイル/フォルダを別の親へ移動 (addParents + removeParents)
 *   oldParentId 未指定なら現在の parents をすべて removeParents として削除
 *   ファイル ID 自体は変わらないので drive_file_id は再利用可能
 */
async function moveFile({ fileId, newParentId, oldParentId }) {
  const drive = tryLoad();
  let removeParents = oldParentId;
  if (!removeParents) {
    const meta = await drive.files.get({
      fileId, fields: 'parents', supportsAllDrives: true,
    });
    removeParents = (meta.data.parents || []).join(',');
  }
  const resp = await drive.files.update({
    fileId,
    addParents: newParentId,
    removeParents,
    fields: 'id,name,parents,webViewLink',
    supportsAllDrives: true,
  });
  return resp.data;
}

module.exports = {
  getStatus,
  testConnection,
  findFolder,
  findFolders,
  findOrCreateFolder,
  createFolder,
  uploadFile,
  downloadFileStream,
  getFileMeta,
  deleteFile,
  moveFile,
  copyFile,
};

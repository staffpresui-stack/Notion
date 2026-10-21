var DriveUtil_ = (function () {
  var folderMime = 'application/vnd.google-apps.folder';
  function escape(value) { return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  function folders(parent, driveId) {
    var all = [], token;
    do {
      var r = Drive.Files.list({ q: "'" + escape(parent) + "' in parents and trashed = false and mimeType = '" + folderMime + "'",
        corpora: 'drive', driveId: driveId, supportsAllDrives: true, includeItemsFromAllDrives: true,
        pageSize: 100, pageToken: token, fields: 'nextPageToken,files(id,name,parents,driveId,mimeType)' });
      all = all.concat(r.files || []); token = r.nextPageToken;
    } while (token);
    return all;
  }
  function exact(parent, name, driveId) {
    var matches = folders(parent, driveId).filter(function (f) { return f.name === name; });
    if (matches.length !== 1) throw new Error('フォルダ「' + name + '」が見つからないか、同名が複数あります。');
    return matches[0];
  }
  function verifyTestRoot(c) {
    if (!c.SHARED_DRIVE_ID) return Stage2Drive_.open(c).root;
    var root = Drive.Files.get(c.FOLDER_SYSTEM_TEST_ID, { supportsAllDrives: true, fields: 'id,name,parents,driveId,mimeType' });
    if (root.name !== '_test' || root.driveId !== c.SHARED_DRIVE_ID || root.mimeType !== folderMime || !root.parents || root.parents.length !== 1) throw new Error('テスト用フォルダを確認してください。');
    var parent = Drive.Files.get(root.parents[0], { supportsAllDrives: true, fields: 'id,name,driveId' });
    if (parent.name !== '_system' || parent.driveId !== c.SHARED_DRIVE_ID) throw new Error('_system/_test 配下が必要です。');
    return root;
  }
  return { folders: folders, exact: exact, verifyTestRoot: verifyTestRoot };
})();

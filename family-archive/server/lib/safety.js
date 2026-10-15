// Белые списки имён файлов и идентификаторов. Всё, что попадает в путь на диске,
// проверяется здесь — в том числе значения из резервных копий.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PHOTO_FILE_RE = /^(original|display|thumb)(-\d{10,16})?\.(jpg|png|webp|gif)$/;
export const IMPORT_FILE_RE = /^[0-9a-f]{64}\.xlsx$/;
export const BACKUP_NAME_RE = /^family-archive-\d{8}-\d{6}(-\d{1,3})?(-[a-z][a-z0-9-]{0,29})?\.zip$/;

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
export const isPhotoFile = (v) => typeof v === 'string' && PHOTO_FILE_RE.test(v);
export const isImportFile = (v) => typeof v === 'string' && IMPORT_FILE_RE.test(v);
export const isBackupName = (v) => typeof v === 'string' && BACKUP_NAME_RE.test(v);

export const MIME_BY_EXT = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

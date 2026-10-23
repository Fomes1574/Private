// Precisa ser importado antes do SQLite. Desliga os VFS "opfs" e "opfs-wl"
// (exigem SharedArrayBuffer e um proxy extra); usamos só o "opfs-sahpool".
// Também tira os logs do SQLite do console.
globalThis.sqlite3ApiConfig = {
  disable: { vfs: { opfs: true, 'opfs-vfs': true, 'opfs-wl': true, kvvfs: true } },
  debug: () => {}, log: () => {},
};

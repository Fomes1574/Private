// Antes do SQLite: só o VFS opfs-sahpool, sem logs no console.
globalThis.sqlite3ApiConfig = {
  disable: { vfs: { opfs: true, 'opfs-vfs': true, 'opfs-wl': true, kvvfs: true } },
  debug: () => {}, log: () => {},
};

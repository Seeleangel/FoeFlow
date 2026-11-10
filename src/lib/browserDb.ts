import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

const STORE = 'workspace'
const LEGACY_KEY = 'sqlite'
const LEGACY_OWNER = 'legacy-owner'
const sqlite = () => initSqlJs({ locateFile: () => wasmUrl })

function openStorage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('foeflow-web', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function openBrowserDb(workspace: string) {
  const key = `sqlite:${workspace}`
  const [SQL, storage] = await Promise.all([
    sqlite(),
    openStorage(),
  ])
  storage.onversionchange = () => storage.close()

  // IndexedDB queues read/write transactions across tabs. Read and replace the
  // SQLite snapshot in one transaction so concurrent tabs cannot lose writes.
  function access<T>(write: boolean, operation: (db: Database) => T): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = storage.transaction(STORE, write ? 'readwrite' : 'readonly')
      const store = tx.objectStore(STORE)
      let result: T
      let failure: unknown
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('浏览器未能保存工作区'))
      const request = store.get(key)
      request.onsuccess = () => {
        let db: Database | undefined
        try {
          db = new SQL.Database(request.result)
          result = operation(db)
          if (write) store.put(db.export(), key)
        } catch (err) {
          failure = err
          tx.abort()
        } finally {
          db?.close()
        }
      }
    })
  }

  return {
    execute(query: string, values?: unknown[]) {
      return access(true, (db) => { db.run(query, values as SqlValue[] | undefined) })
    },
    select<T>(query: string, values?: unknown[]) {
      return access<T>(false, (db) => {
        const statement = db.prepare(query, values as SqlValue[] | undefined)
        try {
          const rows: Record<string, SqlValue>[] = []
          while (statement.step()) rows.push(statement.getAsObject())
          return rows as T
        } finally {
          statement.free()
        }
      })
    },
  }
}

export async function hasLegacyWorkspace(): Promise<boolean> {
  const storage = await openStorage()
  try {
    return await new Promise((resolve, reject) => {
      const tx = storage.transaction(STORE)
      const store = tx.objectStore(STORE)
      const snapshot = store.get(LEGACY_KEY)
      const owner = store.get(LEGACY_OWNER)
      tx.oncomplete = () => resolve(Boolean(snapshot.result && !owner.result))
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    storage.close()
  }
}

export async function importLegacyWorkspace(workspace: string): Promise<void> {
  const [SQL, storage] = await Promise.all([sqlite(), openStorage()])
  const key = `sqlite:${workspace}`
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = storage.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const snapshot = store.get(LEGACY_KEY)
      const owner = store.get(LEGACY_OWNER)
      const current = store.get(key)
      let failure: unknown
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(failure ?? tx.error)
      // Requests on this transaction finish in order; this callback runs while
      // the transaction is active and writes the copy and claim together.
      current.onsuccess = () => {
        let from: Database | undefined
        let to: Database | undefined
        try {
          if (!snapshot.result || owner.result) throw new Error('此浏览器没有可导入的旧版工作区。')
          to = new SQL.Database(current.result)
          const tables = to.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")[0]?.values ?? []
          const hasContent = tables.some(([name]) => {
            const safeName = String(name).replace(/"/g, '""')
            const filter = name === 'style_templates' ? " WHERE source_type <> 'built-in'" : ''
            return to!.exec(`SELECT 1 FROM "${safeName}"${filter} LIMIT 1`).length > 0
          })
          if (hasContent) throw new Error('请先在空工作区导入旧版资料；现有资料未被覆盖。')
          from = new SQL.Database(snapshot.result)
          if (from.exec("SELECT name FROM sqlite_master WHERE name='settings'").length) {
            from.run("DELETE FROM settings WHERE key='apiKey' OR key LIKE 'imap%' OR key LIKE 'license%'")
          }
          store.put(from.export(), key)
          store.put(workspace, LEGACY_OWNER)
        } catch (error) {
          failure = error
          tx.abort()
        } finally {
          to?.close()
          from?.close()
        }
      }
    })
  } finally {
    storage.close()
  }
}

import initSqlJs, { type Database, type SqlValue } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

const STORE = 'workspace'
const KEY = 'sqlite'

function openStorage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('foeflow-web', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function openBrowserDb() {
  const [SQL, storage] = await Promise.all([
    initSqlJs({ locateFile: () => wasmUrl }),
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
      const request = store.get(KEY)
      request.onsuccess = () => {
        let db: Database | undefined
        try {
          db = new SQL.Database(request.result)
          result = operation(db)
          if (write) store.put(db.export(), KEY)
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

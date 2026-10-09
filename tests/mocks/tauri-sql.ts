// Mock SQLite database for unit tests
interface MockTable {
  name: string;
  rows: any[]
}

class MockDatabase {
  private tables: Map<string, MockTable> = new Map()

  private constructor() {
    // Initialize with schema
    this.tables.set('style_templates', { name: 'style_templates', rows: [] })
    this.tables.set('user_articles', { name: 'user_articles', rows: [] })
    this.tables.set('settings', { name: 'settings', rows: [] })
    this.tables.set('generated_drafts', { name: 'generated_drafts', rows: [] })
    this.tables.set('audit_records', { name: 'audit_records', rows: [] })
  }

  static async load(_connectionString: string): Promise<MockDatabase> {
    console.log('[DB] Starting initialization...')
    console.log('[DB] Loading database...')
    return new MockDatabase()
  }

  async execute(sql: string, values?: any[]): Promise<void> {
    const sqlLower = sql.toLowerCase()

    if (sqlLower.includes('insert or replace into style_templates')) {
      const table = this.tables.get('style_templates')!
      const existingIdx = table.rows.findIndex((r: any) => r.id === values[0])
      if (existingIdx >= 0) {
        table.rows[existingIdx] = {
          id: values[0],
          name: values[1],
          description: values[2],
          source_type: values[3],
          structure_json: values[4],
          form_schema: values[5],
          co_creation_prompt: values[6],
          sample_snippets: values[7],
          created_at: values[8],
          updated_at: values[9],
        }
      } else {
        table.rows.push({
          id: values[0],
          name: values[1],
          description: values[2],
          source_type: values[3],
          structure_json: values[4],
          form_schema: values[5],
          co_creation_prompt: values[6],
          sample_snippets: values[7],
          created_at: values[8],
          updated_at: values[9],
        })
      }
    } else if (sqlLower.includes('delete from style_templates')) {
      const table = this.tables.get('style_templates')!
      table.rows = table.rows.filter((r: any) => r.id !== values[0])
    } else if (sqlLower.includes('insert or replace into user_articles')) {
      const table = this.tables.get('user_articles')!
      const existingIdx = table.rows.findIndex((r: any) => r.id === values[0])
      if (existingIdx >= 0) {
        table.rows[existingIdx] = {
          id: values[0],
          title: values[1],
          source_url: values[2],
          content: values[3],
          template_id: values[4],
          tags: values[5],
          created_at: values[6],
        }
      } else {
        table.rows.push({
          id: values[0],
          title: values[1],
          source_url: values[2],
          content: values[3],
          template_id: values[4],
          tags: values[5],
          created_at: values[6],
        })
      }
    } else if (sqlLower.includes('delete from user_articles')) {
      const table = this.tables.get('user_articles')!
      table.rows = table.rows.filter((r: any) => r.id !== values[0])
    } else if (sqlLower.includes('insert or replace into generated_drafts')) {
      const table = this.tables.get('generated_drafts')!
      const existingIdx = table.rows.findIndex((r: any) => r.id === values![0])
      if (existingIdx >= 0) {
        table.rows[existingIdx] = {
          id: values![0],
          template_id: values![1],
          mode: values![2],
          params_json: values![3],
          content_html: values![4],
          content_text: values![5],
          created_at: values![6],
        }
      } else {
        table.rows.push({
          id: values![0],
          template_id: values![1],
          mode: values![2],
          params_json: values![3],
          content_html: values![4],
          content_text: values![5],
          created_at: values![6],
        })
      }
    } else if (sqlLower.includes('insert into generated_drafts')) {
      const table = this.tables.get('generated_drafts')!
      table.rows.push({
        id: values![0],
        template_id: values![1],
        mode: values![2],
        params_json: values![3],
        content_html: values![4],
        content_text: values![5],
        created_at: values![6],
      })
    } else if (sqlLower.includes('delete from generated_drafts')) {
      const table = this.tables.get('generated_drafts')!
      const hasIdFilter = values && values.length > 0 && sqlLower.includes('id = ?')
      const hasModeFilter = sqlLower.includes('mode')

      if (hasIdFilter && hasModeFilter) {
        table.rows = table.rows.filter((r: any) => r.id !== values![0])
      } else if (hasModeFilter && sqlLower.includes('!=')) {
        // DELETE WHERE mode != 'some-value' — remove rows where mode IS NOT that value
        const modeNotMatch = sql.match(/mode\s*!=\s*['"](\S+)['"]/i)
        if (modeNotMatch) {
          const excludeMode = modeNotMatch[1]
          table.rows = table.rows.filter((r: any) => r.mode === excludeMode)
        }
      } else if (hasModeFilter && values && values.length > 0) {
        const modeValues = values
        table.rows = table.rows.filter((r: any) => !modeValues.includes(r.mode))
      } else if (hasIdFilter) {
        table.rows = table.rows.filter((r: any) => r.id !== values![0])
      } else {
        // DELETE without recognized WHERE — clear all rows
        table.rows = []
      }
    } else if (sqlLower.includes('insert') && sqlLower.includes('settings')) {
      const table = this.tables.get('settings')!
      const existingIdx = table.rows.findIndex((r: any) => r.key === values?.[0])
      if (existingIdx >= 0) {
        table.rows[existingIdx] = { key: values?.[0], value: values?.[1] }
      } else {
        table.rows.push({ key: values?.[0], value: values?.[1] })
      }
    } else if (sqlLower.includes('create table')) {
      // Ignore table creation - tables are pre-created
    }
  }

  async select<T>(sql: string, values?: any[]): Promise<T> {
    const sqlLower = sql.toLowerCase()

    if (sqlLower.includes('select') && sqlLower.includes('settings')) {
      const table = this.tables.get('settings')!
      return table.rows as T
    } else if (sqlLower.includes('select') && sqlLower.includes('style_templates')) {
      const table = this.tables.get('style_templates')!
      return table.rows as T
    } else if (sqlLower.includes('select') && sqlLower.includes('user_articles')) {
      const table = this.tables.get('user_articles')!
      return table.rows as T
    } else if (sqlLower.includes('select') && sqlLower.includes('generated_drafts')) {
      const table = this.tables.get('generated_drafts')!
      let result = table.rows

      if (sqlLower.includes('where') && values && values.length > 0) {
        const hasIdFilter = sqlLower.includes('id = ?')
        const hasModeFilter = sqlLower.includes('mode')
        const hasLikeFilter = sqlLower.includes('like ?')

        if (hasLikeFilter) {
          // LIKE-based keyword search (articleSearch)
          // params: [%t1%, %t2%, ...] — one per term, matching content_text only
          result = result.filter((r: any) => {
            for (let i = 0; i < values.length; i++) {
              const pattern = values[i].replace(/%/g, '')
              const content = (r.content_text || '').toLowerCase()
              const pat = pattern.toLowerCase()
              if (content.includes(pat)) {
                return true
              }
            }
            return false
          })
        }

        if (hasIdFilter && hasModeFilter) {
          // id = ? AND mode ...
          const idValue = values[0]
          const modeValues = values.slice(1)
          result = result.filter((r: any) => r.id === idValue && modeValues.includes(r.mode))
        } else if (hasModeFilter && !hasLikeFilter) {
          // mode = ? or mode IN (...)
          const modeValues = values
          result = result.filter((r: any) => modeValues.includes(r.mode))
        } else if (hasIdFilter) {
          result = result.filter((r: any) => r.id === firstValue)
        }
      }

      // Handle mode != 'generator-session' filter
      if (sqlLower.includes('mode') && sqlLower.includes('!=')) {
        const modeNotMatch = sql.match(/mode\s*!=\s*['"](\S+)['"]/i)
        if (modeNotMatch) {
          const excludeMode = modeNotMatch[1]
          result = result.filter((r: any) => r.mode !== excludeMode)
        }
      }

      // Handle ORDER BY created_at DESC
      if (sqlLower.includes('order by') && sqlLower.includes('created_at') && sqlLower.includes('desc')) {
        result.sort((a: any, b: any) => (b.created_at || 0) - (a.created_at || 0))
      }

      // Handle LIMIT
      const limitMatch = sql.match(/limit\s+(\d+)/i)
      if (limitMatch) {
        const limit = parseInt(limitMatch[1], 10)
        result = result.slice(0, limit)
      }

      return result as T
    }

    return [] as T
  }

  async close(): Promise<void> {}
}

export default MockDatabase

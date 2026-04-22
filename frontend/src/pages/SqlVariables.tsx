import { useEffect, useState } from 'react'
import { SqlApi, type SqlVariable, type DataSource } from '../api/sql'

type FormData = {
  name: string
  valueType: 'static' | 'sql'
  value: string
  datasourceId: string
}

const emptyForm: FormData = { name: '', valueType: 'static', value: '', datasourceId: '' }

export default function SqlVariables() {
  const [variables, setVariables] = useState<SqlVariable[]>([])
  const [datasources, setDatasources] = useState<DataSource[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [vars, ds] = await Promise.all([
        SqlApi.listVariables(),
        SqlApi.listDataSources(),
      ])
      setVariables(vars)
      setDatasources(ds)
    } catch {
      setError('加载变量列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('变量名不能为空'); return }
    if (!form.value.trim()) { setError('值不能为空'); return }
    if (form.valueType === 'sql' && !form.datasourceId) { setError('SQL 变量必须选择数据源'); return }

    setSaving(true)
    setError('')
    try {
      if (editingId) {
        await SqlApi.updateVariable(editingId, form)
      } else {
        await SqlApi.createVariable(form)
      }
      setForm(emptyForm)
      setEditingId(null)
      setShowForm(false)
      await load()
    } catch {
      setError('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (v: SqlVariable) => {
    setForm({ name: v.name, valueType: v.valueType, value: v.value, datasourceId: v.datasourceId })
    setEditingId(v.id)
    setShowForm(true)
    setError('')
  }

  const handleDelete = async (id: string) => {
    try {
      await SqlApi.deleteVariable(id)
      await load()
    } catch {
      setError('删除失败')
    }
  }

  const handleCancel = () => {
    setForm(emptyForm)
    setEditingId(null)
    setShowForm(false)
    setError('')
  }

  if (loading) return <div className="page"><p>加载中...</p></div>

  return (
    <div className="page">
      <div className="orch-page-header">
        <h1>SQL 变量</h1>
        <button
          className="chip primary"
          onClick={() => { handleCancel(); setShowForm(true) }}
        >
          + 新建变量
        </button>
      </div>

      <p className="sql-var-hint">
        在 SQL 文件中使用 <code>{'${变量名}'}</code> 引用变量，如：<code>{"SELECT * FROM table WHERE date = '${date_dt}'"}</code>
      </p>

      {showForm && (
        <div className="sql-var-form card">
          <h3>{editingId ? '编辑变量' : '新建变量'}</h3>
          {error && <div className="sql-var-error">{error}</div>}
          <div className="sql-var-form-grid">
            <div className="form-field">
              <label>变量名</label>
              <input
                type="text"
                placeholder="例如 date_dt"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>类型</label>
              <select
                value={form.valueType}
                onChange={(e) => setForm({ ...form, valueType: e.target.value as 'static' | 'sql' })}
              >
                <option value="static">静态值</option>
                <option value="sql">SQL 查询结果</option>
              </select>
            </div>
            <div className="form-field form-field-full">
              <label>值{form.valueType === 'sql' ? ' (SQL 查询语句，取第一行第一列)' : ''}</label>
              {form.valueType === 'sql' ? (
                <textarea
                  placeholder="SELECT column AS var_name FROM table WHERE ..."
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  rows={3}
                />
              ) : (
                <input
                  type="text"
                  placeholder="例如 2026-04-21"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              )}
            </div>
            {form.valueType === 'sql' && (
              <div className="form-field">
                <label>数据源</label>
                <select
                  value={form.datasourceId}
                  onChange={(e) => setForm({ ...form, datasourceId: e.target.value })}
                >
                  <option value="">选择数据源</option>
                  {datasources.map((ds) => (
                    <option key={ds.id} value={ds.id}>{ds.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="sql-var-form-actions">
            <button className="chip primary" onClick={handleSubmit} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </button>
            <button className="chip" onClick={handleCancel}>取消</button>
          </div>
        </div>
      )}

      {variables.length === 0 && !showForm ? (
        <div className="sql-var-empty card">
          <p>暂无变量，点击上方按钮创建</p>
        </div>
      ) : (
        <div className="sql-var-list">
          {variables.map((v) => {
            const ds = datasources.find((d) => d.id === v.datasourceId)
            return (
              <div key={v.id} className="sql-var-card card">
                <div className="sql-var-card-header">
                  <span className="sql-var-name">${'{'}
                    {v.name}
                    {'}'}</span>
                  <span className={`sql-var-type-badge ${v.valueType}`}>
                    {v.valueType === 'static' ? '静态值' : 'SQL 查询'}
                  </span>
                </div>
                <div className="sql-var-card-body">
                  {v.valueType === 'static' ? (
                    <div className="sql-var-value">{v.value}</div>
                  ) : (
                    <div className="sql-var-sql">
                      <code>{v.value}</code>
                      {ds && <span className="sql-var-ds-badge">{ds.name}</span>}
                    </div>
                  )}
                </div>
                <div className="sql-var-card-actions">
                  <button className="chip" onClick={() => handleEdit(v)}>编辑</button>
                  <button className="chip danger" onClick={() => handleDelete(v.id)}>删除</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

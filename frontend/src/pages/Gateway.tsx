import { useEffect, useState } from 'react'

const API_BASE = 'http://localhost:8388'

interface GatewayConfig {
  target_host: string
  target_port: string
  timeout: string
}

interface HealthStatus {
  status: string
  timestamp: number
}

type ServiceStatus = 'running' | 'stopped' | 'unknown'

export default function Gateway() {
  const [config, setConfig] = useState<GatewayConfig>({
    target_host: 'localhost',
    target_port: '8080',
    timeout: '30000',
  })
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('unknown')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 加载配置
  const loadConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/config`)
      const data = await res.json()
      if (data.config?.gateway) {
        setConfig({
          target_host: data.config.gateway.target_host || 'localhost',
          target_port: data.config.gateway.target_port || '8080',
          timeout: data.config.gateway.timeout || '30000',
        })
      }
    } catch {
      // 服务未启动
    }
  }

  // 检查健康状态
  const checkHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/health`)
      const data = await res.json()
      setHealth(data)
      setServiceStatus('running')
    } catch {
      setHealth(null)
      setServiceStatus('stopped')
    }
  }

  // 启动服务
  const startService = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/gateway/start', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: 'success', text: '✅ 网关服务启动成功' })
        await checkHealth()
      } else {
        setMessage({ type: 'error', text: `❌ 启动失败: ${data.error}` })
      }
    } catch (error) {
      setMessage({ type: 'error', text: `❌ 请求失败: ${error}` })
    }
    setLoading(false)
  }

  // 停止服务
  const stopService = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/gateway/stop', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: 'success', text: '✅ 网关服务已停止' })
        setServiceStatus('stopped')
        setHealth(null)
      } else {
        setMessage({ type: 'error', text: `❌ 停止失败: ${data.error}` })
      }
    } catch (error) {
      setMessage({ type: 'error', text: `❌ 请求失败: ${error}` })
    }
    setLoading(false)
  }

  // 保存配置
  const saveConfig = async () => {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/gateway/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: 'success', text: '✅ 配置已保存' })
      } else {
        setMessage({ type: 'error', text: `❌ 保存失败: ${data.error}` })
      }
    } catch (error) {
      setMessage({ type: 'error', text: `❌ 请求失败: ${error}` })
    }
    setLoading(false)
  }

  useEffect(() => {
    loadConfig()
    checkHealth()
    const interval = setInterval(checkHealth, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">⚙️ 网关配置</h1>
        <p className="text-gray-500 mt-1">管理网关服务的运行状态和配置</p>
      </div>

      {/* 服务状态卡片 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">服务状态</h2>
            <div className="flex items-center gap-2 mt-1">
              <span
                className={`w-3 h-3 rounded-full ${
                  serviceStatus === 'running' ? 'bg-green-500' :
                  serviceStatus === 'stopped' ? 'bg-red-500' : 'bg-gray-400'
                }`}
              />
              <span className="text-sm text-gray-600">
                {serviceStatus === 'running' ? '运行中' :
                 serviceStatus === 'stopped' ? '已停止' : '未知'}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={startService}
              disabled={loading || serviceStatus === 'running'}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
            >
              启动
            </button>
            <button
              onClick={stopService}
              disabled={loading || serviceStatus === 'stopped'}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
            >
              停止
            </button>
          </div>
        </div>

        {health && (
          <div className="text-sm text-gray-500">
            最后检查: {new Date(health.timestamp).toLocaleString('zh-CN')}
          </div>
        )}
      </div>

      {/* 配置表单 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">转发配置</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              目标主机
            </label>
            <input
              type="text"
              value={config.target_host}
              onChange={(e) => setConfig({ ...config, target_host: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="localhost"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              目标端口
            </label>
            <input
              type="text"
              value={config.target_port}
              onChange={(e) => setConfig({ ...config, target_port: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="8080"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              超时时间 (ms)
            </label>
            <input
              type="text"
              value={config.timeout}
              onChange={(e) => setConfig({ ...config, timeout: e.target.value })}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="30000"
            />
          </div>

          <button
            onClick={saveConfig}
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            保存配置
          </button>
        </div>
      </div>

      {/* 消息提示 */}
      {message && (
        <div className={`p-4 rounded ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}
    </div>
  )
}

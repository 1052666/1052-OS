import { useTheme } from '../theme-context'
import { useSettingsPageModel } from '../hooks/useSettingsPageModel'
import { MirrorPageWrapper } from './MirrorPageWrapper'
import { MirrorPageHeader } from './MirrorPageHeader'
import { MirrorButton } from './primitives'

/**
 * IU-9: 2-column console shell + save chip in the page header.
 * Left column (IU-10): LLM 接入 + 模型 Profile + 本地模型扫描 + 任务级推理路由
 * Right column (IU-11): Token 可视化 + Cache 与升级开销 + 来源与时间窗口
 */
export function MirrorSettings() {
  const { theme } = useTheme()
  const model = useSettingsPageModel()

  return (
    <MirrorPageWrapper
      header={
        <MirrorPageHeader
          title="设置"
          subtitle="左侧管理模型、图像生成、Agent 行为和外观；右侧查看 Token 使用与长期记忆摘要。"
          actions={
            <MirrorButton
              disabled={!model.isDirty || model.saveState === 'saving'}
              onClick={() => void model.save(theme)}
            >
              {model.saveState === 'saving' ? '保存中…' : '保存设置'}
            </MirrorButton>
          }
        />
      }
    >
      <div className="mr-settings-grid">
        <div className="mr-settings-col mr-settings-col-left">
          <div className="mr-settings-placeholder">IU-10 fills LLM 接入 + 模型 Profile + 本地模型扫描 + 任务级推理路由</div>
        </div>
        <div className="mr-settings-col mr-settings-col-right">
          <div className="mr-settings-placeholder">IU-11 fills Token 可视化面板 + Cache 与升级开销 + 来源与时间窗口</div>
        </div>
      </div>
    </MirrorPageWrapper>
  )
}

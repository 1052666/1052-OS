import { useEffect, useState } from 'react'
import { IconClose } from './Icons'

export type Profile = { name: string; avatar: string; bio: string }

type Props = {
  open: boolean
  profile: Profile
  onClose: () => void
  onSave: (p: Profile) => void
}

export default function ProfileModal({ open, profile, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(profile)

  useEffect(() => {
    if (open) setDraft(profile)
  }, [open, profile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const initial = draft.name.trim().charAt(0).toUpperCase() || '?'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">个人中心</div>
          <button className="icon-btn ghost" onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="profile-hero">
            <div className="profile-avatar">
              {draft.avatar ? (
                <img src={draft.avatar} alt="" />
              ) : (
                <span>{initial}</span>
              )}
            </div>
            <div className="profile-hero-info">
              <div className="profile-hero-name">{draft.name || '未命名'}</div>
              <div className="profile-hero-bio">{draft.bio || '未填写简介'}</div>
            </div>
          </div>

          <label className="field">
            <span>名称</span>
            <input
              className="settings-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="你的名字"
            />
          </label>

          <label className="field">
            <span>头像地址</span>
            <input
              className="settings-input"
              value={draft.avatar}
              onChange={(e) => setDraft({ ...draft, avatar: e.target.value })}
              placeholder="粘贴图片 URL,留空使用首字母"
            />
          </label>

          <label className="field">
            <span>简介</span>
            <textarea
              className="settings-input"
              rows={3}
              value={draft.bio}
              onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
              placeholder="一句话介绍自己"
            />
          </label>
        </div>

        <div className="modal-foot">
          <button className="chip ghost" onClick={onClose}>取消</button>
          <button className="chip primary" onClick={() => { onSave(draft); onClose() }}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

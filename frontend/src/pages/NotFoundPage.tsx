import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui'
import { PageBody, PageHeader } from './PageLayout'

export default function NotFoundPage() {
  const navigate = useNavigate()
  return <PageBody><PageHeader eyebrow="404" title="这个工作区不存在" description="当前地址没有对应的 1052 OS 页面。" actions={<Button variant="primary" onClick={() => navigate('/today')}>返回今日</Button>} /></PageBody>
}

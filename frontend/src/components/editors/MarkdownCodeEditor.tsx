import { markdown } from '@codemirror/lang-markdown'
import CodeMirror, { type ReactCodeMirrorProps } from '@uiw/react-codemirror'

type EditorProps = Pick<ReactCodeMirrorProps, 'height' | 'onChange' | 'theme' | 'value'>

export default function MarkdownCodeEditor({ height = '100%', ...props }: EditorProps) {
  return <CodeMirror {...props} height={height} extensions={[markdown()]} />
}

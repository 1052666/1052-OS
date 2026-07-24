import { sql as sqlLanguage } from '@codemirror/lang-sql'
import CodeMirror, { type ReactCodeMirrorProps } from '@uiw/react-codemirror'

type EditorProps = Pick<ReactCodeMirrorProps, 'basicSetup' | 'height' | 'onChange' | 'theme' | 'value'>

export default function SqlCodeEditor({ height = '100%', ...props }: EditorProps) {
  return <CodeMirror {...props} height={height} extensions={[sqlLanguage()]} />
}

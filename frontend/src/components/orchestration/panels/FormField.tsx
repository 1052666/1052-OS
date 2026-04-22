export function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="orch-drawer-field">
      <label className="orch-drawer-label">{label}</label>
      {children}
    </div>
  )
}

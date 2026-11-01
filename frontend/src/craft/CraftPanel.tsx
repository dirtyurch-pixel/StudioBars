import { useState } from 'react'
import { DnaTab } from './DnaTab'
import { FlowTab } from './FlowTab'
import { MelodyTab } from './MelodyTab'
import { PlanTab } from './PlanTab'
import { RecordTab } from './RecordTab'
import { ScanTab } from './ScanTab'
import type { CraftProps } from './shared'
import { TakesTab } from './TakesTab'
import { VaultTab } from './VaultTab'

const TABS = [
  ['flow', 'Flow'],
  ['takes', 'Takes'],
  ['vault', 'Vault'],
  ['plan', 'Plan'],
  ['scan', 'Scan'],
  ['dna', 'My style'],
  ['record', 'Record'],
  ['melody', 'Melody'],
] as const

export function CraftPanel(p: CraftProps) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('flow')
  return (
    <div className="ai-panel">
      <div className="chips" role="group" aria-label="Craft tools">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`chip-word${tab === id ? ' on' : ''}`}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'flow' && <FlowTab {...p} />}
      {tab === 'takes' && <TakesTab {...p} />}
      {tab === 'vault' && <VaultTab {...p} />}
      {tab === 'plan' && <PlanTab {...p} />}
      {tab === 'scan' && <ScanTab {...p} />}
      {tab === 'dna' && <DnaTab {...p} />}
      {tab === 'record' && <RecordTab {...p} />}
      {tab === 'melody' && <MelodyTab {...p} />}
    </div>
  )
}

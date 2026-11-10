export type Status = 'en-cours' | 'en-attente' | 'termine' | 'recycle'

export type StatusFilter = Status | 'tous' | 'aucun'

export type RemoteFilter = 'tous' | 'remote' | 'local'

export type KindFilter = 'tous' | 'job' | 'perso'

export type Entry = {
  sessionId: string
  hostId?: string
  label: string
  folder: string
  // null: flags set on a conversation that has no status yet.
  status: Status | null
  isRemote: boolean
  isPerso?: boolean
  updatedAt: number
}

// What the desktop app keeps about one of its conversations.
export type DesktopSession = {
  cliSessionId: string
  hostId: string
  title: string
  folder: string
  lastActivityAt: number
  isArchived: boolean
  // Ids the conversation had before a rewind or a fork moved it to a new one.
  priorCliSessionIds: string[]
  // The app's one-line summary of the last turn, and what it asks of the person.
  summary?: string
  attention?: 'blocked' | 'review_ready'
  pr?: { number: number; state: string }
}

declare module 'claude-code' {
  interface PluginState {
    'docket': {
      current: Shaped<Entry | null>
      all: Shaped<Entry[]>
      desktop: Shaped<DesktopSession[]>
      statusFilter: StatusFilter
      remoteFilter: RemoteFilter
      kindFilter: KindFilter
      // Bumped on each automatic refresh while the board is shown, so its ages redraw.
      tick: number
    }
  }
}

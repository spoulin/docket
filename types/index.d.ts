// A status id from the `statuses` option, or one of the defaults.
export type Status = string

// 'tous' for every status, or the ids of the groups to show ('aucun' for none).
export type StatusFilter = 'tous' | string[]

// How far back the statuses tab goes, by last activity.
export type Period = 'tout' | '1h' | '2h' | '3h' | '6h' | 'today' | '7d' | '30d'

// What a flag's filter keeps: every row, the rows with the flag set, or without it.
export type FlagFilter = 'tous' | 'oui' | 'non'

export type Entry = {
  sessionId: string
  hostId?: string
  label: string
  folder: string
  // null: flags set on a conversation that has no status yet.
  status: Status | null
  // The flags set on the conversation, by flag id; a flag not set is left out.
  flags: Record<string, boolean>
  // A free line the person wrote about the conversation: why it waits, what is next.
  note?: string
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
  // The branches the conversation committed on.
  branches?: { repo: string; branch: string }[]
  // When the person's last message came, while Claude has not ended the turn it started.
  turnStartedAt?: number
  // The conversation's Remote Control id (session_… or cse_…): claude.ai/code/<id> opens
  // it from any computer.
  remoteId?: string
}

// What git says of one branch: files changed on it, commits no remote has, and
// whether the default branch holds it (or its pull request was merged).
export type GitState = { isDirty: boolean; unpushed: number; isMerged: boolean }

// What another computer published in the sync folder: its conversations, their
// statuses and what its git said of their branches.
export type RemoteMachine = {
  machineId: string
  name: string
  sessions: DesktopSession[]
  entries: Entry[]
  git: Record<string, GitState>
}

declare module 'claude-code' {
  interface PluginState {
    'docket': {
      current: Shaped<Entry | null>
      all: Shaped<Entry[]>
      desktop: Shaped<DesktopSession[]>
      git: Record<string, GitState>
      // The other computers that share the sync folder.
      remote: Shaped<RemoteMachine[]>
      statusFilter: StatusFilter
      period: Period
      search: string
      // By flag id; a flag left out keeps every row.
      flagFilters: Record<string, FlagFilter>
      // Bumped on each automatic refresh while the board is shown, so its ages redraw.
      tick: number
    }
  }
}

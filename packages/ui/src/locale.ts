export const FLEET_LOCALE_NAMESPACE = 'dsh-agent-fleet'

export const fleetLocaleDictionaries = {
  zh: {
    'welcome.message': `欢迎使用 Agent Fleet。

你可以在这里：
- 了解 Fleet 的团队、成员与工作区如何协作
- 选择配置式或交互式引导来创建团队
- 连接已有团队，查看状态并继续工作

告诉我你想组建什么样的团队，或者直接问我 Agent Fleet 能做什么。`,
    'assistant.direct.role': '助理 Agent',
    'assistant.operator.name': '你',
    'assistant.operator.role': '外部用户',
    'assistant.empty': '发送一条消息，开始与 Agent Fleet 助理交流',
    'assistant.empty.team': '发送一条消息，开始与团队助理 {name} 交流',
    'assistant.responding': 'Agent Fleet 正在回复…',
    'assistant.loading': '正在载入私聊记录…',
    'assistant.loadOlder': '加载更早消息',
    'assistant.loadError': '暂时无法载入私聊记录',
    'assistant.resize': '调整消息区域宽度',
    'assistant.compose.placeholder': '发送私聊消息给团队助理',
    'assistant.compose.ready': '以外部观察者身份发送',
    'assistant.compose.sending': '发送中…',
    'assistant.compose.error': '消息发送失败',
    'assistant.compose.send': '发送消息',
  },
  en: {
    'welcome.message': `Welcome to Agent Fleet.

You can use this space to:
- Learn how Fleet Teams, members, and Workspaces work together
- Create a Team through configuration or an interactive guide
- Connect to an existing Team, review its status, and continue its work

Tell me what kind of Team you want to build, or ask what Agent Fleet can do.`,
    'assistant.direct.role': 'Assistant Agent',
    'assistant.operator.name': 'You',
    'assistant.operator.role': 'External user',
    'assistant.empty': 'Send a message to start chatting with the Agent Fleet assistant',
    'assistant.empty.team': 'Send a message to start chatting with Team assistant {name}',
    'assistant.responding': 'Agent Fleet is responding…',
    'assistant.loading': 'Loading private chat history…',
    'assistant.loadOlder': 'Load earlier messages',
    'assistant.loadError': 'Private chat history could not be loaded',
    'assistant.resize': 'Resize message area',
    'assistant.compose.placeholder': 'Send a private message to the Team assistant',
    'assistant.compose.ready': 'Send as the external observer',
    'assistant.compose.sending': 'Sending…',
    'assistant.compose.error': 'Message could not be sent',
    'assistant.compose.send': 'Send message',
  },
} as const

export type FleetLocaleKey = keyof typeof fleetLocaleDictionaries.zh

export interface FleetLocaleRuntime {
  getSnapshot(): { readonly revision: number }
  subscribe(listener: () => void): () => void
  register(namespace: string, dictionaries: typeof fleetLocaleDictionaries): () => void
  bind(namespace: string): (key: FleetLocaleKey) => string
}

export function resolveChineseLocale(documentLanguage: string, navigatorLanguage: string): boolean {
  return (documentLanguage.trim() || navigatorLanguage.trim()).toLowerCase().startsWith('zh')
}

export function isChineseLocale(): boolean {
  if (typeof document === 'undefined') return true
  const documentLanguage = document.documentElement.lang
  const navigatorLanguage = typeof navigator === 'undefined' ? '' : navigator.language
  return resolveChineseLocale(documentLanguage, navigatorLanguage)
}

export function selectedFleetLocale(): 'zh-CN' | 'en' {
  return isChineseLocale() ? 'zh-CN' : 'en'
}

export function fleetText(chinese: string, english: string): string {
  return isChineseLocale() ? chinese : english
}

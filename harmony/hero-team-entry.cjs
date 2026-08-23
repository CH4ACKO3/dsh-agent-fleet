'use strict'

const { component, element } = require('dsh-harmony-react')

const DSH_CLIENT_VERSION = '^0.1.0-rc.8 || >=0.1.1-rc.1 <0.1.2-0'

function replaceExactly(context, before, after) {
  const first = context.source.indexOf(before)
  if (first < 0 || context.source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`expected exactly one source fragment, found ${first < 0 ? 0 : 'more than one'}`)
  }
  context.edit.overwrite(first, first + before.length, after)
}

module.exports = [
  component({
    id: 'fleet-team-button',
    description: 'Adds a team creation action beside the native agent preset control.',
    target: {
      package: '@deepseek-ai/dsh-client-ui-agent-preset',
      version: DSH_CLIENT_VERSION,
      file: 'lib/client.js',
    },
    select: { name: 'AgentPresetSeat' },
    expect: 1,
    operation: {
      kind: 'decorate',
      with: {
        module: 'dsh-agent-fleet',
        export: 'withFleetTeamButton',
      },
    },
  }),
  {
    id: 'fleet-agent-session-scope',
    description: 'Lets the native session provider scope Fleet Agent context rendering to a member Session.',
    patches: [
      {
        id: 'fleet-agent-session-runtime-face',
        target: {
          package: '@deepseek-ai/dsh-client-runtime',
          version: DSH_CLIENT_VERSION,
          file: 'lib/client.js',
        },
        select: 'SourceFile',
        expect: 1,
        apply(context) {
          replaceExactly(
            context,
            'provideInfo: sessions.currentProvideInfo',
            'provideInfo: sessions.currentProvideInfo,\n\t\t\t\t\t\tresolveInfo: (sessionId) => sessions.provideInfo(sessionId)',
          )
        },
      },
      {
        id: 'fleet-agent-session-provider',
        target: {
          package: '@deepseek-ai/dsh-client-ui-renderer',
          version: DSH_CLIENT_VERSION,
          file: 'lib/client.js',
        },
        select: 'SourceFile',
        expect: 1,
        apply(context) {
          replaceExactly(
            context,
            `function SessionProvider({ empty, children }) {
\t\t\tconst info = observableHook(useHost().sessions.provideInfo)((s) => s);
\t\t\tconst id = info.sessionId;
\t\t\tif (id === void 0) return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: empty?.() ?? null });
\t\t\treturn (0, react_jsx_runtime.jsx)(BindingContext.Provider, {
\t\t\t\tvalue: info,
\t\t\t\tchildren: children(id)
\t\t\t}, id);
\t\t}`,
            `function SessionProvider({ empty, children, sessionId }) {
\t\t\tconst host = useHost();
\t\t\tconst current = observableHook(host.sessions.provideInfo)((s) => s);
\t\t\tconst info = sessionId === void 0 ? current : host.sessions.resolveInfo(sessionId);
\t\t\tconst id = info?.sessionId;
\t\t\tif (id === void 0) return (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: empty?.() ?? null });
\t\t\treturn (0, react_jsx_runtime.jsx)(BindingContext.Provider, {
\t\t\t\tvalue: info,
\t\t\t\tchildren: children(id)
\t\t\t}, id);
\t\t}`,
          )
        },
      },
    ],
  },
  component({
    id: 'fleet-composer-activation',
    description: 'Carries a staged Fleet mode through the native first composer submission.',
    target: {
      package: '@deepseek-ai/dsh-client-ui-conversation',
      version: DSH_CLIENT_VERSION,
      file: 'lib/client.js',
    },
    select: { name: 'InputBar' },
    expect: 1,
    operation: {
      kind: 'decorate',
      with: {
        module: 'dsh-agent-fleet',
        export: 'withFleetComposerActivation',
      },
    },
  }),
  component({
    id: 'fleet-native-agent-chat-view',
    description: 'Shares the native ChatView implementation with the Fleet Agent perspective without replacing its renderer slots.',
    target: {
      package: '@deepseek-ai/dsh-client-ui-conversation',
      version: DSH_CLIENT_VERSION,
      file: 'lib/client.js',
    },
    select: { name: 'ChatView' },
    expect: 1,
    operation: {
      kind: 'decorate',
      with: {
        module: 'dsh-agent-fleet',
        export: 'withFleetNativeChatView',
      },
    },
  }),
  component({
    id: 'fleet-global-empty-session-view',
    description: 'Makes the same global Fleet panel reachable from any Session, including an otherwise blank new Session.',
    target: {
      package: '@deepseek-ai/dsh-client-ui-conversation',
      version: DSH_CLIENT_VERSION,
      file: 'lib/client.js',
    },
    select: { name: 'ConversationSession' },
    expect: 1,
    operation: {
      kind: 'decorate',
      with: {
        module: 'dsh-agent-fleet',
        export: 'withFleetGlobalConversationView',
      },
    },
  }),
  {
    id: 'fleet-native-chat-runtime-primer',
    description: 'Primes the native ChatView runtime offscreen when a non-chat view is restored first.',
    target: {
      package: '@deepseek-ai/dsh-client-ui-conversation',
      version: DSH_CLIENT_VERSION,
      file: 'lib/client.js',
    },
    select: 'SourceFile',
    expect: 1,
    apply(context) {
      replaceExactly(
        context,
        `children: active !== void 0 && renderSlot("conversation.view", {
\t\t\t\t\tinspect,
\t\t\t\t\tonInspectDone: () => {
\t\t\t\t\t\tactions.setInspect(null);
\t\t\t\t\t}
\t\t\t\t}, { only: active.id })`,
        `children: [
\t\t\t\t\tactive?.id !== "chat" && (0, react_jsx_runtime.jsx)(require("dsh-agent-fleet").FleetNativeChatRuntimePrimer, {
\t\t\t\t\t\trenderSlot,
\t\t\t\t\t\tinspect,
\t\t\t\t\t\tonInspectDone: () => {
\t\t\t\t\t\t\tactions.setInspect(null);
\t\t\t\t\t\t}
\t\t\t\t\t}),
\t\t\t\t\tactive !== void 0 && renderSlot("conversation.view", {
\t\t\t\t\t\tinspect,
\t\t\t\t\t\tonInspectDone: () => {
\t\t\t\t\t\t\tactions.setInspect(null);
\t\t\t\t\t\t}
\t\t\t\t\t}, { only: active.id })
\t\t\t\t]`,
      )
    },
  },
  element({
    id: 'fleet-meta-assistant-header-entry',
    description: 'Adds the collapsed Fleet Help entry immediately before native Session search.',
    target: {
      package: '@deepseek-ai/dsh-client-ui-workspace',
      version: DSH_CLIENT_VERSION,
      file: 'lib/client.js',
    },
    select: {
      tsquery: 'CallExpression[expression.expression.right.name.name="jsx"]'
        + '[arguments.0.text="div"]'
        + '[arguments.1.properties.0.initializer.arguments.0.name.name="searchSlot"]',
    },
    expect: 1,
    operation: {
      kind: 'insert-before',
      with: {
        module: 'dsh-agent-fleet',
        export: 'FleetMetaAssistantHeaderButton',
      },
    },
  }),
  component({
    id: 'fleet-meta-assistant-established-conversation',
    description: 'Presents a blank Fleet Help Session as an established empty conversation instead of the new-Session Hero.',
    target: {
      package: '@deepseek-ai/dsh-client-ui-conversation',
      version: DSH_CLIENT_VERSION,
      file: 'lib/client.js',
    },
    select: { name: 'ConversationRoot' },
    expect: 1,
    operation: {
      kind: 'decorate',
      with: {
        module: 'dsh-agent-fleet',
        export: 'withFleetMetaConversationRoot',
      },
    },
  }),
  component({
    id: 'fleet-global-session-header',
    description: 'Keeps global view tabs reachable while the native new-Session Hero remains blank.',
    target: {
      package: '@deepseek-ai/dsh-client-ui-conversation',
      version: DSH_CLIENT_VERSION,
      file: 'lib/client.js',
    },
    select: { name: 'ConversationSessionHeader' },
    expect: 1,
    operation: {
      kind: 'decorate',
      with: {
        module: 'dsh-agent-fleet',
        export: 'withFleetGlobalConversationHeader',
      },
    },
  }),
  element({
    id: 'fleet-meta-assistant-pinned-session',
    description: 'Pins Fleet Help above the native Workspace and Session tree.',
    target: {
      package: '@deepseek-ai/dsh-client-ui-workspace',
      version: DSH_CLIENT_VERSION,
      file: 'lib/client.js',
    },
    select: {
      tsquery: 'CallExpression[expression.expression.right.name.name="jsx"]'
        + '[arguments.0.text="div"]'
        + '[arguments.1.properties.0.initializer.name.name="listArea"]',
    },
    expect: 1,
    operation: {
      kind: 'insert-before',
      with: {
        module: 'dsh-agent-fleet',
        export: 'FleetMetaAssistantPinnedRow',
      },
    },
  }),
  component({
    id: 'fleet-meta-assistant-hide-native-session',
    description: 'Keeps the dedicated Fleet Help Session out of the ordinary Session tree without archiving it.',
    target: {
      package: '@deepseek-ai/dsh-client-ui-workspace',
      version: DSH_CLIENT_VERSION,
      file: 'lib/client.js',
    },
    select: { name: 'WorkspaceBrowser' },
    expect: 1,
    operation: {
      kind: 'decorate',
      with: {
        module: 'dsh-agent-fleet',
        export: 'withFleetMetaWorkspaceBrowser',
      },
    },
  }),
]

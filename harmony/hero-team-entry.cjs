'use strict'

const { component, element } = require('dsh-harmony-react')

const DSH_CLIENT_VERSION = '>=0.1.5-0 <0.1.6-0'

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
    id: 'fleet-new-session-workspace-state',
    description: 'Passes the native Hero workspace state to Fleet before the first Session id exists.',
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
        'renderSlot("conversation.hero.agentPreset", {})',
        'renderSlot("conversation.hero.agentPreset", { sessionId, workspaceSelected: chipTitle !== void 0 })',
      )
    },
  },
  {
    id: 'fleet-agent-session-scope',
    description: 'Lets the native session provider scope Fleet Agent context rendering to a member Session.',
    target: {
      package: '@deepseek-ai/dsh-client-ui-renderer',
      version: DSH_CLIENT_VERSION,
      file: 'lib/client.js',
    },
    select: 'SourceFile',
    expect: 1,
    apply(context) {
      replaceExactly(context,
        'return renderArea(useScopeBinding(), props);',
        `const current = useScopeBinding();
        if (props.sessionId === void 0 && typeof props.children !== "function") return renderArea(current, props);
        const binding = props.sessionId === void 0 ? current : adapter.resolve(props.sessionId);
        const children = binding.key === void 0 ? null : typeof props.children === "function" ? props.children(binding.key) : props.children;
        return (0, react_jsx_runtime.jsx)(ScopeBindingContext.Provider, {
          value: binding,
          children: renderArea(binding, { ...props, children })
        }, binding.key);`);
    },
  },
  {
    id: 'fleet-native-budget-meter-seat',
    description: 'Lets Fleet conversations replace the native context meter without changing the native composer layout.',
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
        'function InputBar({ useSession, useInput, inputActions, keyboard, addFiles, removeAttachment, resolveDraftAttachments, retryFileUpload, toggleCommandMenu, stop, command, t, renderSlot, useBusyEnter, useFileUploads, useNotices, useLexicon, useMenuLauncher, useProjection, sessionId, variant, disabled: inert = false, blocked, workspacePickerOpen = false, onRequestWorkspace, placeholder, accessory }) {',
        'function InputBar({ useSession, useInput, inputActions, keyboard, addFiles, removeAttachment, resolveDraftAttachments, retryFileUpload, toggleCommandMenu, stop, command, t, renderSlot, useBusyEnter, useFileUploads, useNotices, useLexicon, useMenuLauncher, useProjection, sessionId, variant, disabled: inert = false, blocked, workspacePickerOpen = false, onRequestWorkspace, placeholder, usageMeter, accessory }) {',
      )
      replaceExactly(
        context,
        `(0, react_jsx_runtime.jsx)(ContextMeter, {
\t\t\t\t\t\t\t\t\t\t\tuseProjection,
\t\t\t\t\t\t\t\t\t\t\tt
\t\t\t\t\t\t\t\t\t\t})`,
        `usageMeter === void 0 ? (0, react_jsx_runtime.jsx)(ContextMeter, {
\t\t\t\t\t\t\t\t\t\t\tuseProjection,
\t\t\t\t\t\t\t\t\t\t\tt
\t\t\t\t\t\t\t\t\t\t}) : (0, react.cloneElement)(usageMeter, { Tooltip: _deepseek_ai_dsh_client_ui_primitives.Tooltip })`,
      )
    },
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
      package: '@deepseek-ai/dsh-client-ui-chat',
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
\t\t\t\t\tviewRequest,
\t\t\t\t\topenView,
\t\t\t\t\tcompleteViewRequest: actions.completeViewRequest
\t\t\t\t}, { only: active.id })`,
        `children: [
          active?.id !== "chat" && (0, react_jsx_runtime.jsx)(require("dsh-agent-fleet").FleetNativeChatRuntimePrimer, {
            renderSlot, viewRequest, openView, completeViewRequest: actions.completeViewRequest
          }),
          active !== void 0 && renderSlot("conversation.view", {
            viewRequest, openView, completeViewRequest: actions.completeViewRequest
          }, { only: active.id })
        ]`,
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

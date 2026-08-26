import type { ChangeEvent, FocusEvent, MouseEvent, ReactElement, ReactNode } from 'react'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

import {
  useFleetAnchoredPopover,
  type FleetAnchoredPopoverController,
  type FleetPopoverPlacement,
} from './anchored-popover.js'
import {
  FleetChatAvatar,
  FleetPresenceLabel,
  fleetMemberPresence,
  fleetMemberPresenceLabel,
  type FleetRuntimeMember,
} from './runtime-chat.js'
import { fleetText } from './locale.js'
import type { FleetOperatorProfileUpdate } from './operator-profile.js'

const MEMBER_POPOVER_CLOSE_DELAY_MS = 180
const MEMBER_AVATAR_MAX_BYTES = 2 * 1024 * 1024

export interface FleetMemberPopoverMember extends FleetRuntimeMember {
  readonly responsibility?: string
  readonly statusText?: string
  readonly statusUpdatedAt?: string
}

export interface FleetMemberPopoverTriggerProps {
  readonly 'aria-haspopup': 'dialog'
  readonly 'aria-expanded': boolean
  readonly 'aria-controls': string
  readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  readonly onMouseEnter?: (event: MouseEvent<HTMLButtonElement>) => void
  readonly onFocus?: (event: FocusEvent<HTMLButtonElement>) => void
  readonly onBlur?: (event: FocusEvent<HTMLButtonElement>) => void
}

export interface FleetMemberPopoverProps {
  readonly member: FleetMemberPopoverMember
  readonly mode?: 'click' | 'hover'
  readonly placement?: FleetPopoverPlacement
  readonly className?: string
  readonly as?: 'div' | 'span'
  readonly responsibility?: ReactNode
  readonly statusLabel?: string
  readonly showStatusText?: boolean
  readonly showDetails?: (memberId: string) => void
  readonly showContext?: (memberId: string) => void
  readonly editProfile?: (profile: FleetOperatorProfileUpdate) => void
  readonly onOpenChange?: (open: boolean) => void
  readonly trigger: (props: FleetMemberPopoverTriggerProps) => ReactElement
}

export interface FleetMemberPopoverCardProps {
  readonly member: FleetMemberPopoverMember
  readonly controller: FleetAnchoredPopoverController
  readonly responsibility?: ReactNode
  readonly statusLabel?: string
  readonly showStatusText?: boolean
  readonly showDetails?: (memberId: string) => void
  readonly showContext?: (memberId: string) => void
  readonly editProfile?: (profile: FleetOperatorProfileUpdate) => void
  readonly onMouseEnter?: () => void
  readonly onMouseLeave?: () => void
}

export function FleetMemberStatusUpdatedAt({ member }: {
  readonly member: Pick<FleetMemberPopoverMember, 'statusText' | 'statusUpdatedAt'>
}): ReactElement | null {
  if (member.statusText === undefined) return null
  const updatedAt = member.statusUpdatedAt
  if (updatedAt === undefined) {
    return jsx('span', {
      className: 'dsh-fleet-panel-member-status-updated',
      children: fleetText('更新时间未知', 'Update time unavailable'),
    })
  }
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) {
    return jsx('span', {
      className: 'dsh-fleet-panel-member-status-updated',
      children: fleetText('更新时间未知', 'Update time unavailable'),
    })
  }
  const compact = date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return jsx('time', {
    className: 'dsh-fleet-panel-member-status-updated',
    dateTime: updatedAt,
    title: date.toLocaleString(),
    children: fleetText(`更新于 ${compact}`, `Updated ${compact}`),
  })
}

export function FleetMemberPopoverCard({
  member,
  controller,
  responsibility = member.responsibility ?? member.role,
  statusLabel = fleetMemberPresenceLabel(member),
  showStatusText = false,
  showDetails,
  showContext,
  editProfile,
  onMouseEnter,
  onMouseLeave,
}: FleetMemberPopoverCardProps): ReactElement {
  const nameId = useId()
  const avatarInput = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<FleetOperatorProfileUpdate>(() => ({
    name: member.name,
    role: member.role,
    responsibility: typeof responsibility === 'string' ? responsibility : member.responsibility ?? '',
    ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
  }))
  const [editError, setEditError] = useState<string>()
  const presence = fleetMemberPresence(member)
  const actions = showDetails !== undefined || showContext !== undefined || editProfile !== undefined
  const beginEditing = (): void => {
    setDraft({
      name: member.name,
      role: member.role,
      responsibility: typeof responsibility === 'string' ? responsibility : member.responsibility ?? '',
      ...(member.avatarUrl === undefined ? {} : { avatarUrl: member.avatarUrl }),
    })
    setEditError(undefined)
    setEditing(true)
  }
  const selectAvatar = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file === undefined) return
    if (!file.type.startsWith('image/')) {
      setEditError(fleetText('请选择图片文件', 'Choose an image file'))
      return
    }
    if (file.size > MEMBER_AVATAR_MAX_BYTES) {
      setEditError(fleetText('头像图片不能超过 2 MiB', 'Avatar images must be 2 MiB or smaller'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      setDraft(current => ({ ...current, avatarUrl: reader.result as string }))
      setEditError(undefined)
    }
    reader.onerror = () => { setEditError(fleetText('无法读取这张图片', 'Could not read this image')) }
    reader.readAsDataURL(file)
  }
  const saveProfile = (): void => {
    if (editProfile === undefined) return
    try {
      editProfile(draft)
      setEditError(undefined)
      setEditing(false)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : fleetText('无法保存用户资料', 'Could not save the user profile'))
    }
  }
  return jsxs('div', {
    ref: controller.popover,
    id: controller.popoverId,
    popover: 'auto',
    className: 'dsh-fleet-panel-member-popover',
    role: 'dialog',
    'aria-labelledby': nameId,
    onMouseEnter,
    onMouseLeave,
    children: editing
      ? [
        jsxs('div', {
          className: 'dsh-fleet-panel-member-popover-editor-avatar',
          children: [
            jsx('button', {
              type: 'button',
              className: 'dsh-fleet-panel-member-popover-avatar-button',
              onClick: () => { avatarInput.current?.click() },
              'aria-label': fleetText('上传头像', 'Upload avatar'),
              children: jsx(FleetChatAvatar, { member: { ...member, ...draft }, size: 48, showPresence: false }),
            }),
            jsxs('div', { children: [
              jsx('button', {
                type: 'button',
                className: 'dsh-fleet-panel-member-popover-avatar-action',
                onClick: () => { avatarInput.current?.click() },
                children: fleetText('上传头像', 'Upload avatar'),
              }),
              draft.avatarUrl !== undefined && jsx('button', {
                type: 'button',
                className: 'dsh-fleet-panel-member-popover-avatar-action',
                onClick: () => { setDraft(current => {
                  const { avatarUrl: _avatarUrl, ...rest } = current
                  return rest
                }) },
                children: fleetText('移除', 'Remove'),
              }),
            ] }),
            jsx('input', {
              ref: avatarInput,
              className: 'dsh-fleet-panel-member-popover-avatar-input',
              type: 'file',
              accept: 'image/*',
              onChange: selectAvatar,
            }),
          ],
        }),
        jsxs('label', { className: 'dsh-fleet-panel-member-popover-field', children: [
          jsx('span', { children: fleetText('名称', 'Name') }),
          jsx('input', { value: draft.name, maxLength: 60, onChange: (event: ChangeEvent<HTMLInputElement>) => {
            const value = event.currentTarget.value
            setDraft(current => ({ ...current, name: value }))
          } }),
        ] }),
        jsxs('label', { className: 'dsh-fleet-panel-member-popover-field', children: [
          jsx('span', { children: fleetText('角色', 'Role') }),
          jsx('input', { value: draft.role, maxLength: 80, onChange: (event: ChangeEvent<HTMLInputElement>) => {
            const value = event.currentTarget.value
            setDraft(current => ({ ...current, role: value }))
          } }),
        ] }),
        jsxs('label', { className: 'dsh-fleet-panel-member-popover-field', children: [
          jsx('span', { children: fleetText('简介', 'Description') }),
          jsx('textarea', { value: draft.responsibility, maxLength: 400, rows: 4, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
            const value = event.currentTarget.value
            setDraft(current => ({ ...current, responsibility: value }))
          } }),
        ] }),
        editError !== undefined && jsx('div', { className: 'dsh-fleet-panel-member-popover-edit-error', role: 'alert', children: editError }),
        jsxs('div', { className: 'dsh-fleet-panel-member-popover-edit-actions', children: [
          jsx('button', { type: 'button', onClick: () => { setEditing(false); setEditError(undefined) }, children: fleetText('取消', 'Cancel') }),
          jsx('button', { type: 'button', 'data-primary': 'true', disabled: draft.name.trim() === '' || draft.role.trim() === '', onClick: saveProfile, children: fleetText('保存', 'Save') }),
        ] }),
      ]
      : [
      jsxs('header', {
        className: 'dsh-fleet-panel-member-popover-head',
        children: [
          jsx(FleetChatAvatar, { member: { ...member, presence }, size: 42 }),
          jsxs('div', {
            className: 'dsh-fleet-panel-member-popover-copy',
            children: [
              jsx('div', { id: nameId, className: 'dsh-fleet-panel-member-popover-name', children: member.name }),
              jsx('div', { className: 'dsh-fleet-panel-member-popover-role', children: member.role }),
            ],
          }),
        ],
      }),
      jsx('p', { className: 'dsh-fleet-panel-member-popover-responsibility', children: responsibility }),
      jsx('div', {
        className: 'dsh-fleet-panel-member-popover-status',
        'data-status': presence,
        children: jsx(FleetPresenceLabel, { presence, label: statusLabel }),
      }),
      showStatusText && jsxs('div', {
        className: 'dsh-fleet-panel-member-popover-self-status',
        'data-empty': member.statusText === undefined ? 'true' : undefined,
        children: [
          jsxs('div', {
            className: 'dsh-fleet-panel-member-popover-self-status-head',
            children: [
              jsx('div', { className: 'dsh-fleet-panel-member-popover-self-status-label', children: fleetText('成员自述', 'Member update') }),
              jsx(FleetMemberStatusUpdatedAt, { member }),
            ],
          }),
          jsx('p', {
            className: 'dsh-fleet-panel-member-popover-self-status-text',
            children: member.statusText ?? fleetText('暂未填写工作状态', 'No work update yet'),
          }),
        ],
      }),
      actions && jsxs('div', {
        className: 'dsh-fleet-panel-member-popover-actions',
        children: [
          showDetails !== undefined && jsx('button', {
            type: 'button',
            className: 'dsh-fleet-panel-member-popover-detail',
            onClick: () => {
              controller.close()
              showDetails(member.id)
            },
            children: fleetText('详细信息', 'Details'),
          }),
          showContext !== undefined && jsx('button', {
            type: 'button',
            className: 'dsh-fleet-panel-member-popover-detail',
            onClick: () => {
              controller.close()
              showContext(member.id)
            },
            children: fleetText('上下文', 'Context'),
          }),
          editProfile !== undefined && jsx('button', {
            type: 'button',
            className: 'dsh-fleet-panel-member-popover-detail',
            onClick: beginEditing,
            children: fleetText('编辑资料', 'Edit profile'),
          }),
        ],
      }),
    ],
  })
}

export function FleetMemberPopover({
  member,
  mode = 'click',
  placement = 'below-start',
  className,
  as = 'div',
  responsibility = member.responsibility ?? member.role,
  statusLabel = fleetMemberPresenceLabel(member),
  showStatusText = false,
  showDetails,
  showContext,
  editProfile,
  onOpenChange,
  trigger,
}: FleetMemberPopoverProps): ReactElement {
  const controller = useFleetAnchoredPopover(placement, 8, onOpenChange)
  const closeTimer = useRef<number>()
  const cancelClose = (): void => {
    if (closeTimer.current === undefined) return
    window.clearTimeout(closeTimer.current)
    closeTimer.current = undefined
  }
  const closeSoon = (): void => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined
      controller.close()
    }, MEMBER_POPOVER_CLOSE_DELAY_MS)
  }
  useEffect(() => cancelClose, [])
  const interaction: FleetMemberPopoverTriggerProps = mode === 'hover'
    ? {
        'aria-haspopup': 'dialog',
        'aria-expanded': controller.open,
        'aria-controls': controller.popoverId,
        onMouseEnter: event => {
          cancelClose()
          controller.openAt(event.currentTarget)
        },
        onFocus: event => { controller.openAt(event.currentTarget) },
        onBlur: event => {
          if (event.relatedTarget instanceof Node && controller.popover.current?.contains(event.relatedTarget) === true) return
          cancelClose()
          controller.close()
        },
      }
    : {
        'aria-haspopup': 'dialog',
        'aria-expanded': controller.open,
        'aria-controls': controller.popoverId,
        onClick: event => { controller.toggleAt(event.currentTarget) },
      }
  const children = [
    trigger(interaction),
    controller.mounted && jsx(FleetMemberPopoverCard, {
      member,
      controller,
      responsibility,
      statusLabel,
      showStatusText,
      ...(showDetails === undefined ? {} : { showDetails }),
      ...(showContext === undefined ? {} : { showContext }),
      ...(editProfile === undefined ? {} : { editProfile }),
      ...(mode === 'hover' ? { onMouseEnter: cancelClose, onMouseLeave: closeSoon } : {}),
    }),
  ]
  if (as === 'span') return jsxs(Fragment, { children })
  return jsxs('div', {
    ...(className === undefined ? {} : { className }),
    ...(mode === 'hover' ? { onMouseLeave: closeSoon } : {}),
    children,
  })
}

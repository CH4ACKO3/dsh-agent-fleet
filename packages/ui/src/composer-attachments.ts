import type { ChangeEvent as ReactChangeEvent, ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

import { fleetText } from './locale.js'

const STYLE_ID = 'dsh-agent-fleet-composer-attachments'

const styles = `
.dsh-fleet-official-composer-actions {
  min-width: 0;
  align-items: center;
  gap: 6px;
  display: inline-flex;
}

.dsh-fleet-assistant-composer-attachment-dropzone [class*="_tools"],
.dsh-fleet-official-composer [class*="_tools"] {
  gap: 6px;
}

.dsh-fleet-assistant-composer-attachment-dropzone [class*="_modes"]:empty,
.dsh-fleet-official-composer [class*="_modes"]:empty,
.dsh-fleet-assistant-composer-attachment-dropzone [class*="_modes"]:has(> [data-slot="conversation.input.plan"]:empty),
.dsh-fleet-official-composer [class*="_modes"]:has(> [data-slot="conversation.input.plan"]:empty) {
  display: none;
}

.dsh-fleet-official-attach-wrap {
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  display: inline-grid;
}

.dsh-fleet-official-attach {
  width: 28px;
  height: 28px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 999px;
  place-items: center;
  padding: 0;
  display: grid;
}

.dsh-fleet-official-attach:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-official-attach:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-official-attach:disabled {
  cursor: default;
  opacity: .5;
}

.dsh-fleet-assistant-composer-attachment-dropzone [data-composer-card="true"]:has(.dsh-fleet-panel-composer-files),
.dsh-fleet-official-composer [data-composer-card="true"]:has(.dsh-fleet-panel-composer-files) {
  gap: 8px;
}

.dsh-fleet-assistant-composer-attachment-dropzone [data-composer-card="true"]:has(.dsh-fleet-panel-composer-files) > [class*="_row"],
.dsh-fleet-official-composer [data-composer-card="true"]:has(.dsh-fleet-panel-composer-files) > [class*="_row"] {
  order: 2;
}

.dsh-fleet-panel-composer-files {
  width: auto;
  min-width: 0;
  order: 1;
  align-self: stretch;
  flex-wrap: nowrap;
  gap: 6px;
  margin: 0 12px;
  padding: 1px 0;
  display: flex;
  overflow-x: auto;
  scrollbar-width: none;
}

.dsh-fleet-panel-composer-files::-webkit-scrollbar {
  display: none;
}

.dsh-fleet-panel-composer-file {
  min-width: 0;
  max-width: min(100%, 220px);
  height: 26px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 8px;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 2px 3px 2px 7px;
  font: var(--dsw-font-xs-13);
  display: flex;
}

.dsh-fleet-panel-composer-file-name {
  min-width: 0;
  color: var(--dsw-alias-label-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.dsh-fleet-panel-composer-file-size {
  flex: none;
  font-size: 11px;
}

.dsh-fleet-panel-composer-file-remove {
  width: 22px;
  height: 22px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 7px;
  flex: none;
  place-items: center;
  padding: 0;
  display: grid;
}

.dsh-fleet-panel-composer-file-remove:hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-fleet-panel-composer-file-remove:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-fleet-panel-composer-file-input {
  display: none;
}
`

function installStyles(): void {
  if (typeof document === 'undefined') return
  let style = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${STYLE_ID}"]`)
  if (style === null) {
    style = document.createElement('style')
    style.dataset.pluginCss = STYLE_ID
    document.head.append(style)
  }
  style.textContent = styles
}

installStyles()

export interface FleetComposerAttachment {
  readonly kind: 'image'
  readonly id: string
  readonly file: File
  readonly image: boolean
  readonly previewUrl: string
}

export interface FleetComposerAttachments {
  readonly files: readonly File[]
  readonly items: readonly FleetComposerAttachment[]
  readonly imageItems: readonly FleetComposerAttachment[]
  readonly documentItems: readonly FleetComposerAttachment[]
  readonly addFiles: (files: FileList | readonly File[]) => void
  readonly removeFile: (id: string) => void
  readonly clearFiles: () => void
  readonly fileInput: { readonly current: HTMLInputElement | null }
}

export function fleetComposerFilePath(file: File): string {
  const path = (file as File & { readonly path?: string }).path?.trim()
  if (path === undefined || path.length === 0) {
    throw new Error(fleetText(
      `无法读取 ${file.name} 的本机路径`,
      `Could not read the local path for ${file.name}`,
    ))
  }
  return path
}

export function fleetComposerMessageText(text: string, files: readonly File[]): string {
  const body = text.trim()
  if (files.length === 0) return body
  const paths = files.map(file => `- ${fleetComposerFilePath(file)}`).join('\n')
  const attachments = `${fleetText('文件路径：', 'File paths:')}\n${paths}`
  return body.length === 0 ? attachments : `${body}\n\n${attachments}`
}

function fileId(file: File): string {
  return `${file.name}\0${String(file.size)}\0${String(file.lastModified)}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentIcon({ close = false }: { readonly close?: boolean }): ReactElement {
  const common = {
    width: close ? 13 : 15,
    height: close ? 13 : 15,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.55,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': 'true',
  }
  return jsx('svg', {
    ...common,
    children: close
      ? jsx('path', { d: 'm5.5 5.5 9 9m0-9-9 9' })
      : jsxs('g', {
          children: [
            jsx('path', { d: 'M10 12.7V3.5M6.6 6.6 10 3.2l3.4 3.4' }),
            jsx('path', { d: 'M4 14.8v1.3h12v-1.3' }),
          ],
        }),
  })
}

export function useFleetComposerAttachments(resetKey: string): FleetComposerAttachments {
  const fileInput = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<readonly File[]>([])
  const items = useMemo(() => files.map(file => {
    const image = file.type.startsWith('image/')
    return {
      kind: 'image' as const,
      id: fileId(file),
      file,
      image,
      previewUrl: image ? URL.createObjectURL(file) : '',
    }
  }), [files])

  useEffect(() => { setFiles([]) }, [resetKey])
  useEffect(() => () => {
    for (const item of items) {
      if (item.previewUrl !== '') URL.revokeObjectURL(item.previewUrl)
    }
  }, [items])

  const addFiles = (added: FileList | readonly File[]): void => {
    const next = Array.from(added)
    if (next.length === 0) return
    setFiles(current => {
      const known = new Set(current.map(fileId))
      return [...current, ...next.filter(file => {
        const id = fileId(file)
        if (known.has(id)) return false
        known.add(id)
        return true
      })]
    })
  }

  return {
    files,
    items,
    imageItems: items.filter(item => item.image),
    documentItems: items.filter(item => !item.image),
    addFiles,
    removeFile: id => { setFiles(current => current.filter(file => fileId(file) !== id)) },
    clearFiles: () => { setFiles([]) },
    fileInput,
  }
}

export function FleetComposerAttachmentButton({ attachments, disabled = false }: {
  readonly attachments: FleetComposerAttachments
  readonly disabled?: boolean
}): ReactElement {
  return jsxs('span', {
    className: 'dsh-fleet-official-attach-wrap',
    children: [
      jsx('input', {
        ref: attachments.fileInput,
        className: 'dsh-fleet-panel-composer-file-input',
        type: 'file',
        multiple: true,
        onChange: (event: ReactChangeEvent<HTMLInputElement>) => {
          if (event.currentTarget.files !== null) attachments.addFiles(event.currentTarget.files)
          event.currentTarget.value = ''
        },
      }),
      jsx('button', {
        type: 'button',
        className: 'dsh-fleet-official-attach',
        disabled,
        'aria-label': fleetText('添加文件附件', 'Add file attachments'),
        title: fleetText('添加文件附件', 'Add file attachments'),
        onClick: () => { attachments.fileInput.current?.click() },
        children: jsx(AttachmentIcon, {}),
      }),
    ],
  })
}

export function FleetComposerAttachmentList({ attachments }: {
  readonly attachments: FleetComposerAttachments
}): ReactElement | null {
  if (attachments.documentItems.length === 0) return null
  return jsx('div', {
    className: 'dsh-fleet-panel-composer-files',
    children: attachments.documentItems.map(item => jsxs('span', {
      className: 'dsh-fleet-panel-composer-file',
      children: [
        jsx('span', { className: 'dsh-fleet-panel-composer-file-name', title: item.file.name, children: item.file.name }),
        jsx('span', { className: 'dsh-fleet-panel-composer-file-size', children: formatFileSize(item.file.size) }),
        jsx('button', {
          type: 'button',
          className: 'dsh-fleet-panel-composer-file-remove',
          'aria-label': fleetText(`移除附件 ${item.file.name}`, `Remove attachment ${item.file.name}`),
          title: fleetText('移除附件', 'Remove attachment'),
          onClick: () => { attachments.removeFile(item.id) },
          children: jsx(AttachmentIcon, { close: true }),
        }),
      ],
    }, item.id)),
  })
}

/* ------------------------------------------------------------------ */
/*  CoordinationEventBridge + EventSubscriptions                        */
/*                                                                     */
/*  Extracted from FleetCollaborationService.open() — the               */
/*  messages.onEvent handler that routes coordination events, plus      */
/*  the factory that removes remaining inline event closures in the     */
/*  stops array (resources.onEvent, memberStatuses.onEvent).           */
/*                                                                     */
/*  Follows the same dependency-injection factory pattern as            */
/*  createToolBinding and createTaskSync.                              */
/* ------------------------------------------------------------------ */

import type { FleetMessage, FleetCoordinationEvent } from '@dsh-agent-fleet/message'
import type { FleetMemberStatusEvent } from '@dsh-agent-fleet/core'
import type { FleetResourceEvent } from '@dsh-agent-fleet/resources'
import type { FleetCalendar } from './productivity/calendar.js'
import type { FleetMemberView } from './member-view.js'
import type { FleetTeamEventBus } from './team-event-bus.js'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CoordinationEventBridgeDependencies {
  /** Aggregated event bus — used for onCoordination forwarding. */
  readonly eventBus: FleetTeamEventBus

  /** Create or ensure Reply Tasks for an incoming message. */
  readonly ensureMessageTasks: (message: FleetMessage) => string[]

  /** Sync a member's unread inbox into their Inbox Task. */
  readonly syncMemberInbox: (member: string) => void

  /** Fleet calendar instance for closing linked meetings. */
  readonly calendar: FleetCalendar

  /** Current member views, used to enumerate all members for sync. */
  readonly memberViews: ReadonlyMap<string, FleetMemberView>
}

/* ------------------------------------------------------------------ */
/*  Bridge                                                             */
/* ------------------------------------------------------------------ */

export class CoordinationEventBridge {
  constructor(private readonly deps: CoordinationEventBridgeDependencies) {}

  /**
   * Handle one Fleet coordination event.  Called from the
   * messages.onEvent subscription installed in open().
   */
  onCoordinationEvent(event: FleetCoordinationEvent): void {
    this.deps.eventBus.onCoordination(event)

    if (event.type === 'message') {
      this.deps.ensureMessageTasks(event.message)
      for (const member of this.deps.memberViews.keys()) {
        this.deps.syncMemberInbox(member)
      }
      return
    }

    if (event.type === 'inbox' && (event.action === 'read'
      || (event.action === 'delivered' && event.content === 'full'))) {
      this.deps.syncMemberInbox(event.agentId)
      return
    }

    if (event.type === 'meeting' && event.action === 'closed') {
      this.deps.calendar.closeLinkedMeeting(event.meeting.id, event.meeting.closedAt)
      return
    }
  }
}

/* ------------------------------------------------------------------ */
/*  EventSubscriptions factory                                         */
/*                                                                     */
/*  Provides named references for the three previously-inline event     */
/*  subscriptions in FleetCollaborationService.open()'s stops array.   */
/*  Follows the same factory pattern as createProductiveEventHandlers   */
/*  and createTaskSync.                                                */
/* ------------------------------------------------------------------ */

export interface EventSubscriptions {
  readonly onCoordinationEvent: (event: FleetCoordinationEvent) => void
  readonly onResourceEvent: (event: FleetResourceEvent) => void
  readonly onMemberStatusEvent: (event: FleetMemberStatusEvent) => void
}

export function createEventSubscriptions(
  onCoordination: (event: FleetCoordinationEvent) => void,
  eventBus: FleetTeamEventBus,
): EventSubscriptions {
  return {
    onCoordinationEvent: onCoordination,
    onResourceEvent: eventBus.onResource.bind(eventBus),
    onMemberStatusEvent: eventBus.onMemberStatus.bind(eventBus),
  }
}

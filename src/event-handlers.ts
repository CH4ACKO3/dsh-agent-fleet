/* ------------------------------------------------------------------ */
/*  ProductiveEventHandlers — task/schedule/calendar onEvent closures  */
/*                                                                     */
/*  Extracted from FleetCollaborationService.open() — the three inline */
/*  onEvent closures for FleetTaskBoard, FleetScheduler, and           */
/*  FleetCalendar. Separated for testability and readability.          */
/*                                                                     */
/*  Follows the same dependency-injection factory pattern as            */
/*  createTaskSync and CoordinationEventBridge.                        */
/* ------------------------------------------------------------------ */

import type { FleetSystemNotificationKind } from '@dsh-agent-fleet/message'

import type {
  FleetCalendarEventChange,
  FleetCalendarState,
} from './productivity/calendar.js'
import type {
  FleetScheduledTaskEvent,
  FleetScheduleState,
} from './productivity/schedule.js'
import type {
  FleetProjectTaskEvent,
  FleetTaskBoard,
} from './productivity/task.js'
import type { ToolBindingManager } from './tool-binding.js'
import type { FleetTeamEventBus } from './team-event-bus.js'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ProductiveEventHandlersDependencies {
  /** Aggregated event bus — used for onTask/onSchedule/onCalendar forwarding. */
  readonly eventBus: FleetTeamEventBus

  /** FleetTaskBoard instance — provides state() and is used by ensureFleetTaskTool. */
  readonly tasks: FleetTaskBoard

  /** FleetScheduler instance — provides state(). */
  readonly scheduler: { state(): FleetScheduleState }

  /** FleetCalendar instance — provides state(). */
  readonly calendar: { state(): FleetCalendarState }

  /** ToolBindingManager — used to ensure Fleet task tools for reply-task assignees. */
  readonly toolManager: ToolBindingManager

  /** notifyMembers — broadcasts system notifications to team members. */
  readonly notifyMembers: (
    members: readonly string[],
    text: string,
    kind: FleetSystemNotificationKind,
    coalesceKey: string,
    delivery?: 'quiet' | 'wakeup',
  ) => string[]
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createProductiveEventHandlers(deps: ProductiveEventHandlersDependencies) {
  const { eventBus, tasks, scheduler, calendar, toolManager, notifyMembers } = deps

  /** Handle one FleetProjectTask event. */
  function onTaskEvent(event: FleetProjectTaskEvent): void {
    eventBus.onTask(event, tasks.state())
    if (event.task.domain.kind === 'reply') toolManager.ensureFleetTaskTool(event.task.domain.assignee)
    const initialRequiredTask = event.action === 'created' && event.task.domain.kind === 'reply'
    if (event.task.domain.kind !== 'interaction' && event.task.domain.kind !== 'inbox'
      && event.action !== 'due' && event.action !== 'notification' && !initialRequiredTask) {
      const recipients = [
        ...(event.action === 'created' ? [] : event.task.assignees),
        ...event.task.reviewers,
        ...event.task.followers,
      ]
        .filter(member => member !== event.actor)
      const requiredTaskNotice = event.action === 'completed'
        ? `[Fleet required task completed] ${event.task.title} (${event.task.id}). No further completion action is required.`
        : `[Fleet Reply Task ${event.action}] ${event.task.title} (${event.task.id}). After the work is done, call fleet_reply with this id and the response content.`
      notifyMembers(
        recipients,
        event.task.domain.kind !== 'reply'
          ? `[Fleet task ${event.action}] ${event.task.title} (${event.task.id})`
          : requiredTaskNotice,
        'task_notice',
        `task:${event.task.id}`,
        'quiet',
      )
    }
  }

  /** Handle one FleetScheduledTask event. */
  function onScheduleEvent(event: FleetScheduledTaskEvent): void {
    eventBus.onSchedule(event, scheduler.state())
    if (event.action !== 'triggered' && event.action !== 'notification') {
      notifyMembers(
        event.task.assignees.filter(member => member !== event.actor),
        `[Fleet schedule ${event.action}] ${event.task.title} (${event.task.id})`,
        'schedule_notice',
        `schedule:${event.task.id}`,
      )
    }
  }

  /** Handle one FleetCalendar event. */
  function onCalendarEvent(event: FleetCalendarEventChange): void {
    eventBus.onCalendar(event, calendar.state())
    const recipients = [event.event.organizer, ...event.event.attendees].filter(member => member !== event.actor)
    notifyMembers(
      recipients,
      `[Fleet calendar ${event.action}] ${event.event.title} (${event.event.id})`,
      'calendar_notice',
      `calendar:${event.event.id}`,
    )
  }

  return { onTaskEvent, onScheduleEvent, onCalendarEvent }
}
/* ------------------------------------------------------------------ */
/*  FleetTeamEventBus — aggregated event contract                      */
/*                                                                     */
/*  Aggregates the 6 individual callback parameters from               */
/*  OpenFleetCollaborationTeamInput into a single interface.           */
/*  Keeps FleetRunService and FleetCollaborationService connected      */
/*  through one explicit dependency rather than parallel callbacks.    */
/* ------------------------------------------------------------------ */

import type { FleetCoordinationEvent } from '@dsh-agent-fleet/message'
import type { FleetResourceEvent } from '@dsh-agent-fleet/resources'
import type { FleetMemberStatusEvent } from '@dsh-agent-fleet/core'
import type { FleetCalendarEventChange, FleetCalendarState } from './productivity/calendar.js'
import type { FleetScheduledTaskEvent, FleetScheduleState } from './productivity/schedule.js'
import type { FleetProjectTaskEvent, FleetTaskState } from './productivity/task.js'

/**
 * Single-interface contract between FleetRunService and
 * FleetCollaborationService.  Replaces the 6 inline callback
 * closures that were previously passed as individual fields in
 * OpenFleetCollaborationTeamInput.
 *
 * An implementation is typically provided by FleetRunService or by
 * a test spy / mock.
 */
export interface FleetTeamEventBus {
  onCoordination(event: FleetCoordinationEvent): void
  onResource(event: FleetResourceEvent): void
  onMemberStatus(event: FleetMemberStatusEvent): void
  onTask(event: FleetProjectTaskEvent, state: FleetTaskState): void
  onSchedule(event: FleetScheduledTaskEvent, state: FleetScheduleState): void
  onCalendar(event: FleetCalendarEventChange, state: FleetCalendarState): void
}

/** Noop bus for use by test fixtures that don't exercise event callbacks. */
export const NOOP_FLEET_TEAM_EVENT_BUS: FleetTeamEventBus = {
  onCoordination: () => {},
  onResource: () => {},
  onMemberStatus: () => {},
  onTask: () => {},
  onSchedule: () => {},
  onCalendar: () => {},
}

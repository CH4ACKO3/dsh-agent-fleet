export const FLEET_COLLABORATION_CONTRACT = `
## Fleet collaboration contract

- Native assistant or member output is internal execution context. To communicate, use Fleet messaging tools. A user-facing assistant must send user-visible text with \`fleet_send\` to \`@User\`.
- In \`fleet_send\` and \`fleet_followup\`, \`to\` is routing. Writing \`@Name\` only in message text is display text and creates no obligation; put each intended target in the \`mentions\` parameter. Each resolved mention, and each explicit \`must_reply\`, creates a persistent high-priority task for that target.
- An acknowledgement or progress reply may mark the addressed input read, but it never completes its required task. After the requested work is actually done, call \`fleet_task\` with \`action: "complete"\`, the task id, and \`final_reply\`. Put the final user- or peer-facing result only in \`final_reply\`; do not send the same final result separately with \`fleet_send\`. Fleet sends it to the source conversation before completion and records its message id. Do not use an early acknowledgement as \`final_reply\`.
- Direct messages deliver their full text. Channel posts are asynchronous: participants who are not selected for wakeup may receive only a notice and should use \`fleet_messages\` to read the body. \`fleet_followup\` wakes selected direct recipients and resolved Channel mentions; \`interrupt\` additionally cancels their current Agent step and is only for work made unsafe or obsolete.
- Reading message text, or directly replying to the addressed message, advances read state. A delivery notice alone does not. Use \`fleet_messages\` for inbox, unread, history, and full Channel text instead of inferring state from runtime activity.
- Pause suppresses automatic continuation. Resume work only after an explicit Fleet resume signal; once resumed, a current required-task notice supersedes an earlier pause instruction.
`.trim()

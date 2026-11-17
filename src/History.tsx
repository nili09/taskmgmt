import type { EventRecord } from "../shared/model";
import { formatDay, formatTime } from "./dates";
import { describeEvent } from "./ledger";

/** The ledger: time, person, what changed, and for an edit what it was and what it became. */
export default function History({
  events,
  nameFor,
  itemText,
  taskTitle,
}: {
  events: EventRecord[];
  nameFor: (email: string) => string;
  itemText: (id: string) => string;
  taskTitle?: (e: EventRecord) => string;
}) {
  let day = "";
  return (
    <div className="ledger">
      {events.map((e) => {
        const heading = formatDay(e.server_at);
        const newDay = heading !== day;
        day = heading;
        return (
          <div key={e.seq}>
            {newDay && <h3 className="ledger-day">{heading}</h3>}
            {describeEvent(e, nameFor, itemText).map((line, i) => (
              <div className="ledger-line" key={i}>
                <span className="tnum ledger-time">{i === 0 ? formatTime(e.server_at) : ""}</span>
                <span className="ledger-who">{i === 0 ? nameFor(e.actor_email) : ""}</span>
                <span className="ledger-what">
                  {taskTitle && <span className="ledger-task">{taskTitle(e)}: </span>}
                  {line.what}
                  {line.to !== undefined && (
                    <>
                      {line.from !== undefined ? (
                        <>
                          {" "}
                          <span className="ledger-was">{line.from}</span> → {line.to}
                        </>
                      ) : (
                        <> set to {line.to}</>
                      )}
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

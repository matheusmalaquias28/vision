import React, { useCallback, useEffect, useRef, useState } from "react";
import { listNotifications, markNotificationsRead, type Notification } from "../api";
import { Icon } from "../editor/Icon";
import { useDismiss } from "../ui/controls";
import { fmtDateTime } from "./demandUtil";

interface NotificationBellProps {
  onOpenDemand: (id: string) => void;
}

const BASE_TITLE = "VISION";

/** Sino com as notificações (novas demandas, comentários do War); atualiza a cada 20s */
export const NotificationBell: React.FC<NotificationBellProps> = ({ onOpenDemand }) => {
  const [data, setData] = useState<{ unread: number; items: Notification[] }>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const lastUnread = useRef(0);

  const load = useCallback(() => {
    listNotifications()
      .then((d) => {
        setData(d);
        lastUnread.current = d.unread;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 20_000);
    // a gaveta da demanda marca as dela como lidas e avisa por este evento
    window.addEventListener("vision:notifications", load);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("vision:notifications", load);
    };
  }, [load]);

  useEffect(() => {
    document.title = data.unread > 0 ? `(${data.unread}) ${BASE_TITLE}` : BASE_TITLE;
  }, [data.unread]);

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className={`icon ghost bell ${data.unread > 0 ? "has" : ""}`}
        title="Notificações"
        aria-label={`Notificações${data.unread ? ` (${data.unread} novas)` : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={16} />
        {data.unread > 0 && <span className="bell-count">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      {open && (
        <div className="popover bell-pop">
          <div className="bell-head">
            <span>Notificações</span>
            {data.unread > 0 && (
              <button
                className="sm ghost"
                onClick={async () => {
                  await markNotificationsRead();
                  load();
                }}
              >
                Marcar todas como lidas
              </button>
            )}
          </div>
          {data.items.length === 0 ? (
            <p className="bell-empty">Nada por aqui ainda.</p>
          ) : (
            data.items.map((n) => (
              <button
                key={n.id}
                className={`bell-item ${n.readAt ? "" : "unread"}`}
                onClick={async () => {
                  setOpen(false);
                  onOpenDemand(n.demandId);
                  await markNotificationsRead(n.demandId);
                  load();
                }}
              >
                <Icon name={n.kind === "note" ? "chat" : "board"} size={14} />
                <span className="bell-text">
                  <strong>{n.title}</strong>
                  {n.body && <span>{n.body}</span>}
                  <time dateTime={n.createdAt}>{fmtDateTime(n.createdAt)}</time>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

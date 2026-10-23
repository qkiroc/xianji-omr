"use client";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { upsertToast } from "../../shared/toast-state";
import { createPortal } from "react-dom";
function messageText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? messageText(child.props.children)
          : "",
    )
    .join(" ")
    .trim();
}
type Notice = {
  owner: string;
  text: string;
  content: ReactNode;
  expires: number;
};
export function ErrorToast({ children }: { children: ReactNode }) {
  const owner = useId();
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("omr-toast", {
        detail: { owner, text: messageText(children), content: children },
      }),
    );
  }, [owner, children]);
  useEffect(
    () => () => {
      window.dispatchEvent(
        new CustomEvent("omr-toast-clear", { detail: owner }),
      );
    },
    [owner],
  );
  return null;
}
export function ToastHost() {
  const [notices, setNotices] = useState<Notice[]>([]),
    [mounted, setMounted] = useState(false);
  const dismissed = useRef(new Set<string>());
  const dismiss = (n: Notice) => {
    dismissed.current.add(n.owner + n.text);
    setNotices((old) => old.filter((x) => x.owner !== n.owner));
  };
  useEffect(() => {
    setMounted(true);
    const update = (e: Event) => {
      const n = (e as CustomEvent<Omit<Notice, "expires">>).detail;
      if (!n.text) {
        setNotices((old) => old.filter((x) => x.owner !== n.owner));
        for (const key of dismissed.current)
          if (key.startsWith(n.owner)) dismissed.current.delete(key);
        return;
      }
      if (dismissed.current.has(n.owner + n.text)) return;
      setNotices((old) => upsertToast(old, n, dismissed.current, Date.now()));
    };
    const clear = (e: Event) => {
      const owner = (e as CustomEvent<string>).detail;
      setNotices((old) => old.filter((x) => x.owner !== owner));
      for (const key of dismissed.current)
        if (key.startsWith(owner)) dismissed.current.delete(key);
    };
    window.addEventListener("omr-toast", update);
    window.addEventListener("omr-toast-clear", clear);
    return () => {
      window.removeEventListener("omr-toast", update);
      window.removeEventListener("omr-toast-clear", clear);
    };
  }, []);
  useEffect(() => {
    if (!notices.length) return;
    const timer = setTimeout(
      () => {
        const now = Date.now();
        for (const n of notices)
          if (n.expires <= now) dismissed.current.add(n.owner + n.text);
        setNotices((old) => old.filter((x) => x.expires > now));
      },
      Math.max(0, Math.min(...notices.map((n) => n.expires)) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [notices]);
  return mounted
    ? createPortal(
        <div className="toast-stack" aria-label="消息提示">
          {notices.map((n) => (
            <div className="toast-error" role="alert" key={n.owner}>
              <span className="toast-mark" aria-hidden="true">
                !
              </span>
              <div className="toast-content">{n.content}</div>
              <button aria-label="关闭提示" onClick={() => dismiss(n)}>
                ×
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )
    : null;
}

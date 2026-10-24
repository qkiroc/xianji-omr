"use client";
import { Dialog, Button } from "./ui/antd";
import { ErrorToast } from "./ui/toast";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { api, LayoutDocument } from "../shared/client";
import { legacyTarget } from "../shared/routes";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
type Guard = { dirty: boolean; save: () => Promise<void> };
const Context = createContext<{
  go: (href: string, replace?: boolean, onNavigate?: () => void) => void;
  guard: (g: Guard | null) => void;
}>({ go: () => {}, guard: () => {} });
export function NavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter(),
    path = usePathname(),
    query = useSearchParams();
  const state = useRef<Guard | null>(null),
    pending = useRef<null | (() => void)>(null);
  const [open, setOpen] = useState(false),
    [error, setError] = useState("");
  const previous = useRef(""),
    index = useRef(0),
    reverting = useRef(false),
    replaceRoute = useRef(false);
  const attempt = useCallback((fn: () => void) => {
    if (state.current?.dirty) {
      pending.current = fn;
      setError("");
      setOpen(true);
    } else fn();
  }, []);
  const go = useCallback(
    (href: string, replace = false, onNavigate?: () => void) =>
      attempt(() => {
        onNavigate?.();
        replaceRoute.current = replace;
        replace ? router.replace(href) : router.push(href);
      }),
    [attempt, router],
  );
  useEffect(() => {
    const target = path + (query.size ? "?" + query : "");
    if (!previous.current) {
      previous.current = target;
      index.current = Number(history.state?.omrIndex || 0);
      history.replaceState(
        { ...history.state, omrIndex: index.current },
        "",
        target + window.location.hash,
      );
    } else if (target !== previous.current) {
      if (replaceRoute.current || history.state?.omrReplace) {
        replaceRoute.current = false;
        history.replaceState(
          { ...history.state, omrReplace: false, omrIndex: index.current },
          "",
          target + window.location.hash,
        );
      } else if (
        history.state?.omrIndex === index.current ||
        history.state?.omrIndex === undefined
      ) {
        index.current++;
        history.replaceState(
          { ...history.state, omrIndex: index.current },
          "",
          target + window.location.hash,
        );
      } else index.current = history.state.omrIndex;
      previous.current = target;
    }
  }, [path, query]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (state.current?.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const pop = (e: PopStateEvent) => {
      if (reverting.current) {
        reverting.current = false;
        return;
      }
      const targetIndex = Number(e.state?.omrIndex ?? index.current - 1),
        delta = targetIndex - index.current;
      if (!state.current?.dirty || !delta) return;
      e.stopImmediatePropagation();
      reverting.current = true;
      history.go(-delta);
      pending.current = () => {
        state.current = null;
        history.go(delta);
      };
      setError("");
      setOpen(true);
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", pop, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", pop, true);
    };
  }, []);
  const guard = useCallback((value: Guard | null) => {
    state.current = value;
  }, []);
  return (
    <Context.Provider
      value={{ go, guard }}
    >
      {children}
      {open && (
        <Dialog>
          <section role="dialog" aria-label="未保存修改" className="modal">
            <h2>有未保存修改</h2>
            <p>内容仅在当前页面。请保存到服务端，或明确放弃。</p>
            <ErrorToast>{error}</ErrorToast>
            <div className="actions">
              <Button
                onClick={() => {
                  pending.current = null;
                  setOpen(false);
                }}
              >
                留在本页
              </Button>
              <Button
                onClick={() => {
                  state.current = null;
                  setOpen(false);
                  pending.current?.();
                  pending.current = null;
                }}
              >
                放弃修改并继续
              </Button>
              <Button
                onClick={async () => {
                  try {
                    await state.current?.save();
                    state.current = null;
                    setOpen(false);
                    pending.current?.();
                    pending.current = null;
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "保存失败");
                  }
                }}
              >
                保存后继续
              </Button>
            </div>
          </section>
        </Dialog>
      )}
    </Context.Provider>
  );
}
export const useNavigation = () => useContext(Context);
export function useDirty(dirty: boolean, save: () => Promise<void>) {
  const { guard } = useNavigation();
  useEffect(() => {
    guard({ dirty, save });
    return () => guard(null);
  }, [dirty, save, guard]);
}
export function LegacyHash({ root = false }: { root?: boolean }) {
  const { go } = useNavigation(),
    [error, setError] = useState("");
  useEffect(() => {
    const incoming = location.hash || window.__omrLegacyHash;
    if (!incoming) {
      if (root) go("/datasets", true);
      return;
    }
    let active = true;
    const migrate = async () => {
      const hash = new URLSearchParams(incoming.slice(1));
      const page = hash.get("pageId");
      const resolved =
        page && !hash.get("datasetId")
          ? await api<LayoutDocument>("/v2/pages/" + encodeURIComponent(page))
          : undefined;
      const target = legacyTarget(incoming, resolved?.image);
      if (active) {
        window.__omrLegacyHash = undefined;
        go(target, true);
      }
    };
    void migrate().catch((e) =>
      setError(e instanceof Error ? e.message : "旧链接无法恢复"),
    );
    return () => {
      active = false;
    };
  }, [go, root]);
  return error ? <ErrorToast>{error}</ErrorToast> : null;
}

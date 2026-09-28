import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";

const PageTopbarContext = createContext<{
  target: HTMLDivElement | null;
  setTarget: Dispatch<SetStateAction<HTMLDivElement | null>>;
} | null>(null);

/** Route-owned actions render in the shell's title bar, not a second page header. */
export function PageTopbarProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  return (
    <PageTopbarContext.Provider value={{ target, setTarget }}>
      {children}
    </PageTopbarContext.Provider>
  );
}
export function PageTopbarSlot() {
  const context = useContext(PageTopbarContext);
  return (
    <div
      ref={context?.setTarget}
      className="flex min-w-0 flex-1 items-center"
    />
  );
}
export function PageTopbar({ children }: { children: ReactNode }) {
  const context = useContext(PageTopbarContext);
  return context?.target ? createPortal(children, context.target) : null;
}

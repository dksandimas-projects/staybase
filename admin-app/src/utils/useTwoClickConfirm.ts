import { useCallback, useEffect, useState } from "react";

const DEFAULT_RESET_MS = 3000;

export function useTwoClickConfirm<T extends string = string>(resetMs: number = DEFAULT_RESET_MS) {
  const [pending, setPending] = useState<T | null>(null);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), resetMs);
    return () => clearTimeout(timer);
  }, [pending, resetMs]);

  const arm = useCallback((id: T): boolean => {
    if (pending === id) {
      setPending(null);
      return true;
    }
    setPending(id);
    return false;
  }, [pending]);

  const cancel = useCallback(() => setPending(null), []);

  return { pending, arm, cancel, isPending: (id: T) => pending === id };
}

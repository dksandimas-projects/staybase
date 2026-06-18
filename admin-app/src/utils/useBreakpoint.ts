import { useEffect, useState } from "react";

const MOBILE_MAX = 768;
const TABLET_MAX = 1024;
const MOBILE_LANDSCAPE_HEIGHT = 500;

const SSR_FALLBACK_WIDTH = 1440;
const SSR_FALLBACK_HEIGHT = 900;

export interface BreakpointState {
  width: number;
  height: number;
  isMobile: boolean;
  isMobileLandscape: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

const isSSR = typeof window === "undefined";

function derive(width: number, height: number): BreakpointState {
  const isMobile = width < MOBILE_MAX;
  return {
    width,
    height,
    isMobile,
    isMobileLandscape: isMobile && height < MOBILE_LANDSCAPE_HEIGHT,
    isTablet: width >= MOBILE_MAX && width < TABLET_MAX,
    isDesktop: width >= TABLET_MAX
  };
}

function getInitial(): BreakpointState {
  if (isSSR) return derive(SSR_FALLBACK_WIDTH, SSR_FALLBACK_HEIGHT);
  return derive(window.innerWidth, window.innerHeight);
}

export function useBreakpoint(): BreakpointState {
  const [state, setState] = useState<BreakpointState>(getInitial);

  useEffect(() => {
    if (isSSR) return;

    const onResize = () => {
      setState(derive(window.innerWidth, window.innerHeight));
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return state;
}

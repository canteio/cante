import type { Viewport } from "next";

// This page is light; without an explicit theme-color, mobile browsers
// (Safari, Chrome, in-app browsers like Telegram's) default the address-bar
// and system-UI tint to black, which reads as a black bar around the page.
// client page.tsx components can't export route segment config, so this
// server layout carries it instead.
export const viewport: Viewport = {
  themeColor: "#fafafa",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}

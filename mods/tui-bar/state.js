// Agent status as simple coloured dots: yellow (pulsing) working, red needs you,
// green done, grey idle. Colors from the theme.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";

export function stateMark(t, status, size = 12) {
  const box = (el) => h_flex().w(16).h(16).flex_none().items_center().justify_center().child(el);
  const dot = (c) => div().size(8).rounded_full().bg(c);
  if (status === "working") return box(dot(t.working).loop("opacity", { from: 0.6, to: 1, period: 1200 }));
  if (status === "blocked") return box(dot(t.blocked));
  if (status === "done") return box(dot(t.done));
  if (status === "idle") return box(dot(t.dim));
  return box(div());
}

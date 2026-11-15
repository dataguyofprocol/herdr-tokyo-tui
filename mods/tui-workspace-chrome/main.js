import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, focused } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

function clock() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default class WorkspaceChrome extends View {
  init(_props, cx) {
    if (!props()?.footer) return;
    this.time = clock();
    cx.timer.every(15000, (cx) => { const now = clock(); if (now !== this.time) { this.time = now; cx.notify(); } });
  }

  button(id, label, action) {
    const t = theme();
    // A bracketed key cell: [/] search, [«] fold.
    return h_flex().id(id).h(22).px(3).flex_none().items_center().justify_center().text_color(t.dim).cursor_pointer()
      .w(24).text_size(16)
      .hover(s => s.bg(t.raised).text_color(t.accent))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).children(Array.isArray(label) ? label : [label]);
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      // Remember the tab shown before this one, for the tmux prefix's C-a ^ (last tab).
      const ft = focused()?.tab;
      if (ft && ft !== this.tab) { if (this.tab) setShared("tmux.last-tab", this.tab); this.tab = ft; }
      // Just settings: a gear and the word, a size up; Add machine lives in the palette.
      const ready = div().size(6).rounded_full().bg(t.accent);
      return h_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(4).items_center()
        .child(h_flex().id("settings").h_full().px(8).gap(8).items_center().cursor_pointer()
          .when(collapsed, el => el.relative().w(32).px(0).justify_center().tooltip("Settings"))
          .gap(6)
          // Passive: small and dim until hovered, so the eye doesn't land here.
          .text_color(t.dim).opacity(0.7).hover(s => s.opacity(1.0).text_color(t.muted))
          .on_click(() => run("app.settings"))
          .child(svg("mods/tui-workspace-chrome/settings.svg").size(12))
          .when(!collapsed, el => el.child(div().text_size(11).child("settings")))
          .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(5).right(6) : ready)))
        .when(!collapsed, el => el.child(div().flex_1()).child(div().pr(8).text_size(11).text_color(t.dim).opacity(0.7).child(this.time)));
    }
    return h_flex().size_full().bg(t.chrome).border_b(1).border_color(t.border).pl(collapsed ? 6 : 12).pr(8).gap(2).items_center().text_size(12.5)
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      // The wordmark: IBM VGA pixel font (fonts/, shipped with this mod) and a blinking block cursor.
      .when(!collapsed, el => el.child(h_flex().flex_1().min_w(0).items_center()
        .child(div().font_family("PxPlus IBM VGA 8x16").text_size(22).text_color(t.accent).child("herdr"))
        .child(div().font_family("PxPlus IBM VGA 8x16").text_size(22).text_color(t.accent).frames(["█", " "], 530))))
      .when(!collapsed, el => el.child(this.button("search", div().text_size(19).font_bold().mt(-2).child("⌕"), () => run("mod.open", { name: "picker" })).tooltip("Find a space (⌘P)")))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", div().text_size(14).child(collapsed ? "◨" : "◧"), toggleSidebar).tooltip("Fold sidebar (⌘B)")));
  }
}

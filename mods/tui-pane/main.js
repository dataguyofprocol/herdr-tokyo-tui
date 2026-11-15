// tokyo-tui pane header: ┤ ● name ├─ ~/dir ──────── [│][─][z][x]
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { stateMark } from "./state.js";
import { panes, props, run, theme, spaces } from "herdr";

export default class TuiPane extends View {
  init() { this.hovered = false; }

  render() {
    const t = theme();
    const p = panes().find((x) => x.pane === props()?.pane);
    if (!p) return div();
    const pane = p.pane;
    const edge = p.focused ? t.accent : t.border;
    // A plain shell says nothing here: its prompt, the tab and the status bar already show
    // where it is. An agent shows its chat name; an app or TUI (nvim, lazygit) its title.
    const prog = p.program?.name || "shell";
    const title = (p.title || "").replace(/^[^\p{L}\p{N}~/.]+/u, "").trim();
    const plain = Boolean(p.program?.shell) && !p.status;
    // An agent the tab is named after shows that name, so tab and header agree.
    const tab = spaces().flatMap((s) => s.tabs).find((x) => x.id === p.tab);
    const agentsHere = panes().filter((x) => x.tab === p.tab && x.program?.agent).length;
    const name = plain ? null : p.program?.agent
      ? (tab?.named && agentsHere === 1 ? tab.name : title && title !== prog ? title : prog)
      : prog;
    const show = p.focused || this.hovered; // buttons only where you're looking
    const btn = (id, icon, tip, command, args, danger) =>
      div().id(id).flex_none().size(15).flex().items_center().justify_center().cursor_pointer()
        .text_color(t.dim).opacity(p.focused ? 0.9 : 0.6).tooltip(tip)
        .hover((s) => s.bg(danger ? t.blocked : t.raised).text_color(danger ? t.accent_foreground : t.accent))
        .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
        .child(svg(`mods/pane/${icon}.svg`).size(10));

    return h_flex().id(`tp-${pane}`).size_full().px(6).gap(6).items_center()
      .bg(p.focused ? t.popover : t.chrome).text_size(11)
      .on_hover((h, cx) => { this.hovered = h; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .child(div().w(6).h(1).flex_none().bg(edge))
      .when(Boolean(name), (el) => el
        .when(Boolean(p.status), (el) => el.child(stateMark(t, p.status, 11)))
        .child(div().flex_shrink(1).min_w(0).truncate().font_semibold().text_color(p.focused ? t.accent : t.dim).child(name)))
      // A plain shell: just its name, dim, so the header never looks empty.
      .when(!name, (el) => el.child(div().flex_none().text_color(t.dim).child(prog)))
      .child(div().flex_1().min_w(8).h(1).bg(edge))
      .when(p.zoomed, (el) => el.child(div().flex_none().text_color(t.ansi5).child("[Z]")))
      .when(show, (el) => el.child(h_flex().flex_none().gap(2).items_center()
        .child(btn(`tp-r-${pane}`, "split-right", "Split right", "pane.split", { direction: "right", pane }))
        .child(btn(`tp-d-${pane}`, "split-down", "Split down", "pane.split", { direction: "down", pane }))
        .child(btn(`tp-z-${pane}`, p.zoomed ? "unzoom" : "zoom", p.zoomed ? "Unzoom" : "Zoom", "pane.zoom", { pane }))
        .child(btn(`tp-x-${pane}`, "close", "Close pane", "pane.close", { pane }, true))));
  }
}

// tmux-style prefix for Herdr, from ~/.tmux.conf: ctrl-a opens this, the next key runs a command.
// Herdr's keys.json has no multi-key sequences, so the prefix is a tiny popup that takes the
// keyboard, reads one key, acts and closes. Esc (or any unbound key) cancels.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, focused, shared, hc } from "herdr";

// key (as typed) -> [label, action]
const MAP = {
  h: ["pane ←", () => run("pane.go", { direction: "left" })],
  j: ["pane ↓", () => run("pane.go", { direction: "down" })],
  k: ["pane ↑", () => run("pane.go", { direction: "up" })],
  l: ["pane →", () => run("pane.go", { direction: "right" })],
  "%": ["split │", () => run("pane.split", { direction: "right" })],
  '"': ["split ─", () => run("pane.split", { direction: "down" })],
  x: ["kill pane", () => run("pane.close")],
  z: ["zoom", () => run("pane.zoom")],
  "{": ["swap ←", () => run("pane.swap", { direction: "left" })],
  "}": ["swap →", () => run("pane.swap", { direction: "right" })],
  c: ["new tab", () => run("tab.new")],
  n: ["next tab", () => run("tab.next")],
  p: ["prev tab", () => run("tab.prev")],
  "^": ["last tab", () => { const id = shared("tmux.last-tab"); if (id) run("tab.select", { id }); }],
  ",": ["rename tab", () => run("tab.rename")],
  "&": ["kill tab", () => run("tab.close")],
  "(": ["prev space", () => run("space.prev")],
  ")": ["next space", () => run("space.next")],
  $: ["rename space", () => run("space.rename")],
  v: ["split │", () => run("pane.split", { direction: "right" })],
  s: ["split ─", () => run("pane.split", { direction: "down" })],
  // The space picker: Space is the quickest reach, f for "find", w as in tmux's choose-tree.
  " ": ["spaces", () => run("mod.open", { name: "picker" })],
  f: ["spaces", () => run("mod.open", { name: "picker" })],
  w: ["spaces", () => run("mod.open", { name: "picker" })],
  ":": ["commands", () => run("app.palette")],
  "?": ["this list", () => openOverlay({ mod: "tmux-prefix", kind: "popup", at: "top", offset: 40, width: 560, height: 176, props: { help: true } })],
  "ctrl-a": ["send C-a", () => { const t = focused()?.terminal; if (t) hc(["send", t, "\u0001"]); }],
};
MAP.space = MAP[" "]; // in case the space bar reports its name rather than its character
for (let i = 1; i <= 9; i++) MAP[String(i)] = [`tab ${i}`, () => run("tab.select", { index: i })];
const ARROWS = { left: "h", down: "j", up: "k", right: "l" };
const SHOWN = [" ", "f", "h", "j", "k", "l", "v", "s", "x", "z", "c", "n", "p", "^", ",", "&", "(", ")", ":", "?"];

export default class TmuxPrefix extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The terminal under the popup can keep the keyboard for a frame or two:
    // keep asking until this panel really has it, then say so.
    this.tries = 0;
    this.poll = cx.timer.every(40, (cx) => {
      const has = this.handle.is_focused();
      if (!has && this.tries++ < 25) this.handle.focus();
      if (has !== this.listening) { this.listening = has; cx.notify(); }
    });
  }

  key(e, cx) {
    cx.stop_propagation();
    if (props()?.help) { if (!["shift", "control", "alt", "platform"].includes(e.key)) closeOverlay(props().overlay); return; }
    const m = e.modifiers ?? {};
    const name = e.keystroke === "ctrl-a" ? "ctrl-a"
      : ARROWS[e.key] && !m.control && !m.platform ? ARROWS[e.key]
      : (!m.control && !m.platform && !m.alt ? e.key_char ?? e.key : null);
    if (e.key === "shift" || e.key === "control" || e.key === "alt" || e.key === "platform") return; // a lone modifier
    closeOverlay(props().overlay);
    const hit = name && MAP[name];
    if (hit) hit[1]();
  }

  render() {
    const t = theme();
    // Pressing C-a shows only a small badge while it waits; C-a ? shows the full list.
    if (!props()?.help) return h_flex().id("tmux-prefix").size_full().track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .items_center().justify_center().text_size(11.5).font_bold()
      .bg(this.listening ? t.accent : t.blocked).text_color(t.accent_foreground)
      .child(this.listening ? "C-a" : "C-a ✕");
    const cap = (k) => h_flex().gap(5).items_center().w(124)
      .child(div().flex_none().min_w(16).px(3).bg(t.raised).text_color(t.accent).font_semibold().child(k === " " ? "␣" : k))
      .child(div().truncate().text_color(t.muted).child(MAP[k][0]));
    return v_flex().id("tmux-prefix").size_full().track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .bg(t.popover).border_1().border_color(t.accent).text_size(11.5)
      .child(h_flex().h(22).px(6).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().px(5).bg(t.accent).text_color(t.accent_foreground).font_bold().child("C-a"))
        .child(div().flex_1().h(1).bg(t.border))
        .child(div().text_color(t.dim).child("any key closes · 1-9 tabs")))
      .child(div().p(8).flex().flex_wrap().gap_y(4).children(SHOWN.map(cap)));
  }
}

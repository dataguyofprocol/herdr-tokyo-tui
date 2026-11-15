// tokyo-tui bottom bar. One rule: quiet things are icons, things that need you are words.
//   left : agents that need you, as chips (words)            → click jumps, ⌘] walks them
//   right: alerts past a threshold (battery, cpu, memory)    → words, gone when fine
//          running programs + dev-server ports               → icon + count; card on click
//          branch + PR checks (gh)                           → icon + dot; words when checks fail
//          Claude usage (from Claude Code's status line)     → always words
// Cards are this same mod opened as a popup with props { card }; they read the bar's data
// from shared("tuibar") so they never poll on their own.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  agents, spaces, panes, focused, theme, run, exec, readTextFile, appHome,
  openOverlay, closeOverlay, props, shared, setShared, home,
} from "herdr";

const USAGE_FILE = "/data/claude-usage.json"; // written by ~/.claude/herdr-statusline.sh

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}
const until = (epochSec) => ago(epochSec * 1000 - Date.now());
const pctColor = (t, p) => (p >= 90 ? t.blocked : p >= 70 ? t.working : t.accent);

function meter(t, p, w = 44) {
  return div().flex_none().w(w).h(4).bg(t.raised)
    .child(div().h_full().w(Math.round((w * Math.min(100, Math.max(0, p))) / 100)).bg(pctColor(t, p)));
}

function programIcon(prog, size, t) {
  if (!prog?.icon) return div().size(size).flex_none().border_1().border_color(t.dim);
  return prog.tint ? svg(prog.icon).size(size).flex_none().text_color(prog.color ?? t.foreground) : image(prog.icon).size(size).flex_none();
}

// What the active space has running besides shells and agents: its panes' programs.
function runningPrograms(space) {
  if (!space) return [];
  const tabs = new Set(space.tabs.map((x) => x.id));
  return panes().filter((p) => tabs.has(p.tab) && p.terminal && !p.program?.shell && !p.program?.agent);
}

export default class TuiBar extends View {
  init(_props, cx) {
    this.card = props()?.card ?? null;
    if (this.card) return; // a card only draws what the bar shared
    this.waitSince = {};   // address -> when it started needing you
    this.data = { ports: [], pr: null, git: null, sys: {}, usage: null };
    this.poll(cx, "usage", 20000, () => this.readUsage());
    this.poll(cx, "sys", 30000, () => this.readSystem());
    this.poll(cx, "ports", 15000, () => this.readPorts());
    this.poll(cx, "git", 60000, () => this.readGit());
    // durations on the needs-you chips; only redraws when something is waiting
    cx.timer.every(30000, (cx) => { if (agents().some((a) => a.status === "blocked")) cx.notify(); });
  }

  poll(cx, key, ms, fn) {
    const go = (cx) => cx.spawn(async (cx) => {
      try { const v = await fn(); if (v !== undefined) { this.data[key] = v; this.publish(); cx.notify(); } } catch {}
    });
    go(cx);
    cx.timer.every(ms, go);
  }

  publish() { setShared("tuibar", { ...this.data, at: Date.now() }); }

  cwd() {
    const f = focused();
    const space = spaces().find((s) => s.active);
    return f?.cwd || space?.folder || null;
  }

  async readUsage() {
    const text = await readTextFile(appHome() + USAGE_FILE);
    if (!text) return null;
    const u = JSON.parse(text);
    const now = Date.now() / 1000;
    const live = (w) => (w && typeof w.used_percentage === "number" && (!w.resets_at || w.resets_at > now) ? w : null);
    return { five: live(u.five_hour), week: live(u.seven_day), at: u.updated_at ?? null };
  }

  async readSystem() {
    const sys = {};
    const batt = await exec("pmset", ["-g", "batt"]);
    const b = /(\d+)%;\s*(\w+)/.exec(batt.stdout);
    if (b) sys.battery = { pct: Number(b[1]), state: b[2] };
    const [ps, ncpu] = await Promise.all([exec("ps", ["-A", "-o", "%cpu="]), exec("sysctl", ["-n", "hw.ncpu"])]);
    const total = ps.stdout.split("\n").reduce((n, l) => n + (parseFloat(l) || 0), 0);
    sys.cpu = Math.round(total / (Number(ncpu.stdout.trim()) || 1));
    const mp = await exec("memory_pressure", ["-Q"]);
    const free = /free percentage:\s*(\d+)%/.exec(mp.stdout);
    if (free) sys.mem = 100 - Number(free[1]);
    return sys;
  }

  // Listening TCP ports whose process works inside this space's folders.
  async readPorts() {
    const space = spaces().find((s) => s.active);
    if (!space) return [];
    const tabs = new Set(space.tabs.map((x) => x.id));
    // A pane sitting in the home folder says nothing about which servers are "yours".
    const roots = [...new Set(panes().filter((p) => tabs.has(p.tab) && p.cwd && p.cwd !== home() && p.cwd !== "/").map((p) => p.cwd))];
    if (!roots.length) return [];
    const ls = await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]);
    const found = []; let pid = null, cmd = null;
    for (const line of ls.stdout.split("\n")) {
      if (line[0] === "p") pid = line.slice(1);
      else if (line[0] === "c") cmd = line.slice(1);
      else if (line[0] === "n") { const port = /:(\d+)$/.exec(line); if (port) found.push({ pid, cmd, port: Number(port[1]) }); }
    }
    const out = [], seen = new Set();
    for (const f of found) {
      if (seen.has(f.port)) continue;
      const cwd = await exec("lsof", ["-a", "-p", f.pid, "-d", "cwd", "-Fn"]);
      const dir = /\nn(.+)/.exec(cwd.stdout)?.[1];
      if (dir && roots.some((r) => dir === r || dir.startsWith(r + "/"))) {
        seen.add(f.port); out.push({ port: f.port, name: f.cmd });
      }
    }
    return out.sort((a, b) => a.port - b.port);
  }

  async readGit() {
    const cwd = this.cwd();
    if (!cwd) return null;
    const br = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    if (br.code !== 0) { this.data.pr = null; return null; }
    const [ahead, stat] = await Promise.all([
      exec("git", ["rev-list", "--count", "@{u}..HEAD"], { cwd }),
      exec("git", ["diff", "--shortstat", "HEAD"], { cwd }),
    ]);
    const git = {
      branch: br.stdout.trim(),
      ahead: ahead.code === 0 ? Number(ahead.stdout.trim()) : null,
      add: Number(/(\d+) insertion/.exec(stat.stdout)?.[1] ?? 0),
      del: Number(/(\d+) deletion/.exec(stat.stdout)?.[1] ?? 0),
    };
    const pr = await exec("gh", ["pr", "view", "--json", "number,url,reviewDecision,statusCheckRollup"], { cwd, timeout: 20000 });
    if (pr.code === 0) {
      const j = JSON.parse(pr.stdout);
      const checks = j.statusCheckRollup ?? [];
      const bad = checks.filter((c) => ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(c.conclusion ?? c.state)).length;
      const pending = checks.filter((c) => ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING"].includes(c.status ?? c.state)).length;
      this.data.pr = { number: j.number, url: j.url, review: j.reviewDecision, bad, pending, total: checks.length };
    } else this.data.pr = null;
    return git;
  }

  openCard(card, width, height) {
    openOverlay({ mod: "tui-bar", kind: "popup", width, height, props: { card } });
  }

  // ── bar ──────────────────────────────────────────────────────────────
  render() {
    if (this.card) return this.renderCard();
    const t = theme();
    const d = this.data;
    const space = spaces().find((s) => s.active);
    const now = Date.now();

    // who needs you: words, longest wait first
    const waiting = agents().filter((a) => a.status === "blocked");
    for (const a of waiting) this.waitSince[a.address] ??= now;
    for (const k of Object.keys(this.waitSince)) if (!waiting.some((a) => a.address === k)) delete this.waitSince[k];
    waiting.sort((a, b) => this.waitSince[a.address] - this.waitSince[b.address]);

    const cell = (id) => h_flex().id(id).h_full().px(9).gap(5).flex_none().items_center().cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground));

    const running = runningPrograms(space);
    const runCount = running.length + (d.ports ?? []).filter((p) => !running.some((r) => (p.name ?? "").toLowerCase().includes((r.program?.key ?? "~").toLowerCase()))).length;

    const pr = d.pr, git = d.git;
    const prBad = pr && pr.bad > 0;
    const prDot = !pr ? null : prBad ? t.blocked : pr.pending ? t.working : t.done;

    const sys = d.sys ?? {};
    const alerts = [];
    if (sys.battery && sys.battery.pct < 20 && sys.battery.state === "discharging") alerts.push(`bat ${sys.battery.pct}%`);
    if (sys.cpu > 85) alerts.push(`cpu ${sys.cpu}%`);
    if (sys.mem > 90) alerts.push(`mem ${sys.mem}%`);

    const five = d.usage?.five;

    return h_flex().size_full().items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
      // left: needs you
      .when(waiting.length > 0, (el) => el
        .child(h_flex().h_full().px(10).gap(7).flex_none().items_center().bg(t.blocked + "26").text_color(t.blocked).font_bold()
          .child(div().size(7).rounded_full().bg(t.blocked))
          .child(`${waiting.length} need${waiting.length === 1 ? "s" : ""} you`))
        .child(h_flex().h_full().pl(4).gap(2).items_center().children(waiting.slice(0, 3).map((a, i) =>
          h_flex().id(`tb-need-${a.address}`).h(18).px(7).gap(5).flex_none().items_center().cursor_pointer()
            .text_color(i === 0 ? t.foreground : t.muted).when(i === 0, (e) => e.bg(t.blocked + "33"))
            .hover((s) => s.bg(t.blocked + "33").text_color(t.foreground))
            .tooltip(a.title || a.tab_name)
            .on_click(() => run("agent.focus", { terminal: a.address }))
            .child(programIcon(a.program, 12, t))
            .child(a.program?.key ?? a.program?.name ?? "agent")
            .child(div().text_color(t.dim).child(ago(now - this.waitSince[a.address]))))))
        .when(waiting.length > 3, (el) => el.child(div().px(4).child(`+${waiting.length - 3}`)))
        .child(div().pl(8).child("⌘] next")))
      .child(div().flex_1())
      // alerts past a threshold
      .children(alerts.map((a) => div().px(9).flex_none().text_color(t.blocked).child(a)))
      // running: icon + count, or nothing when there's nothing
      .when(runCount > 0, (el) => el.child(cell("tb-run").tooltip("Running in this space")
        .on_click(() => this.openCard("run", 280, 64 + 26 * Math.min(8, runCount)))
        .child(svg("mods/tui-bar/activity.svg").size(13)).child(String(runCount))))
      // branch: icon + dot; words when checks fail
      .when(Boolean(git), (el) => el.child(cell("tb-git").relative().tooltip(git.branch)
        .on_click(() => this.openCard("git", 300, 120))
        .when(prBad, (e) => e.bg(t.blocked + "14").text_color(t.blocked))
        .child(svg("mods/tui-bar/branch.svg").size(13))
        .when(prBad, (e) => e.child(`✗ #${pr.number} ${pr.bad} check${pr.bad === 1 ? "" : "s"}`))
        .when(!prBad && Boolean(prDot), (e) => e.child(div().absolute().top(5).right(5).size(5).rounded_full().bg(prDot)))))
      .child(div().w(1).h(12).mx(4).bg(t.border))
      // Claude usage: always words
      .child(cell("tb-usage").pr(12).text_color(t.muted)
        .tooltip(five ? "Claude: 5-hour window" : "Claude usage appears after Claude Code's next reply")
        .on_click(() => this.openCard("usage", 260, 110))
        .child(image("icons/claude.svg").size(13))
        .when(Boolean(five), (e) => e
          .child(meter(t, five.used_percentage))
          .child(div().text_color(pctColor(t, five.used_percentage)).when(five.used_percentage >= 90, (x) => x.font_bold()).child(`${Math.round(five.used_percentage)}%`))
          .when(Boolean(five.resets_at), (x) => x.child(div().text_color(t.dim).child(until(five.resets_at)))))
        .when(!five, (e) => e.child("—")));
  }

  // ── cards ────────────────────────────────────────────────────────────
  renderCard() {
    const t = theme();
    const d = shared("tuibar") ?? {};
    const close = () => closeOverlay(props().overlay);
    const head = (title) => h_flex().h(22).px(8).gap(6).flex_none().items_center().border_b(1).border_color(t.border)
      .child(div().w(6).h(1).bg(t.border)).child(div().font_semibold().text_color(t.accent).child(title))
      .child(div().flex_1().h(1).bg(t.border)).child(div().text_color(t.dim).child("esc"));
    const row = (id) => h_flex().id(id).px(8).py(3).gap(8).items_center().cursor_pointer().hover((s) => s.bg(t.hover));
    const shell = (title) => v_flex().size_full().bg(t.popover).text_size(11.5).text_color(t.muted).child(head(title));

    if (this.card === "usage") {
      const u = d.usage ?? {};
      const line = (label, w) => h_flex().px(12).gap(8).items_center()
        .child(div().w(84).text_color(t.foreground).child(label))
        .child(w ? meter(t, w.used_percentage, 70) : div().w(70))
        .child(div().w(36).text_color(w ? pctColor(t, w.used_percentage) : t.dim).child(w ? `${Math.round(w.used_percentage)}%` : "—"))
        .child(div().text_color(t.dim).child(w?.resets_at ? `resets ${until(w.resets_at)}` : ""));
      return shell("claude usage").child(v_flex().py(8).gap(6).child(line("5-hour", u.five)).child(line("this week", u.week)))
        .when(!u.five && !u.week, (el) => el.child(div().px(12).text_color(t.dim).child("Shows after Claude Code's next reply.")));
    }

    if (this.card === "run") {
      const space = spaces().find((s) => s.active);
      const progs = runningPrograms(space);
      return shell("running").child(v_flex().py(4)
        .children(progs.map((p) => row(`c-run-${p.pane}`).on_click(() => { close(); run("pane.focus", { pane: p.pane }); })
          .child(div().text_color(t.done).child("▸")).child(div().flex_1().truncate().text_color(t.foreground).child(p.program?.name ?? p.title))
          .child(div().text_color(t.dim).child("go to pane"))))
        .children((d.ports ?? []).map((p) => row(`c-port-${p.port}`).on_click(() => { close(); exec("open", [`http://localhost:${p.port}`]); })
          .child(div().text_color(t.done).child("▸")).child(div().flex_1().truncate().text_color(t.foreground).child(p.name))
          .child(div().text_color(t.ansi6).child(`:${p.port} ↗`)))));
    }

    if (this.card === "git") {
      const g = d.git, pr = d.pr;
      return shell("branch").child(v_flex().px(12).py(8).gap(5)
        .when(Boolean(g), (el) => el.child(h_flex().gap(8)
          .child(div().flex_1().truncate().text_color(t.ansi5).child(g.branch))
          .when(g.ahead > 0, (e) => e.child(div().text_color(t.dim).child(`↑${g.ahead}`)))
          .child(div().text_color(t.ansi2).child(`+${g.add}`)).child(div().text_color(t.ansi1).child(`−${g.del}`))))
        .when(Boolean(pr), (el) => el.child(h_flex().id("c-pr").gap(8).cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click(() => { close(); exec("open", [pr.url]); })
          .child(div().text_color(t.foreground).child(`#${pr.number}`))
          .child(div().text_color(pr.bad ? t.blocked : pr.pending ? t.working : t.done)
            .child(pr.bad ? `✗ ${pr.bad} failing` : pr.pending ? `◌ ${pr.pending} running` : pr.total ? "✓ checks passing" : "no checks"))
          .child(div().flex_1())
          .child(div().text_color(t.dim).child(pr.review === "APPROVED" ? "approved ↗" : pr.review === "CHANGES_REQUESTED" ? "changes asked ↗" : "↗"))))
        .when(!pr, (el) => el.child(div().text_color(t.dim).child("No pull request for this branch."))));
    }
    return div();
  }
}

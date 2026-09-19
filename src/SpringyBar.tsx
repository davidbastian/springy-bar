import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

/*
 * SpringyBar — a scrub bar with a string in it.
 *
 * One file, no dependencies, works on a <video>, an <audio>, or anything else
 * with a position and a length. Drag it left and right to scrub, as every
 * scrub bar has worked since 1995; push it up or down and two things happen
 * that no scrub bar does:
 *
 *   The bar bends away from your finger, so the thing it was covering —
 *   subtitles, a face, the bottom of a photograph — is visible while you are
 *   scrubbing, which is exactly when you need to see it.
 *
 *   And the further you push, the finer the scrub. That gesture already exists
 *   on iOS, where sliding away from the slider slows it down, and nobody has
 *   ever shown it: you are meant to discover it, and most people never do. Here
 *   the string IS the display. The bend is how far from the bar you are, and
 *   how far from the bar you are is the precision.
 *
 * The vertical axis is not decoration, in other words. A hand that reaches for
 * a bar does not only move sideways, and a bar that answers both directions
 * feels like a thing rather than a track.
 *
 * Everything is a prop with a default, so the smallest use is:
 *
 *   <SpringyBar value={t} duration={d} onSeek={setT} />
 *
 * Accessibility: the container is a real slider — role, aria-valuenow, arrow
 * keys, Home and End, and space toggles play when onPlayPause is given. The
 * spring never moves a value; it only draws.
 */

export interface SpringyBarProps {
  /** Where the playhead is, in the same unit as duration (seconds, usually). */
  value: number;
  /** How long the thing is. Omit for a 0–1 bar. */
  duration?: number;
  /** Called while dragging and on a keyboard seek. */
  onSeek?: (value: number) => void;
  /** Called once when a drag ends, if you would rather seek only then. */
  onSeekEnd?: (value: number) => void;
  /*
   * Told whenever the string is picked up or put down.
   *
   * What it is for: the thing behind the bar usually wants to get out of the
   * way too. With a preview frame over the handle, a player that dims or
   * blurs its picture while you scrub reads as one gesture rather than two
   * pictures competing — and the component cannot do that itself, because the
   * picture is not its to touch. So it says when, and the page decides what.
   */
  onDragChange?: (dragging: boolean) => void;
  /** Shows a play or pause button on the left when given. */
  playing?: boolean;
  onPlayPause?: () => void;
  /** 0–1: how much is loaded, drawn as a dim fill behind the played part. */
  buffered?: number;
  /** How far the string can be pushed, in pixels. 0 turns the bend off. */
  reach?: number;
  /*
   * The hard stop, in pixels.
   *
   * Reach is where the string starts resisting; this is where it stops
   * altogether, however far the finger goes. Without it a long drag down a
   * tall phone screen keeps giving — slowly, but by the bottom of the screen
   * the string is a hundred and fifty pixels from home, over content it was
   * never meant to reach, and the spring that brings it back is a lurch. The
   * limit is what makes the give feel like a material rather than a slope.
   */
  limit?: number;
  /*
   * The control's own height, in pixels — its hit area, and nothing else.
   *
   * Deliberately not derived from reach. It was, and two things went wrong:
   * changing reach moved the bar up and down the page while you were tuning
   * it, and a control whose box grows with its give cannot sit in a pill —
   * the pill grew with it, a hundred pixels tall around a three-pixel line.
   *
   * So the box is the box and the give is the give. The string rests in the
   * middle of this height, and when it is pushed past the edge it simply draws
   * outside, over whatever the control is sitting on. That is what SVG
   * overflow is for, and it is the behaviour you want anyway: a bar in a
   * capsule should bend out of the capsule, not stretch it.
   */
  room?: number;
  /** The spring that brings it back. Stiffness and damping, per second. */
  stiffness?: number;
  damping?: number;
  /** At full reach the scrub runs this much slower. 1 turns precision off. */
  precision?: number;
  /** A short note pluck when the string is released. Off by default. */
  sound?: boolean;
  /** The played part, the handle and the focus ring. */
  accent?: string;
  /** The unplayed part. */
  track?: string;
  /** Thickness of the string, in pixels. */
  weight?: number;
  /** Elapsed and remaining, in the corners. */
  showTime?: boolean;
  /*
   * A label above the handle while you drag.
   *
   * It rides the string rather than the track: pushed down, the label goes
   * down with the bend and stays the same distance from the handle, because
   * the thing it is labelling is the handle. A bubble that stayed level while
   * the string moved would read as a second, unrelated control.
   */
  tip?: boolean;
  /*
   * Whether a cursor resting on the bar is treated as a question.
   *
   * On by default, and the behaviour every video player has taught people to
   * expect: hovering thickens the string and puts the label — and the preview,
   * if there is one — over the point under the cursor, not over the playhead.
   * You are asking what is there, and the answer arrives before you commit to
   * a drag. Touch has no hover, so this costs a phone nothing.
   */
  hover?: boolean;
  /*
   * Anything to show above that label — a thumbnail, a chapter name, a marker.
   * Called with the position under the finger, as often as it moves, so keep
   * it cheap: a frame from a preload video, not a network request per pixel.
   */
  preview?: (value: number) => ReactNode;
  /*
   * A container around the whole control, the way the study draws it: a pill
   * with a translucent fill and a hairline, floating over the picture. On its
   * own the bar is a line you put wherever you like; in a container it is a
   * control that can sit over anything and still be found.
   */
  container?: boolean;
  /** The pill's fill and hairline. Any CSS colour, so rgba() for translucency. */
  containerFill?: string;
  containerBorder?: string;
  /** Corner radius of the pill. Left out, it is a capsule. */
  containerRadius?: number;
  /*
   * How much of what is behind the pill is blurred, in pixels. 0 for none.
   *
   * Worth turning off as often as on: over a busy picture the blur is what
   * makes a translucent control readable, and over a flat one it costs a
   * composited layer to soften nothing. It is also the first thing to drop on
   * a phone that is already decoding video.
   */
  containerBlur?: number;
  /** Anything else: volume, speed, a fullscreen button. Sits on the right. */
  actions?: ReactNode;
  /** For screen readers, when the bar is not obviously a player. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const clock = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
};

/*
 * The note the string makes when you let go.
 *
 * One context, made on the first pluck and kept: a page that opens an
 * AudioContext it never uses is a page that asks permission for nothing. The
 * pitch rises with how hard the string was pushed, because a string under more
 * tension does, and the whole thing is over in a third of a second.
 */
let audio: AudioContext | null = null;
function pluck(bend: number) {
  try {
    if (!audio) audio = new (window.AudioContext || (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audio.state === 'suspended') void audio.resume();
    const now = audio.currentTime;
    const hit = clamp(Math.abs(bend), 0.05, 1);
    const hz = 150 + hit * 180;
    const out = audio.createGain();
    out.gain.value = 0.9;
    out.connect(audio.destination);
    /* Two partials, the upper one shorter: that ratio is most of what makes a
       plucked string sound plucked rather than beeped. */
    [[hz, 0.06 * hit, 0.34], [hz * 2.02, 0.022 * hit, 0.16]].forEach(([f, peak, dur]) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, now);
      o.frequency.exponentialRampToValueAtTime(f * 0.985, now + dur);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(peak, now + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g); g.connect(out);
      o.start(now);
      o.stop(now + dur + 0.02);
    });
  } catch { /* no audio here, and the bar does not need it */ }
}

export function SpringyBar({
  value,
  duration,
  onSeek,
  onSeekEnd,
  onDragChange,
  playing,
  onPlayPause,
  buffered = 0,
  reach = 20,
  limit = 16,
  room = 40,   // the height of the control, not the reach of the string
  stiffness = 600,
  damping = 20,
  precision = 1.5,
  sound = false,
  accent = '#111111',
  track = 'rgba(0,0,0,0.16)',
  weight = 3.5,
  showTime = false,
  tip = false,
  hover = true,
  preview,
  container = false,
  containerFill = 'rgba(0,0,0,0.30)',
  containerBorder = 'rgba(255,255,255,0.22)',
  containerRadius,
  containerBlur = 14,
  actions,
  label = 'Seek',
  className,
  style,
}: SpringyBarProps) {
  const max = duration && duration > 0 ? duration : 1;
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<SVGPathElement>(null);
  const fill = useRef<SVGPathElement>(null);
  const knob = useRef<SVGCircleElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  /* Where the cursor is asking about, in the bar's own unit. null is away. */
  const [asking, setAsking] = useState<number | null>(null);
  const askPx = useRef(0);
  /*
   * The moment after you let go.
   *
   * Dragging ends in one frame, but the string takes a few hundred milliseconds
   * to come home — and the label, which had been riding the bent handle, was
   * jumping to the cursor's rest line the instant the pointer came up. It read
   * as a glitch rather than a release. So for as long as the spring is
   * travelling, the label stays on the handle and fades out where it is, and
   * the hover label is held back until it has gone.
   */
  const [closing, setClosing] = useState(false);
  const closeAt = useRef(0);
  const onHandle = useRef(false);
  /* What the label last said: it stays on screen for a fifth of a second after
     the answer stops being needed, and must not blink to zero while it goes. */
  const saidRef = useRef(0);
  /* Where the label was standing when the finger left, so it can go from
     there. Following the string home was movement nobody asked for: the
     answer stopped being needed at a point, and that is the point it should
     leave from. */
  const lastAt = useRef({ x: 0, y: 0 });
  const frozen = useRef<{ x: number; y: number } | null>(null);

  /* The spring's world. Refs, not state: this runs at 60fps and a re-render
     per frame would be sixty renders a second for a curve. */
  const bend = useRef(0);          // where the string is, in pixels
  const target = useRef(0);        // where the finger is holding it
  const vel = useRef(0);
  const raf = useRef(0);
  const at = useRef(value);        // the value the bar is drawing
  const grab = useRef<{ x: number; v: number; t: number } | null>(null);
  const width = useRef(1);
  /* Read inside paint, which must not be rebuilt sixty times a second. */
  const live = useRef(false);
  const dragOn = useRef(false);
  const locked = useRef<HTMLElement | null>(null);

  at.current = dragging ? at.current : value;
  dragOn.current = dragging;
  onHandle.current = dragging || closing;
  live.current = dragging || closing || asking !== null;

  /* ── Drawing ───────────────────────────────────────────────────────────── */
  const paint = useCallback(() => {
    const el = box.current, ln = line.current, fl = fill.current, kb = knob.current;
    if (!el || !ln || !fl || !kb) return;
    const w = el.clientWidth || 1;
    width.current = w;
    const mid = room / 2;                           // the rest line, in the middle of the box
    const y = mid + bend.current;

    /*
     * One curve, and the played part is literally its first half.
     *
     * A string held at a point is two legs meeting under the finger, and each
     * leg is bowed rather than straight: a real string would be straight, but
     * at three pixels thick two straight legs read as a folded wire, and the
     * bow is what says tension.
     *
     * The played part used to be this path under a clip, which cut both of its
     * round caps square — flat against the left edge and flat under the
     * handle — so the bar read as a fill rather than a line. It is now the
     * first segment of the same path data, which coincides with the track by
     * construction rather than by arithmetic, and keeps its caps.
     *
     * The line is inset by its own weight at each end, because a round cap
     * hangs half a stroke past the point it ends on: drawn to x = 0 it is a
     * cap sliced by the edge of the box.
     */
    const pad = weight;
    const a = pad, b = Math.max(pad, w - pad);
    const x = a + clamp(at.current / max, 0, 1) * (b - a);
    const lead = `M${a},${mid} Q${(a + (x - a) * 0.55).toFixed(1)},${(mid + bend.current * 0.72).toFixed(2)} ${x.toFixed(1)},${y.toFixed(2)}`;
    ln.setAttribute('d', `${lead} Q${(x + (b - x) * 0.45).toFixed(1)},${(mid + bend.current * 0.72).toFixed(2)} ${b},${mid}`);
    fl.setAttribute('d', lead);
    kb.setAttribute('cx', String(x));
    kb.setAttribute('cy', String(y));

    /*
     * Thicker while it is being used. A line that answers a cursor before it
     * is pressed is the difference between a control and a drawing, and it is
     * the one piece of feedback every player has trained people to expect.
     */
    const thick = live.current ? weight * 1.5 : weight;
    ln.setAttribute('stroke-width', String(thick));
    fl.setAttribute('stroke-width', String(thick));
    kb.setAttribute('r', String(live.current ? weight * 2.4 : weight * 1.7));

    /*
     * The label goes over whatever is in question: the handle while you are
     * dragging it, and the point under the cursor while you are only asking.
     * Hovering, it stays on the rest line, because nothing has been pushed.
     */
    if (bubble.current) {
      const hold = frozen.current;
      const bx = hold ? hold.x : onHandle.current ? x : askPx.current;
      const by = hold ? hold.y : onHandle.current ? y : mid;
      if (!hold) lastAt.current = { x: bx, y: by };
      bubble.current.style.transform = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px)`;
    }
  }, [max, room, weight]);

  /* ── The spring ────────────────────────────────────────────────────────── */
  const run = useCallback(() => {
    let last = performance.now();
    const step = (now: number) => {
      /* Clamped, because a tab that was in the background for a minute must
         not integrate a minute of spring in one frame. */
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const a = (target.current - bend.current) * stiffness - vel.current * damping;
      vel.current += a * dt;
      bend.current += vel.current * dt;
      paint();
      const resting = Math.abs(bend.current - target.current) < 0.05 && Math.abs(vel.current) < 0.5;
      if (resting && target.current === 0) { bend.current = 0; vel.current = 0; paint(); raf.current = 0; return; }
      raf.current = requestAnimationFrame(step);
    };
    if (!raf.current) raf.current = requestAnimationFrame(step);
  }, [damping, paint, stiffness]);

  /*
   * Painted again once the render has landed.
   *
   * paint() reads what the render decided — whether the string is live, where
   * the label goes — and the call inside the pointer handler happens before
   * that render: on the frame a cursor arrives, the label had no element to
   * position and the line had not thickened yet. One more pass after the
   * commit, and the two agree.
   */
  useEffect(() => { paint(); }, [paint, value, asking, dragging, closing]);
  useEffect(() => () => window.clearTimeout(closeAt.current), []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf.current); raf.current = 0; };
  }, [paint]);

  /* ── The gesture ───────────────────────────────────────────────────────── */
  /*
   * The page is locked while the string is held, and only once the finger has
   * committed: a flick straight down the page is a scroll, six pixels sideways
   * is a scrub. Without that, a bar this tall is a trap on a phone; with
   * touch-action alone, a drag that wanders downwards takes the page with it.
   */
  const lockPage = (on: boolean) => {
    if (on) {
      let el: HTMLElement | null = box.current;
      while (el && el !== document.body) {
        const s = getComputedStyle(el);
        if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) break;
        el = el.parentElement;
      }
      locked.current = el ?? document.body;
      locked.current.style.overflowY = 'hidden';
    } else if (locked.current) {
      locked.current.style.overflowY = '';
      locked.current = null;
    }
  };

  /*
   * While the cursor is asking, the window is watched.
   *
   * Element events alone cannot be trusted to end a hover: the page can scroll
   * the bar out from under a cursor that never moved, another element can take
   * the pointer, the tab can change — and none of those fire a leave on this
   * element. So for as long as the label is up, any pointer move or scroll
   * anywhere re-checks the box and puts it away. It costs two listeners, and
   * only while something is actually being pointed at.
   */
  useEffect(() => {
    if (asking === null) return;
    const check = (e?: globalThis.PointerEvent) => {
      const el = box.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const out = !e
        || e.clientX < r.left - 2 || e.clientX > r.right + 2
        || e.clientY < r.top - 2 || e.clientY > r.bottom + 2;
      if (out && !grab.current) setAsking(null);
    };
    const onMove = (e: globalThis.PointerEvent) => check(e);
    const onScroll = () => setAsking(null);
    /* Pointer and scroll only. A window blur was in here too and was the
       wrong instrument: anything that takes focus for a moment — a devtools
       panel, an extension, a dialog — was closing a label the cursor was
       still resting on. */
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
    };
  }, [asking]);

  const seekTo = (v: number) => {
    at.current = clamp(v, 0, max);
    onSeek?.(at.current);
    paint();
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    width.current = r.width;
    grab.current = { x: e.clientX, v: ((e.clientX - r.left) / r.width) * max, t: performance.now() };
    setAsking(null);            // the cursor stops asking the moment it takes hold
    setDragging(true);
    onDragChange?.(true);
    /* Capture is worth having and not worth dying for: a browser that refuses
       it — a stale pointer id, a non-primary touch — must not take the seek
       down with it, which is what an uncaught throw here did. */
    try { el.setPointerCapture?.(e.pointerId); } catch { /* drag still works */ }
    if (e.pointerType !== 'touch') lockPage(true);
    seekTo(grab.current.v);
    run();
  };

  /* A cursor over the bar, not pressed: work out what it is pointing at. */
  const ask = (e: PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!hover || !el || grab.current || closing || e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    /*
     * Checked against the box rather than trusted to pointerleave.
     *
     * A leave event is not guaranteed: the element can move out from under a
     * still cursor, another element can take the capture, a tab can be
     * switched mid-hover — and the label was then left hanging over a bar
     * nobody was pointing at. Every move says where it is, so every move can
     * also say when it is no longer here.
     */
    const inside = e.clientX >= r.left - 2 && e.clientX <= r.right + 2
      && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2;
    if (!inside) { if (asking !== null) { setAsking(null); paint(); } return; }
    askPx.current = clamp(e.clientX - r.left, 0, r.width);
    setAsking(clamp((askPx.current / Math.max(r.width, 1)) * max, 0, max));
    paint();
  };
  const stopAsking = () => { if (asking !== null) { setAsking(null); paint(); } };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    ask(e);
    const g = grab.current, el = box.current;
    if (!g || !el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - g.x;
    const dy = e.clientY - (r.top + room / 2);

    /*
     * What the finger meant, decided once.
     *
     * A flick straight down the page is someone reading, and it has to scroll:
     * six pixels sideways, or a press that was held before it moved, is
     * someone taking hold of the bar. The hold matters because pushing the
     * string down without scrubbing is a real gesture here — it is how you set
     * the precision before you move — and it looks exactly like a scroll for
     * its first few pixels. A sixth of a second of stillness tells them apart.
     */
    if (e.pointerType === 'touch' && !locked.current) {
      const held = performance.now() - g.t > 160;
      const sideways = Math.abs(dx) >= 6 && Math.abs(dy) < Math.abs(dx) * 1.6;
      if (!held && !sideways) return;
      lockPage(true);
    }

    /*
     * Rubber, not rope: past the reach the string keeps giving, but less and
     * less, so a long drag never leaves the bar behind and never stops dead.
     */
    const soft = (d: number) => {
      const s = Math.sign(d), a = Math.abs(d);
      const give = a <= reach ? a : reach + (a - reach) * 0.22;
      return s * Math.min(give, limit);
    };
    target.current = reach > 0 ? soft(dy) : 0;

    /*
     * The precision the bend is showing. At rest one pixel of finger is one
     * pixel of bar; at full reach it is a quarter of that, and everything
     * between is the curve you can see.
     */
    const away = Math.min(1, Math.abs(target.current) / Math.max(reach, 1));
    const fine = 1 / (1 + away * (Math.max(1, precision) - 1));
    seekTo(g.v + (dx / Math.max(width.current, 1)) * max * fine);
    run();
  };

  const up = () => {
    if (!grab.current) return;
    grab.current = null;
    setDragging(false);
    /* Pinned where it was and fading, while the string goes home without it. */
    frozen.current = { ...lastAt.current };
    setClosing(true);
    window.clearTimeout(closeAt.current);
    closeAt.current = window.setTimeout(() => { frozen.current = null; setClosing(false); }, 260);
    onDragChange?.(false);
    lockPage(false);
    if (sound) pluck(bend.current / Math.max(reach, 1));
    target.current = 0;
    run();
    onSeekEnd?.(at.current);
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = duration ? 5 : 0.05;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { seekTo(at.current + step); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { seekTo(at.current - step); e.preventDefault(); }
    else if (e.key === 'Home') { seekTo(0); e.preventDefault(); }
    else if (e.key === 'End') { seekTo(max); e.preventDefault(); }
    else if (e.key === ' ' && onPlayPause) { onPlayPause(); e.preventDefault(); }
  };

  const height = room;
  /* The value the label is answering about, and the last one it gave. */
  const said = dragging || closing ? at.current : (asking ?? saidRef.current);
  saidRef.current = said;
  const shown = dragging ? at.current : value;

  return (
    <div
      className={['sbar', container ? 'sbar-shell' : '', dragging ? 'sbar-held' : '', className].filter(Boolean).join(' ')}
      style={container
        ? {
            background: containerFill,
            border: `1px solid ${containerBorder}`,
            /* A capsule unless a radius is given: half the height is what makes
               a pill a pill at any height, and a number is for when the thing
               it sits in has corners of its own. */
            borderRadius: containerRadius ?? (height + 12) / 2,
            padding: '6px 14px',
            backdropFilter: containerBlur ? `blur(${containerBlur}px)` : undefined,
            WebkitBackdropFilter: containerBlur ? `blur(${containerBlur}px)` : undefined,
            ...style,
          }
        : style}
    >
      {onPlayPause && (
        <button className="sbar-play" onClick={onPlayPause} aria-label={playing ? 'Pause' : 'Play'} style={{ color: accent }}>
          {playing
            ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.6" height="14" rx="1.2" /><rect x="13.4" y="5" width="3.6" height="14" rx="1.2" /></svg>
            : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6l11-6.8z" /></svg>}
        </button>
      )}

      {showTime && <span className="sbar-time">{clock(shown)}</span>}

      <div
        ref={box}
        className="sbar-track"
        style={{ height }}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Number(shown.toFixed(2))}
        aria-valuetext={duration ? `${clock(shown)} of ${clock(max)}` : undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerEnter={ask}
        onPointerLeave={stopAsking}
        onPointerUp={up}
        onPointerCancel={up}
        onLostPointerCapture={up}
        onKeyDown={key}
      >
        {/*
          * One element, shown and hidden by opacity rather than mounted and
          * unmounted. A label that is created when it is needed arrives at
          * full strength — there is nothing to transition from — so a cursor
          * returning to the bar made it pop while the one before it had been
          * fading politely. Kept in the tree, it only ever fades.
          */}
        {tip && (
          <div
            /*
             * Closing is not a reason to stay visible. Released under a cursor
             * that is still on the bar, the label used to hand straight over to
             * the hover label — which lives at the cursor, not at the handle —
             * and the hand-over was a jump. It goes out where it was; pointing
             * again brings it back.
             */
            className={dragging || (!closing && asking !== null) ? 'sbar-tip' : 'sbar-tip sbar-tip-out'}
            ref={bubble}
            aria-hidden="true"
          >
            {/* One stack, lifted clear of the handle in a single transform:
                the frame on top, the time under it, the handle under that. */}
            <div className="sbar-tip-stack">
              {preview && <div className="sbar-tip-shot">{preview(said)}</div>}
              <span className="sbar-tip-time">
                {duration ? clock(said) : said.toFixed(2)}
              </span>
            </div>
          </div>
        )}
        <svg width="100%" height={height} aria-hidden="true">
          {buffered > 0 && (
            <line
              x1={weight} y1={room / 2} x2={`${clamp(buffered, 0, 1) * 100}%`} y2={room / 2}
              stroke={track} strokeWidth={weight} strokeLinecap="round" opacity={0.6}
            />
          )}
          <path ref={line} fill="none" stroke={track} strokeWidth={weight} strokeLinecap="round" />
          <path ref={fill} fill="none" stroke={accent} strokeWidth={weight} strokeLinecap="round" />
          <circle ref={knob} r={weight * 1.7} fill={accent} />
        </svg>
      </div>

      {showTime && <span className="sbar-time">{duration ? `-${clock(max - shown)}` : ''}</span>}
      {actions && <div className="sbar-actions">{actions}</div>}
    </div>
  );
}

/*
 * The styles, as a string, so the component stays one file to copy.
 *
 * Nothing here decides how the bar looks beyond what it needs to work: the
 * colours are props, and everything else is layout, a hit area and the two
 * transitions that make the handle feel picked up.
 */
export const springyBarCss = `
/*
 * Nothing in the control is text you are meant to select.
 *
 * A drag that starts on the bar and passes over the clock was selecting it —
 * the browser's own reflex for a pointer moving across characters — so the
 * label came up highlighted and, on a phone, took the magnifier and the copy
 * callout with it. The whole control opts out.
 */
.sbar {
  display: flex; align-items: center; gap: 12px; width: 100%;
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
}
/* The pill's own box: everything visual about it comes from props, so this
   only has to stop the padding from collapsing the flex row. */
.sbar-shell { box-sizing: border-box; }
.sbar-track {
  position: relative; flex: 1; min-width: 0; cursor: grab;
  touch-action: pan-y;               /* the page keeps vertical flicks */
  -webkit-tap-highlight-color: transparent;
}
.sbar-held .sbar-track { cursor: grabbing; }
.sbar-track:focus-visible { outline: none; }
.sbar-track:focus-visible svg { filter: drop-shadow(0 0 0 2px rgba(0,0,0,0.25)); }
.sbar-track svg { display: block; overflow: visible; }
.sbar-track circle, .sbar-track path { transition: r 0.16s cubic-bezier(0.4, 0.55, 0.65, 0.8), stroke-width 0.16s cubic-bezier(0.4, 0.55, 0.65, 0.8); }
.sbar-play {
  flex: 0 0 auto; width: 30px; height: 30px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  background: none; border: none; cursor: pointer;
}
.sbar-play svg { width: 20px; height: 20px; fill: currentColor; }
/*
 * The label above the handle.
 *
 * Positioned by the same code that draws the string, so it cannot lag behind
 * it, and pointer-transparent: it is over the thing you are dragging, and a
 * bubble that swallowed the drag would be a bubble you could not drag past.
 */
.sbar-tip {
  position: absolute; left: 0; top: 0; pointer-events: none; z-index: 2;
  opacity: 1; transition: opacity 0.22s ease-out;
}
/* Let go: it stays where it was and goes, rather than moving somewhere else. */
.sbar-tip-out { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .sbar-tip { transition: none; } }
.sbar-tip-stack {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  transform: translate(-50%, calc(-100% - 16px));
}
.sbar-tip-time {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px; font-variant-numeric: tabular-nums; letter-spacing: 0.04em;
  padding: 3px 7px; border-radius: 6px;
  background: rgba(20,20,22,0.88); color: #fff; white-space: nowrap;
}
.sbar-tip-shot {
  border-radius: 7px; overflow: hidden; line-height: 0;
  background: #111; box-shadow: 0 6px 18px rgba(0,0,0,0.28);
}
/* Whatever the preview is, it is a thumbnail: the component sizes it rather
   than trusting the page it has been dropped into. */
.sbar-tip-shot img, .sbar-tip-shot video, .sbar-tip-shot canvas {
  display: block; width: auto; height: auto;
  max-width: 132px; max-height: 96px;
}

.sbar-time {
  flex: 0 0 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; font-variant-numeric: tabular-nums;
  color: rgba(0,0,0,0.42);
}
.sbar-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
@media (prefers-reduced-motion: reduce) { .sbar-track circle, .sbar-track path { transition: none; } }
`;

export default SpringyBar;

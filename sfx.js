/*
 * sfx.js — Lightweight, professional UI sound-effect engine.
 *
 * Every sound below is synthesized on the fly with the Web Audio API (short
 * sine/triangle tones through a gentle low-pass filter). There are no audio
 * files to host, download or keep in sync with the codebase — this file is
 * the entire sound system, shared by both index.html (dashboard) and
 * admin.html.
 *
 * Different UI actions get audibly different sounds (see the SOUNDS map),
 * and the whole thing can be muted from a small speaker button next to the
 * dark-mode toggle — the preference is remembered in localStorage.
 *
 * Usage from other scripts (rarely needed — a global delegated listener
 * below already covers clicks/changes across the whole app):
 *   window.SFX.play('success');
 */
(function () {
  "use strict";

  var STORAGE_KEY = "jsl_qi_sfx_enabled";
  var enabled = localStorage.getItem(STORAGE_KEY);
  enabled = enabled === null ? true : enabled === "1";

  var ctx = null;
  function getCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // Plays one short tone. `freq` glides to `glideTo` over `dur` seconds when
  // given (used for the rising/falling "swoosh" sounds). Every tone is
  // routed through a low-pass filter so it sounds soft/rounded rather than
  // like a raw beep.
  function tone(freq, opts) {
    var o = opts || {};
    var dur = o.dur || 0.09, type = o.type || "sine", gain = o.gain != null ? o.gain : 0.07;
    var delay = o.delay || 0, glideTo = o.glideTo || null, cutoff = o.cutoff || 3400;
    var ac = getCtx();
    if (!ac) return;
    var t0 = ac.currentTime + delay;
    var osc = ac.createOscillator();
    var filt = ac.createBiquadFilter();
    var g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(cutoff, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(filt); filt.connect(g); g.connect(ac.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  // Named sound bank — each entry is a short sequence of tone() calls, so
  // every UI condition below has its own distinct, recognizable sound.
  var SOUNDS = {
    // Generic secondary button / link click — a light neutral tick.
    click: function () { tone(760, { dur: 0.045, type: "sine", gain: 0.05 }); },
    // Primary/submit button ("Save", "Login", export buttons) — a touch
    // more solid/affirmative than a plain click.
    confirm: function () {
      tone(600, { dur: 0.05, type: "sine", gain: 0.055 });
      tone(840, { dur: 0.07, type: "sine", gain: 0.05, delay: 0.035 });
    },
    // Choosing a filter option / chip / native <select> value / checkbox —
    // brighter and shorter than a click, so picking a value feels distinct
    // from pressing a button.
    select: function () { tone(1050, { dur: 0.04, type: "triangle", gain: 0.045, cutoff: 4200 }); },
    // Opening a filter dropdown, a modal, or a file picker — soft rising
    // glide.
    open: function () { tone(520, { dur: 0.09, type: "sine", gain: 0.05, glideTo: 760 }); },
    // Closing/dismissing the above — the same glide, reversed.
    close: function () { tone(720, { dur: 0.08, type: "sine", gain: 0.045, glideTo: 480 }); },
    // Switching tabs — a two-note "swipe" so moving between sections has
    // its own identity.
    tab: function () {
      tone(600, { dur: 0.055, type: "sine", gain: 0.045 });
      tone(780, { dur: 0.06, type: "sine", gain: 0.045, delay: 0.045 });
    },
    // Dark/light mode + sound mute toggle — a neutral two-tick "switch".
    toggle: function () {
      tone(520, { dur: 0.04, type: "triangle", gain: 0.05 });
      tone(680, { dur: 0.05, type: "triangle", gain: 0.045, delay: 0.05 });
    },
    // A completed action / saved successfully / import finished — a short
    // pleasant ascending chime. Unmistakably "good news".
    success: function () {
      tone(523.25, { dur: 0.09, type: "sine", gain: 0.055 });
      tone(659.25, { dur: 0.09, type: "sine", gain: 0.055, delay: 0.08 });
      tone(783.99, { dur: 0.13, type: "sine", gain: 0.06, delay: 0.16 });
    },
    // A failed action / validation error — low, brief, and deliberately
    // muted rather than harsh, but clearly not the success chime.
    error: function () {
      tone(330, { dur: 0.09, type: "triangle", gain: 0.06, cutoff: 2200 });
      tone(233, { dur: 0.14, type: "triangle", gain: 0.055, delay: 0.09, cutoff: 2000 });
    },
    // A cautionary / destructive action — Reset All, Delete, Logout. Two
    // identical short beeps, distinct from both success and error.
    warning: function () {
      tone(440, { dur: 0.06, type: "square", gain: 0.035, cutoff: 1800 });
      tone(440, { dur: 0.06, type: "square", gain: 0.035, delay: 0.11, cutoff: 1800 });
    },
    // A passive notification (browser alert(), a live-data update) — one
    // soft two-note chime, calmer than "success".
    notify: function () {
      tone(587.33, { dur: 0.11, type: "sine", gain: 0.045 });
      tone(880, { dur: 0.16, type: "sine", gain: 0.04, delay: 0.02 });
    }
  };

  function play(name) {
    if (!enabled) return;
    var fn = SOUNDS[name] || SOUNDS.click;
    try { fn(); } catch (e) { /* never let a sound glitch break the UI */ }
  }

  function setEnabled(v) {
    enabled = !!v;
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    syncToggleButtons();
  }

  function syncToggleButtons() {
    document.querySelectorAll(".sfx-toggle-btn").forEach(function (btn) {
      btn.textContent = enabled ? "🔊" : "🔈";
      btn.title = enabled ? "Mute sound effects" : "Unmute sound effects";
      btn.setAttribute("aria-label", btn.title);
      btn.classList.toggle("muted", !enabled);
    });
  }

  window.SFX = { play: play, isEnabled: function () { return enabled; }, setEnabled: setEnabled };

  // ---- Wire the mute/unmute button(s) — index.html and admin.html each
  // have their own header, but both just need a `.sfx-toggle-btn` element. ----
  document.addEventListener("DOMContentLoaded", function () {
    syncToggleButtons();
    document.querySelectorAll(".sfx-toggle-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation(); // don't also let the generic delegated handler below fire for this click
        var wasEnabled = enabled;
        setEnabled(!enabled);
        if (wasEnabled) play("toggle"); // audible confirmation on the way OUT; silent on the way back in
      });
    });
  });

  // ---- One delegated listener covers clicks across the whole app (this
  // dashboard adds buttons/filters dynamically, so wiring each one
  // individually isn't practical). Order matters: most specific match wins. ----
  document.addEventListener("click", function (e) {
    if (!e.isTrusted) return; // ignore synthetic clicks fired by our own JS (e.g. a hidden file input via .click())
    var t = e.target;
    if (t.closest(".sfx-toggle-btn")) return; // handled above, with its own on/off logic
    var el;
    if ((el = t.closest(".reset-all, .btn.danger, .delete, [data-action='delete'], #logoutBtn"))) return play("warning");
    if ((el = t.closest(".theme-toggle-btn"))) return play("toggle");
    if ((el = t.closest(".tab-btn, .side-link"))) return play("tab");
    if ((el = t.closest(".filter-option, .qcr-fishbone-chip"))) return play("select");
    if ((el = t.closest(".filter-trigger"))) return play("open");
    if ((el = t.closest("label[for], .filebox"))) return; // avoid double-firing with the change event that follows
    if ((el = t.closest(".btn.primary, .export-btn, button[type='submit']"))) return play("confirm");
    if ((el = t.closest("button, .btn, a.admin-link, [role='button']"))) return play("click");
  }, true);

  // ---- Native form controls fire 'change', not a second useful 'click' —
  // covers <select>, checkboxes and radios (admin forms use plenty of both). ----
  document.addEventListener("change", function (e) {
    if (!e.isTrusted) return;
    var t = e.target;
    if (t.matches("select, input[type='checkbox'], input[type='radio']")) return play("select");
    if (t.matches("input[type='file']")) return play("open");
  }, true);

  // ---- alert()/confirm() are still used in a couple of places (e.g. saved
  // views) — give them a sound too instead of leaving them silent. ----
  var nativeAlert = window.alert;
  window.alert = function () { play("notify"); return nativeAlert.apply(window, arguments); };
})();

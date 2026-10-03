/* 01-intro-splash.js — Intro / splash screen. Bundled into /app.js in filename order; see README ("Frontend source layout"). */
/* ==== Intro/splash screen (moved from an inline <script> in index.html) ====
   Runs first, before the dashboard code below. app.js is deferred, so the DOM
   (#introScreen etc.) is already parsed by the time this executes. */
(function(){
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var root=document.documentElement, screen=document.getElementById('introScreen'), btn=document.getElementById('introDashboardBtn');
  if(!screen||!btn) return;
  // Compare Periods embeds this same page in two iframes. Each pane used to replay
  // the whole splash (and wait for its own "Enter Dashboard" click), hiding the
  // data it was supposed to compare. Never show the intro inside a frame.
  var inFrame=false; try{ inFrame = window.self !== window.top; }catch(e){ inFrame = true; }
  if(inFrame){ screen.remove(); return; }
  root.classList.add('intro-active');

  // ---- Build the two headlines out of individual letter spans. This is
  // what actually fixes the old "Cupronickel Division overlapping the
  // quote line" bug: instead of a single baked video frame, every line
  // (NON-FERROUS -> Cupronickel Division -> quote -> QUALITY INTELLIGENCE)
  // is its own element, stacked in normal document flow, so nothing can
  // ever sit on top of anything else. ----
  function letters(el,text,extraClass){
    var out=[];
    // Each word lives in its own nowrap group, so a narrow window / browser zoom can only
    // wrap BETWEEN words ("QUALITY" / "INTELLIGENCE"), never in the middle of one.
    var grp=null;
    for(var i=0;i<text.length;i++){
      var isSpace=text[i]===' ';
      if(!grp || isSpace){ grp=document.createElement('span'); grp.className='ivw'; el.appendChild(grp); }
      var s=document.createElement('span');
      s.className='ivch'+(extraClass?(' '+extraClass):'');
      s.textContent=isSpace?'\u00A0':text[i];
      grp.appendChild(s);
      out.push(s);
      if(isSpace) grp=null;
    }
    return out;
  }
  var nfEl=document.getElementById('ivNonFerrous');
  var nfLetters=letters(nfEl,'NON-FERROUS');
  var titleEl=document.getElementById('ivTitle');
  var qLetters=letters(titleEl,'QUALITY','q');
  letters(titleEl,' ');
  var iLetters=letters(titleEl,'INTELLIGENCE','i');
  var titleLetters=Array.prototype.slice.call(titleEl.querySelectorAll('.ivch'));

  // ---- Procedurally-generated "professional" sound design. Nothing is a
  // pre-baked audio file, so every cue is scheduled against the exact
  // millisecond its matching letter/element appears, instead of hoping a
  // separate audio track happens to line up with the animation. ----
  // Sound preference is shared with the dashboard's sound toggle (sfx.js). If the user
  // switched sound off, the intro must stay silent and never create an AudioContext.
  var soundPref=true; try{ var _sp=localStorage.getItem('jsl_qi_sfx_enabled'); soundPref=(_sp===null||_sp==='1'); }catch(e){}
  var AC=window.AudioContext||window.webkitAudioContext;
  var ctx=(AC&&soundPref&&!reduceMotion)?new AC():null;
  // Timeline queue: every at(ms,fn) below is held until startTimeline() runs, so the
  // visuals and the sound always begin together (see the sound-gate section at the end).
  var started=false, queue=[];
  function startTimeline(){ if(started) return; started=true; queue.forEach(function(q){ setTimeout(q[1],q[0]); }); queue=[]; }
  function tone(time,freq,dur,type,peak,glideTo){
    // Only actually schedule a sound while the context is genuinely
    // running. If it's still "suspended" (no user gesture yet — the normal
    // state for the very first thing on a fresh page load), currentTime is
    // frozen, so anything scheduled now would sit queued at that same
    // frozen instant and then all fire in a chaotic burst together the
    // moment the context finally resumes (e.g. on the "Enter Dashboard"
    // click) — audibly landing well after its matching text already
    // appeared. Skipping the cue entirely here is the better trade-off:
    // that one beat plays silently instead of arriving late and out of
    // step with everything else.
    if(!ctx||reduceMotion||ctx.state!=='running') return;
    try{
      var osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.type=type||'sine';
      osc.frequency.setValueAtTime(freq,time);
      if(glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo,time+dur);
      gain.gain.setValueAtTime(0.0001,time);
      gain.gain.exponentialRampToValueAtTime(peak||0.08,time+Math.min(.02,dur*.3));
      gain.gain.exponentialRampToValueAtTime(0.0001,time+dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(time); osc.stop(time+dur+0.03);
    }catch(e){}
  }
  function tick(time,freq){ tone(time,freq,.09,'triangle',.05); }
  function whoosh(time,dur,from,to){
    if(!ctx||reduceMotion||ctx.state!=='running') return; // see the note in tone() above
    try{
      var n=Math.max(1,Math.floor(ctx.sampleRate*dur));
      var buf=ctx.createBuffer(1,n,ctx.sampleRate), data=buf.getChannelData(0);
      for(var i=0;i<n;i++) data[i]=(Math.random()*2-1)*(1-i/n);
      var src=ctx.createBufferSource(); src.buffer=buf;
      var filt=ctx.createBiquadFilter(); filt.type='bandpass'; filt.Q.value=.9;
      filt.frequency.setValueAtTime(from,time);
      filt.frequency.exponentialRampToValueAtTime(to,time+dur);
      var gain=ctx.createGain(); gain.gain.setValueAtTime(.15,time); gain.gain.linearRampToValueAtTime(0,time+dur);
      src.connect(filt).connect(gain).connect(ctx.destination);
      src.start(time); src.stop(time+dur+0.03);
    }catch(e){}
  }
  function chime(time,freqs,dur){ (freqs||[]).forEach(function(f,idx){ tone(time+idx*.05,f,dur||.5,'sine',.065); }); }
  // A rising, filtered "scanner" sweep — synced to the coil scan-line animation above.
  function scanSweepSound(time,dur){
    if(!ctx||reduceMotion||ctx.state!=='running') return;
    try{
      var osc=ctx.createOscillator(), gain=ctx.createGain(), filt=ctx.createBiquadFilter();
      osc.type='sawtooth'; osc.frequency.setValueAtTime(180,time); osc.frequency.exponentialRampToValueAtTime(1300,time+dur*.92);
      filt.type='bandpass'; filt.Q.value=6; filt.frequency.setValueAtTime(300,time); filt.frequency.exponentialRampToValueAtTime(2200,time+dur*.92);
      gain.gain.setValueAtTime(0.0001,time); gain.gain.exponentialRampToValueAtTime(.05,time+.08);
      gain.gain.setValueAtTime(.05,time+dur*.8); gain.gain.exponentialRampToValueAtTime(0.0001,time+dur);
      osc.connect(filt).connect(gain).connect(ctx.destination); osc.start(time); osc.stop(time+dur+.05);
    }catch(e){}
  }
  // A short, soft low-frequency "stamp" thud for the PASS badge.
  function thud(time){
    if(!ctx||reduceMotion||ctx.state!=='running') return;
    try{
      var osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.type='sine'; osc.frequency.setValueAtTime(210,time); osc.frequency.exponentialRampToValueAtTime(70,time+.16);
      gain.gain.setValueAtTime(0.0001,time); gain.gain.exponentialRampToValueAtTime(.14,time+.012); gain.gain.exponentialRampToValueAtTime(0.0001,time+.22);
      osc.connect(gain).connect(ctx.destination); osc.start(time); osc.stop(time+.25);
    }catch(e){}
  }
  // A slow, very quiet ambient pad that swells in under the whole sequence for a
  // cinematic feel, then fades out as the intro is dismissed (see leave() below).
  var padNodes=null;
  function startPad(){
    if(!ctx||reduceMotion||ctx.state!=='running'||padNodes) return;
    try{
      var t=now(), master=ctx.createGain(); master.gain.setValueAtTime(0.0001,t); master.gain.exponentialRampToValueAtTime(.028,t+2.4);
      var filt=ctx.createBiquadFilter(); filt.type='lowpass'; filt.frequency.value=1100;
      master.connect(filt).connect(ctx.destination);
      var oscs=[130.81,164.81,196.0].map(function(f){
        var o=ctx.createOscillator(), g=ctx.createGain();
        o.type='triangle'; o.frequency.value=f; g.gain.value=.5;
        o.connect(g).connect(master); o.start(t);
        return o;
      });
      padNodes={master:master,oscs:oscs};
    }catch(e){}
  }
  function stopPad(){
    if(!padNodes) return;
    try{
      var t=now(); padNodes.master.gain.cancelScheduledValues(t); padNodes.master.gain.setValueAtTime(padNodes.master.gain.value,t);
      padNodes.master.gain.exponentialRampToValueAtTime(0.0001,t+.6);
      padNodes.oscs.forEach(function(o){ o.stop(t+.65); });
    }catch(e){}
    padNodes=null;
  }
  at(150,startPad);

  // ---- Single timeline drives both the visuals and the audio, so the two
  // can never drift apart. Every tone below is scheduled at now() — read
  // fresh, inside the very same setTimeout callback that reveals its
  // matching letter/element — instead of against a single future timeline
  // computed once up front. That "computed once up front" approach was the
  // actual bug: setTimeout delays aren't perfectly precise (the browser can
  // be busy loading fonts/scripts right as the intro starts), so the visual
  // reveal could fire late while the Web Audio clock kept its own exact
  // schedule regardless — the two drifted apart, and on a slow load the
  // gap was big enough to see (and hear). Reading now() at the moment each
  // callback actually runs means a delayed visual and its sound are always
  // delayed by the exact same amount together, so they can't end up
  // out of step with each other.
  function now(){ return ctx? ctx.currentTime : 0; }
  function show(el){ if(el) el.classList.add('show'); }
  function at(ms,fn){ var d=reduceMotion? Math.min(ms,50) : ms; if(started) setTimeout(fn,d); else queue.push([d,fn]); }

  var STEP = reduceMotion? 3 : 42;   // ms per letter, NON-FERROUS
  var TSTEP = reduceMotion? 3 : 36;  // ms per letter, QUALITY INTELLIGENCE

  at(120,function(){ show(document.getElementById('ivLogo')); whoosh(now(),.35,300,1500); });

  var tagEls=Array.prototype.slice.call(document.querySelectorAll('#ivTag .iv'));
  tagEls.forEach(function(el,i){
    var when=430+i*125;
    at(when,function(){ show(el); tick(now(),640+i*65); });
  });

  var nfStart=430+tagEls.length*125+60;
  nfLetters.forEach(function(s,i){
    var when=nfStart+i*STEP;
    at(when,function(){ show(s); tick(now(),560+i*15); });
  });
  var nfEnd=nfStart+nfLetters.length*STEP;
  at(nfEnd+60,function(){ chime(now(),[392,494],.4); });
  at(nfEnd+260,function(){ show(document.getElementById('ivDivision')); tick(now(),340); });
  at(nfEnd+520,function(){ show(document.getElementById('ivQuote')); });

  var titleStart=nfEnd+780;
  titleLetters.forEach(function(s,i){
    var when=titleStart+i*TSTEP;
    at(when,function(){
      show(s);
      var f = s.classList.contains('q') ? (760-i*9) : (s.classList.contains('i') ? (420+i*9) : null);
      if(f) tick(now(),f);
    });
  });
  var titleEnd=titleStart+titleLetters.length*TSTEP;
  at(titleEnd+70,function(){ show(document.getElementById('ivTitleLine')); chime(now(),[523,659,784],.55); });

  var cardEls=Array.prototype.slice.call(document.querySelectorAll('#ivCards .iv'));
  cardEls.forEach(function(el,i){
    var when=titleEnd+300+i*150;
    at(when,function(){ show(el); tick(now(),500+i*90); });
  });
  var cardsEnd=titleEnd+300+cardEls.length*150;

  // The quality-inspection scan/PASS-badge beat (and the ~2.7s it held the
  // "Enter Dashboard" button back for) belonged to the Copper Mill skin,
  // which is gone — data-skin is hardcoded to "classic" and #ivScan/.intro-scan
  // is always display:none now, so that pause was just dead air with no
  // visible payoff. The button now appears right after the cards finish.
  at(cardsEnd+300,function(){ show(btn); });

  var readyAt=cardsEnd+300+500;
  at(readyAt,function(){
    screen.classList.add('intro-ready');
    btn.removeAttribute('disabled'); btn.removeAttribute('aria-disabled'); btn.setAttribute('tabindex','0');
    show(document.getElementById('ivHint'));
    chime(now(),[659,880],.5);
    try{ btn.focus({preventScroll:true}); }catch(e){}
  });

  // ---- Sound gate. Browsers keep an AudioContext "suspended" until the user clicks or
  // presses a key, and Chrome only sometimes waives that (site-engagement based). The old
  // code played the visuals regardless and silently skipped every cue while suspended, so
  // sound was randomly missing, or started midway and lagged behind the animation. Now
  // the sequence begins only once audio can really play: immediately if the browser
  // allows it, otherwise on the first click / key press (a small prompt says so). If
  // nobody interacts, it starts silently after GATE_FALLBACK_MS so the dashboard can
  // never get stuck behind the intro. ----
  // 5 s (was 8 s): while the gate is waiting only the logo + the prompt are visible, so a long
  // wait made the intro look blank/broken.
  var GATE_FALLBACK_MS=5000;
  if(!ctx){ startTimeline(); }
  else if(ctx.state==='running'){ startTimeline(); }
  else{
    var gate=document.createElement('button');
    gate.type='button'; gate.className='intro-sound-gate';
    gate.textContent='\uD83D\uDD0A Click anywhere or press any key to start with sound';
    screen.appendChild(gate);
    // Never leave the middle of the screen empty while we wait for the first click / key:
    // show the brand logo straight away (the headline sequence still waits for the gate so the
    // sound stays in sync). The prompt is centred where the title will appear (see the
    // .intro-sound-gate rule in 15-intro-screen.css).
    show(document.getElementById('ivLogo'));
    var evs=['pointerdown','keydown','touchend','click'], fallbackTimer=null;
    function hideGate(){ gate.classList.add('gone'); setTimeout(function(){ if(gate.parentNode) gate.parentNode.removeChild(gate); },350); }
    function detach(){ evs.forEach(function(ev){ window.removeEventListener(ev,unlock,true); }); }
    function unlock(){
      // resume() rejects for non-activating keys (Shift, Esc...) — then we just keep waiting.
      var p; try{ p=ctx.resume(); }catch(e){ return; }
      if(!p||!p.then) return;
      p.then(function(){
        if(ctx.state!=='running') return;
        detach(); if(fallbackTimer) clearTimeout(fallbackTimer);
        hideGate(); startTimeline();
      },function(){});
    }
    evs.forEach(function(ev){ window.addEventListener(ev,unlock,{capture:true,passive:true}); });
    // Also covers Chrome auto-resuming the context by itself (e.g. autoplay permission granted).
    ctx.onstatechange=function(){ if(ctx.state==='running'&&!started){ detach(); if(fallbackTimer) clearTimeout(fallbackTimer); hideGate(); startTimeline(); } };
    fallbackTimer=setTimeout(function(){ hideGate(); startTimeline(); },GATE_FALLBACK_MS);
  }

  function leave(){
    if(screen.getAttribute('data-leaving')) return;
    screen.setAttribute('data-leaving','1');
    screen.classList.add('intro-hidden');
    root.classList.remove('intro-active');
    stopPad();
    setTimeout(function(){ screen.remove(); if(ctx) ctx.close()['catch'](function(){}); },650);
  }
  btn.addEventListener('click',function(){ if(btn.hasAttribute('disabled')) return; leave(); });
  // Escape is intentionally not a bypass: the intro must be acknowledged through the dashboard CTA.
})();


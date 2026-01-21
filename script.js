/* Presentation-mode single-page site.
   - Offline charts (no CDN)
   - Embedded dataset auto-loads
   - Optional CSV import
*/
<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyBDwVV3ZsAMRjBXB3IZCP5h0DNT6qVmp-s",
    authDomain: "cloud-security-e3283.firebaseapp.com",
    projectId: "cloud-security-e3283",
    storageBucket: "cloud-security-e3283.firebasestorage.app",
    messagingSenderId: "409540918876",
    appId: "1:409540918876:web:624932d1640c2d263cb099",
    measurementId: "G-PZLP8DFPSY"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>
const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => [...el.querySelectorAll(s)];

function clamp(v,min,max){ return Math.max(min, Math.min(max,v)); }

function parseCSV(text){
  // Simple CSV parser (commas, no quoted commas needed for this dataset)
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines[0].split(",").map(h=>h.trim());
  const rows = [];
  for(let i=1;i<lines.length;i++){
    const cols = lines[i].split(",").map(c=>c.trim());
    const obj = {};
    headers.forEach((h,idx)=>obj[h]=cols[idx] ?? "");
    rows.push(obj);
  }
  return rows;
}

function toNum(x){
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function groupBy(arr, key){
  const m = new Map();
  for(const it of arr){
    const k = it[key];
    if(!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

function stats(nums){
  const a = nums.slice().sort((x,y)=>x-y);
  const n = a.length;
  if(n===0) return null;
  const sum = a.reduce((s,v)=>s+v,0);
  const mean = sum/n;
  const med = (n%2? a[(n-1)/2] : (a[n/2-1]+a[n/2])/2);
  const min = a[0], max=a[n-1];
  const variance = a.reduce((s,v)=>s+(v-mean)*(v-mean),0)/n;
  const sd = Math.sqrt(variance);
  return {n, mean, med, min, max, sd};
}

function niceNumber(v){
  if(v >= 1000000) return (v/1000000).toFixed(2)+"M";
  if(v >= 1000) return (v/1000).toFixed(2)+"K";
  return String(Math.round(v));
}

/* ---------- DEMO A: Bounded Buffer sim ---------- */
const BUF_CAP = 10;
let buf = new Array(BUF_CAP).fill(null);
let inIdx=0, outIdx=0, count=0;
let produced=0, consumed=0;
let bufTimer=null;

function renderBuffer(){
  const el = qs("#bufferSlots");
  el.innerHTML="";
  for(let i=0;i<BUF_CAP;i++){
    const d=document.createElement("div");
    d.className="slot"+(buf[i]!==null ? " filled":"");
    d.textContent = buf[i]===null ? "_" : String(buf[i]);
    el.appendChild(d);
  }
  qs("#bufProduced").textContent=produced;
  qs("#bufConsumed").textContent=consumed;
  qs("#bufCount").textContent=count;
}

function setStates(p,c, msg){
  qs("#pState").textContent=p;
  qs("#cState").textContent=c;
  if(msg) qs("#bufExplain").innerHTML = msg;
}

function stepBuffer(){
  // One "tick": choose produce/consume with mild bias so you see full/empty
  const choose = Math.random();
  const tryProduce = choose < 0.55;
  if(tryProduce){
    if(count === BUF_CAP){
      setStates("blocked (full)", "ready", "Buffer is <b>full</b> → producer blocks until a consumer removes an item.");
      return;
    }
    // produce
    const item = Math.floor(Math.random()*9)+1;
    buf[inIdx]=item;
    inIdx=(inIdx+1)%BUF_CAP;
    count++;
    produced++;
    setStates("running", "ready", "Producer writes an item under mutual exclusion, then signals availability.");
  }else{
    if(count === 0){
      setStates("ready", "blocked (empty)", "Buffer is <b>empty</b> → consumer blocks until a producer adds an item.");
      return;
    }
    // consume
    const item = buf[outIdx];
    buf[outIdx]=null;
    outIdx=(outIdx+1)%BUF_CAP;
    count--;
    consumed++;
    setStates("ready", "running", "Consumer reads an item under mutual exclusion, then signals free space.");
  }
  renderBuffer();
}

function startBuffer(){
  if(bufTimer) return;
  setStates("ready","ready","Running… watch for <b>blocked</b> states when buffer becomes full/empty.");
  bufTimer=setInterval(stepBuffer, 550);
}
function pauseBuffer(){ if(bufTimer){ clearInterval(bufTimer); bufTimer=null; } }
function resetBuffer(){
  pauseBuffer();
  buf = new Array(BUF_CAP).fill(null);
  inIdx=0; outIdx=0; count=0; produced=0; consumed=0;
  renderBuffer();
  setStates("ready","ready","Click <b>Start</b> to animate. When the buffer is <b>full</b>, producers block. When it is <b>empty</b>, consumers block.");
}

/* ---------- DEMO B: Priority inversion sim ---------- */
const TICKS = 10;

function buildLanes(){
  const wrap = qs("#piLanes");
  wrap.innerHTML="";
  const mkLane = (name,color)=> {
    const lane=document.createElement("div");
    lane.className="lane";
    lane.innerHTML = `
      <div class="lane-head">
        <div><span class="lane-dot ${color}"></span> ${name}</div>
        <div class="muted">${name==="High (H)" ? "needs mutex" : (name==="Low (L)" ? "holds mutex first" : "preempts L")}</div>
      </div>
      <div class="timeline"></div>
    `;
    wrap.appendChild(lane);
    return lane.querySelector(".timeline");
  };
  const tlH = mkLane("High (H)","dot-red");
  const tlM = mkLane("Medium (M)","dot-amber");
  const tlL = mkLane("Low (L)","dot-green");
  return {tlH, tlM, tlL};
}

const lanes = buildLanes();

function renderTicks(tl, arr){
  tl.innerHTML="";
  for(const t of arr){
    const d=document.createElement("div");
    d.className="tick "+t.kind;
    d.textContent=t.label;
    tl.appendChild(d);
  }
}

function setPI(owner, H, M, L, explain){
  qs("#piOwner").textContent=owner;
  qs("#piH").textContent=H;
  qs("#piM").textContent=M;
  qs("#piL").textContent=L;
  if(explain) qs("#piExplain").innerHTML=explain;
}

function resetPI(){
  renderTicks(lanes.tlH, new Array(TICKS).fill(0).map((_,i)=>({kind:"wait",label:"."})));
  renderTicks(lanes.tlM, new Array(TICKS).fill(0).map((_,i)=>({kind:"wait",label:"."})));
  renderTicks(lanes.tlL, new Array(TICKS).fill(0).map((_,i)=>({kind:"wait",label:"."})));
  setPI("none","ready","ready","ready",
    "In inversion: L holds the mutex, H blocks, and M keeps running → H waits “too long”. With inheritance: L temporarily inherits H's priority → releases mutex sooner.");
}

function runPI(withInheritance){
  // Scenario:
  // Tick 0-2: L runs and acquires mutex
  // Tick 2: H becomes ready and blocks on mutex
  // Tick 3-7: M runs (preempts L) causing inversion if no inheritance
  // Tick 8-9: L runs and releases; H finally runs
  const H=[], M=[], L=[];
  for(let i=0;i<TICKS;i++){
    H.push({kind:"wait",label:"."});
    M.push({kind:"wait",label:"."});
    L.push({kind:"wait",label:"."});
  }

  // L acquires mutex early
  L[0]={kind:"hold",label:"lock"};
  L[1]={kind:"run",label:"work"};
  L[2]={kind:"hold",label:"hold"};

  // H arrives and blocks
  H[2]={kind:"block",label:"blocked"};
  H[3]={kind:"block",label:"blocked"};
  H[4]={kind:"block",label:"blocked"};
  H[5]={kind:"block",label:"blocked"};
  H[6]={kind:"block",label:"blocked"};
  H[7]={kind:"block",label:"blocked"};

  // Medium runs
  for(let i=3;i<=7;i++){
    M[i]={kind:"run",label:"run"};
  }

  if(withInheritance){
    // L inherits priority and runs sooner: shorten medium window
    for(let i=3;i<=5;i++) M[i]={kind:"run",label:"run"};
    for(let i=6;i<=7;i++) M[i]={kind:"wait",label:"."};
    L[3]={kind:"run",label:"boost"};
    L[4]={kind:"run",label:"work"};
    L[5]={kind:"hold",label:"unlock"};
    // H runs earlier
    H[6]={kind:"run",label:"run"};
    H[7]={kind:"run",label:"run"};
    setPI("L (boosted)","blocked → runs","runs (shorter)","runs (boosted)",
      "With <b>priority inheritance</b>, L temporarily gets H's priority so it runs and releases the mutex sooner. H waits less.");
  }else{
    // L starved by M
    L[3]={kind:"wait",label:"starve"};
    L[4]={kind:"wait",label:"starve"};
    L[5]={kind:"wait",label:"starve"};
    L[6]={kind:"wait",label:"starve"};
    L[7]={kind:"wait",label:"starve"};
    L[8]={kind:"run",label:"resume"};
    L[9]={kind:"hold",label:"unlock"};
    // H finally runs at end
    H[8]={kind:"block",label:"blocked"};
    H[9]={kind:"run",label:"run"};
    setPI("L","blocked (long)","runs","starved",
      "Without inheritance: L holds the mutex, but M preempts L → H stays blocked even though it is highest priority. That's <b>priority inversion</b>.");
  }

  renderTicks(lanes.tlH, H);
  renderTicks(lanes.tlM, M);
  renderTicks(lanes.tlL, L);
}

/* ---------- Offline Charts (Canvas) ---------- */
const palette = {
  axis: "rgba(255,255,255,.35)",
  grid: "rgba(255,255,255,.08)",
  text: "rgba(255,255,255,.80)",
  textMuted: "rgba(255,255,255,.55)",
  a: "rgba(106,167,255,.95)",
  b: "rgba(167,139,250,.95)",
  good: "rgba(52,211,153,.95)",
  warn: "rgba(251,191,36,.95)",
  bad: "rgba(248,113,113,.95)"
};

function clearCanvas(c){
  const ctx=c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);
}

function drawAxes(ctx, w, h, pad){
  ctx.strokeStyle = palette.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h-pad);
  ctx.lineTo(w-pad, h-pad);
  ctx.stroke();
}

function drawGrid(ctx, w, h, pad, lines=5){
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  for(let i=1;i<=lines;i++){
    const y = pad + (h-2*pad) * (i/lines);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w-pad, y);
    ctx.stroke();
  }
}

function drawBarChart(canvas, labels, values, opts){
  const ctx = canvas.getContext("2d");
  const w=canvas.width, h=canvas.height;
  const pad=60;
  clearCanvas(canvas);
  drawGrid(ctx,w,h,pad,5);
  drawAxes(ctx,w,h,pad);

  const maxV = Math.max(...values) * 1.10;
  const bw = (w - 2*pad) / values.length;

  ctx.fillStyle = palette.text;
  ctx.font = "14px ui-sans-serif,system-ui";
  // y labels
  ctx.fillStyle = palette.textMuted;
  for(let i=0;i<=5;i++){
    const v = maxV * (1 - i/5);
    const y = pad + (h-2*pad)*(i/5);
    ctx.fillText(opts.formatY(v), 10, y+4);
  }

  values.forEach((v, i)=>{
    const x0 = pad + i*bw + bw*0.18;
    const barW = bw*0.64;
    const barH = (h-2*pad) * (v/maxV);
    const y0 = (h-pad) - barH;

    const grad = ctx.createLinearGradient(0,y0,0,y0+barH);
    grad.addColorStop(0, palette.a);
    grad.addColorStop(1, palette.b);

    ctx.fillStyle = grad;
    ctx.beginPath();
    roundRect(ctx, x0, y0, barW, barH, 12);
    ctx.fill();

    ctx.fillStyle = palette.text;
    ctx.font = "13px ui-sans-serif,system-ui";
    ctx.textAlign = "center";
    ctx.fillText(opts.formatValue(v), x0 + barW/2, y0 - 10);

    ctx.fillStyle = palette.textMuted;
    ctx.fillText(labels[i], x0 + barW/2, h - 22);
  });

  ctx.textAlign="left";
}

function drawRangeChart(canvas, labels, mins, meds, maxs){
  const ctx = canvas.getContext("2d");
  const w=canvas.width, h=canvas.height;
  const pad=60;
  clearCanvas(canvas);
  drawGrid(ctx,w,h,pad,5);
  drawAxes(ctx,w,h,pad);

  const maxV = Math.max(...maxs) * 1.12;
  const bw = (w - 2*pad) / labels.length;

  // y axis labels
  ctx.fillStyle = palette.textMuted;
  ctx.font = "14px ui-sans-serif,system-ui";
  for(let i=0;i<=5;i++){
    const v = maxV * (1 - i/5);
    const y = pad + (h-2*pad)*(i/5);
    ctx.fillText(v.toFixed(2)+"s", 10, y+4);
  }

  for(let i=0;i<labels.length;i++){
    const x = pad + i*bw + bw/2;
    const yMin = mapY(mins[i], maxV, h, pad);
    const yMax = mapY(maxs[i], maxV, h, pad);
    const yMed = mapY(meds[i], maxV, h, pad);

    // range line
    ctx.strokeStyle = palette.a;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, yMin);
    ctx.lineTo(x, yMax);
    ctx.stroke();

    // median dot
    ctx.fillStyle = palette.b;
    ctx.beginPath();
    ctx.arc(x, yMed, 7, 0, Math.PI*2);
    ctx.fill();

    // labels
    ctx.fillStyle = palette.textMuted;
    ctx.textAlign="center";
    ctx.fillText(labels[i], x, h-22);
    ctx.textAlign="left";
  }
}

function drawRunsChart(canvas, label, values){
  const ctx = canvas.getContext("2d");
  const w=canvas.width, h=canvas.height;
  const pad=60;
  clearCanvas(canvas);
  drawGrid(ctx,w,h,pad,5);
  drawAxes(ctx,w,h,pad);

  const maxV = Math.max(...values) * 1.15;
  const bw = (w - 2*pad) / values.length;

  // y labels
  ctx.fillStyle = palette.textMuted;
  ctx.font = "14px ui-sans-serif,system-ui";
  for(let i=0;i<=5;i++){
    const v = maxV * (1 - i/5);
    const y = pad + (h-2*pad)*(i/5);
    ctx.fillText(v.toFixed(2)+"s", 10, y+4);
  }

  // title
  ctx.fillStyle = palette.text;
  ctx.font = "16px ui-sans-serif,system-ui";
  ctx.fillText(label, pad, 28);

  values.forEach((v,i)=>{
    const x0 = pad + i*bw + bw*0.18;
    const barW = bw*0.64;
    const barH = (h-2*pad) * (v/maxV);
    const y0 = (h-pad) - barH;

    ctx.fillStyle = palette.a;
    ctx.beginPath();
    roundRect(ctx, x0, y0, barW, barH, 12);
    ctx.fill();

    ctx.fillStyle = palette.textMuted;
    ctx.font = "13px ui-sans-serif,system-ui";
    ctx.textAlign="center";
    ctx.fillText("Run "+(i+1), x0+barW/2, h-22);
    ctx.textAlign="left";
  });
}

function roundRect(ctx, x,y,w,h,r){
  const rr = Math.min(r, w/2, h/2);
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
}

function mapY(v, maxV, h, pad){
  const t = v/maxV;
  return (h-pad) - (h-2*pad)*t;
}

let DATA_ROWS = [];
let currentMetric = "seconds";
let selectedMethod = null;

function normalizeRows(rows){
  // Accept either our extended columns or minimal CSV
  return rows.map(r=>{
    const method = r.method ?? r.Method ?? r.name ?? "";
    const run = toNum(r.run ?? r.Run) ?? 1;
    const items = toNum(r.items ?? r.Items) ?? 600000;
    const seconds = toNum(r.seconds ?? r.Seconds ?? r.time ?? r.Time);
    const throughput = toNum(r.throughput_items_per_sec ?? r.throughput ?? r.Throughput) ?? (seconds? items/seconds : null);
    return {method, run, items, seconds, throughput};
  }).filter(r=>r.method && r.seconds!=null);
}

function rebuildUI(){
  const byMethod = groupBy(DATA_ROWS, "method");
  const methods = [...byMethod.keys()];

  // buttons
  const btnWrap = qs("#methodButtons");
  btnWrap.innerHTML="";
  methods.forEach((m,idx)=>{
    const b=document.createElement("button");
    b.className="seg-btn"+((selectedMethod??methods[0])===m ? " active":"");
    b.textContent=m;
    b.onclick=()=>{
      selectedMethod=m;
      qsa(".seg-btn", btnWrap).forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      renderAll();
    };
    btnWrap.appendChild(b);
  });
  if(!selectedMethod) selectedMethod=methods[0];

  // winner cards
  const winners = computeWinners(byMethod);
  const wc = qs("#winnerCards");
  wc.innerHTML="";
  winners.forEach(w=>{
    const d=document.createElement("div");
    d.className="winner";
    d.innerHTML = `<h4>${w.title}</h4><div class="why">${w.why}</div>`;
    wc.appendChild(d);
  });
}

function computeWinners(byMethod){
  const rows = [];
  byMethod.forEach((arr, method)=>{
    const s = stats(arr.map(x=>x.seconds));
    const t = stats(arr.map(x=>x.throughput));
    rows.push({method, s, t});
  });
  rows.sort((a,b)=>a.s.mean-b.s.mean);
  const fastest = rows[0];
  const stable = rows.slice().sort((a,b)=>a.s.sd-b.s.sd)[0];
  const bestThrough = rows.slice().sort((a,b)=>b.t.mean-a.t.mean)[0];

  return [
    {
      title: `Fastest (lowest avg time): ${fastest.method}`,
      why: `Wins when the waiting strategy blocks efficiently and keeps lock hold-times small. Low average time ≈ better throughput under this workload.`
    },
    {
      title: `Highest throughput: ${bestThrough.method}`,
      why: `More items/second usually means less idle waiting and fewer wasted CPU cycles (especially compared to busy-wait).`
    },
    {
      title: `Most stable (lowest variance): ${stable.method}`,
      why: `Tight run-to-run spread suggests the method handles contention predictably and avoids performance cliffs.`
    },
    {
      title: `Why busy-wait often loses`,
      why: `Mutex-only busy-wait wastes CPU while waiting. Under contention, this hurts scalability and can increase total time.`
    }
  ];
}

function renderAll(){
  const byMethod = groupBy(DATA_ROWS, "method");
  const labels = [...byMethod.keys()];

  // bar chart metric
  let values, caption, formatY, formatValue;
  if(currentMetric==="seconds"){
    values = labels.map(m=>stats(byMethod.get(m).map(x=>x.seconds)).mean);
    caption = "Lower is better. This is the average wall-clock time across runs.";
    formatY = v => v.toFixed(2)+"s";
    formatValue = v => v.toFixed(2)+"s";
  }else{
    values = labels.map(m=>stats(byMethod.get(m).map(x=>x.throughput)).mean);
    caption = "Higher is better. Throughput is items per second.";
    formatY = v => niceNumber(v)+"/s";
    formatValue = v => niceNumber(v)+"/s";
  }
  qs("#barCaption").textContent=caption;
  drawBarChart(qs("#chartBar"), labels, values, {formatY, formatValue});

  // range chart (seconds)
  const mins = labels.map(m=>stats(byMethod.get(m).map(x=>x.seconds)).min);
  const meds = labels.map(m=>stats(byMethod.get(m).map(x=>x.seconds)).med);
  const maxs = labels.map(m=>stats(byMethod.get(m).map(x=>x.seconds)).max);
  drawRangeChart(qs("#chartRange"), labels, mins, meds, maxs);

  // per-run chart
  const runs = byMethod.get(selectedMethod).slice().sort((a,b)=>a.run-b.run).map(x=>x.seconds);
  drawRunsChart(qs("#chartRuns"), selectedMethod, runs);
}

/* ---------- Guided tour ---------- */
const tourSteps = [
  {id:"#start", title:"Intro", text:"Open with the problem statement and the goals: correctness, no deadlock, and performance."},
  {id:"#demos", title:"Demos", text:"Run Demo A (buffer) then Demo B (priority inversion). Let the audience predict what happens."},
  {id:"#results", title:"Results", text:"Show which method wins on time/throughput and explain why blocking beats busy-wait under contention."},
  {id:"#implementation", title:"Implementation", text:"Map each method to its .c file and explain each team member’s contribution."},
  {id:"#appendix", title:"Appendix", text:"Use the vertical blocks for clear comparisons + correctness/testing checklists."},
];

let stepIdx=0;
function openTour(){
  qs("#tour").classList.remove("hidden");
  stepIdx=0;
  renderTour();
}
function closeTour(){ qs("#tour").classList.add("hidden"); unhighlight(); }
function renderTour(){
  const s = tourSteps[stepIdx];
  qs("#tourTitle").textContent = `Step ${stepIdx+1}/${tourSteps.length} — ${s.title}`;
  qs("#tourText").textContent = s.text;
  highlight(s.id);
}
function highlight(sel){
  unhighlight();
  const el = qs(sel);
  if(!el) return;
  el.scrollIntoView({behavior:"smooth", block:"start"});
  el.classList.add("highlighted");
  setTimeout(()=>el.classList.remove("highlighted"), 1200);
}
function unhighlight(){ /* no persistent highlights */ }

/* ---------- Events ---------- */
function wire(){
  // buffer demo
  qs("#bufStart").onclick=startBuffer;
  qs("#bufPause").onclick=pauseBuffer;
  qs("#bufStep").onclick=()=>{ pauseBuffer(); stepBuffer(); };
  qs("#bufReset").onclick=resetBuffer;

  // PI demo
  qs("#piNoInherit").onclick=()=>runPI(false);
  qs("#piWithInherit").onclick=()=>runPI(true);
  qs("#piReset").onclick=resetPI;

  // tour
  qs("#startTour").onclick=openTour;
  qs("#tourClose").onclick=closeTour;
  qs("#tourPrev").onclick=()=>{ stepIdx = clamp(stepIdx-1,0,tourSteps.length-1); renderTour(); };
  qs("#tourNext").onclick=()=>{ stepIdx = clamp(stepIdx+1,0,tourSteps.length-1); renderTour(); };

  // jumps
  qs("#jumpResults").onclick=()=>qs("#results").scrollIntoView({behavior:"smooth"});
  qs("#jumpDemos").onclick=()=>qs("#demos").scrollIntoView({behavior:"smooth"});

  // presenter toggle
  qs("#presenterToggle").onclick=()=>{
    document.documentElement.classList.toggle("presenter");
    const pressed = document.documentElement.classList.contains("presenter");
    qs("#presenterToggle").setAttribute("aria-pressed", pressed ? "true":"false");
  };

  // metric buttons
  qsa("[data-metric]").forEach(b=>{
    b.onclick=()=>{
      currentMetric=b.getAttribute("data-metric")==="throughput" ? "throughput":"seconds";
      renderAll();
    };
  });

  // CSV import
  qs("#csvInput").addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const text = await file.text();
    const rows = normalizeRows(parseCSV(text));
    if(rows.length<2){
      alert("CSV loaded, but it does not look valid. Expected columns like method,run,items,seconds.");
      return;
    }
    DATA_ROWS = rows;
    selectedMethod = null;
    rebuildUI();
    renderAll();
  });

  qs("#loadEmbedded").onclick=loadEmbedded;
}

async function loadEmbedded(){
  const res = await fetch("assets/embedded_results.csv");
  const text = await res.text();
  DATA_ROWS = normalizeRows(parseCSV(text));
  selectedMethod = null;
  rebuildUI();
  renderAll();
}

/* ---------- Boot ---------- */
resetBuffer();
resetPI();
wire();
loadEmbedded();

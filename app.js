const googleScriptURL = GsheetUrl; 
let currentUser = null, memSocieties = [], memBranches = [];
let currentBulkUser = null, currentBulkWork = null;

const dbName = "AuditAppDB_Final_v8"; // 🔥 Bumping version to force refresh
let db;

document.addEventListener("DOMContentLoaded", () => {
    const today = new Date();
    const todayStr = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    document.getElementById('auditDate').max = todayStr;
});

const request = indexedDB.open(dbName, 1);
request.onupgradeneeded = (e) => {
    db = e.target.result;
    ["Attendance", "WorkMaster", "SocietyMaster", "BranchMaster", "UserMaster"].forEach(s => {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: (s === "BranchMaster" || s === "Attendance") ? "id" : (s === "UserMaster" ? "email" : "name") });
    });
};
request.onsuccess = (e) => { db = e.target.result; loadAllMasters(); checkSession(); };

function isAdminUser() { return currentUser && currentUser.role && currentUser.role.trim().toLowerCase() === 'admin'; }

function formatDisplayDate(d) {
    if (!d) return ""; let c = d.toString().replace("'", "");
    if (c.includes('T')) { let dt = new Date(c); return `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`; }
    let p = c.split('-'); return p.length === 3 ? (p[0].length === 4 ? `${p[2]}-${p[1]}-${p[0]}` : c) : c;
}

function getSortableDate(d) {
    if (!d) return "0"; let c = d.toString().replace("'", "");
    if (c.includes('T')) { let dt = new Date(c); return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`; }
    let p = c.split('-'); return p.length === 3 ? (p[0].length === 4 ? p.join('') : `${p[2]}${p[1]}${p[0]}`) : "0";
}

let toastTimeout;
function showToast(m) { const t = document.getElementById('syncToast'); t.innerText = m; t.style.display = "block"; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => t.style.display = "none", 3500); }
function showLoading(t = "Processing...") { document.getElementById('loadingText').innerText = t; document.getElementById('loadingOverlay').classList.add('active'); }
function hideLoading() { document.getElementById('loadingOverlay').classList.remove('active'); }

function checkSession() {
    const s = localStorage.getItem('audit_user_session');
    if (s) {
        currentUser = JSON.parse(s);
        document.getElementById('login-screen').classList.remove('active-screen');
        document.getElementById('app-screen').classList.add('active-screen');
        document.getElementById('userBadge').innerText = currentUser.name;
        if (isAdminUser()) { document.getElementById('nav-masters').style.display = ''; document.getElementById('adminUserFilter').style.display = ''; }
        const t = localStorage.getItem('audit_active_tab') || 'attendance';
        switchPage(t, document.getElementById('nav-' + t));
        startAutoSync();
    }
}

function logout() { if(confirm("Logout?")) { localStorage.clear(); location.reload(); } }

function handleGoogleLogin(r) {
    showLoading("Authenticating...");
    const p = JSON.parse(atob(r.credential.split('.')[1]));
    fetch(googleScriptURL, { method: 'POST', body: JSON.stringify({ action: "login_and_sync", email: p.email.toLowerCase(), name: p.name }) })
    .then(res => res.json()).then(data => {
        hideLoading();
        if (data.status === "success") {
            currentUser = { email: p.email.toLowerCase(), name: data.userName, role: data.role };
            localStorage.setItem('audit_user_session', JSON.stringify(currentUser));
            syncMastersToLocal(data.masters);
            checkSession();
        } else { showToast("Access Denied"); }
    }).catch(() => { hideLoading(); showToast("Error"); });
}

function syncMastersToLocal(m) {
    const tx = db.transaction(["WorkMaster", "SocietyMaster", "BranchMaster", "UserMaster"], "readwrite");
    tx.objectStore("WorkMaster").clear(); m.works.forEach(w => tx.objectStore("WorkMaster").put(w));
    tx.objectStore("SocietyMaster").clear(); m.societies.forEach(s => tx.objectStore("SocietyMaster").put(s));
    tx.objectStore("BranchMaster").clear(); m.branches.forEach(b => { b.id = b.societyCode + "_" + b.name; tx.objectStore("BranchMaster").put(b); });
    tx.objectStore("UserMaster").clear(); if(m.users) m.users.forEach(u => tx.objectStore("UserMaster").put(u));
    tx.oncomplete = () => loadAllMasters();
}

function loadAllMasters() {
    db.transaction("WorkMaster", "readonly").objectStore("WorkMaster").getAll().onsuccess = (e) => {
        const works = e.target.result;
        const openWorks = works.filter(w => w.status !== 'Completed');
        document.getElementById('workSelect').innerHTML = `<option value="">Select Work</option>` + openWorks.map(w => `<option value="${w.name}">${w.name}</option>`).join('');
        document.getElementById('reportWorkSelect').innerHTML = `<option value="ALL">-- All Audits --</option>` + works.map(w => `<option value="${w.name}">${w.name}</option>`).join('');
        
        const wTbody = document.querySelector('#masterWorksTable tbody');
        if(wTbody) {
            if(works.length === 0) wTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:20px;">No Jobs Syncing...</td></tr>';
            else wTbody.innerHTML = works.map(w => {
                const isC = w.status === 'Completed';
                return `<tr><td style="padding-left:12px;"><b>${w.name}</b></td><td style="text-align:center;"><span class="badge ${isC?'bg-rejected':'bg-approved'}">${w.status||'Open'}</span></td><td style="text-align:right;padding-right:12px;"><button class="btn btn-outline" style="padding:6px;font-size:10px;" onclick="toggleWorkStatus('${w.name}','${isC?'Open':'Completed'}')">${isC?'Open':'Close'}</button></td></tr>`;
            }).join('');
        }
    };
    db.transaction("UserMaster", "readonly").objectStore("UserMaster").getAll().onsuccess = (e) => {
        document.getElementById('reportUserSelect').innerHTML = `<option value="ALL">-- All Users --</option>` + e.target.result.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
    };
    db.transaction("SocietyMaster", "readonly").objectStore("SocietyMaster").getAll().onsuccess = (e) => {
        memSocieties = e.target.result;
        const sOpts = `<option value="">Select Society</option>` + memSocieties.map(s => `<option value="${s.code}">${s.name}</option>`).join('');
        document.getElementById('society1').innerHTML = sOpts; document.getElementById('society2').innerHTML = sOpts; document.getElementById('masterSocSelect').innerHTML = sOpts;
    };
    db.transaction("BranchMaster", "readonly").objectStore("BranchMaster").getAll().onsuccess = (e) => memBranches = e.target.result;
}
function switchPage(pId, nav = null) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('page-' + pId).classList.add('active-page');
    if (!nav) nav = document.getElementById('nav-' + pId);
    if (nav) nav.classList.add('active');
    localStorage.setItem('audit_active_tab', pId);
    if(pId === 'report') renderReport();
}

function cascadeBranch(sId, bId) {
    const c = document.getElementById(sId).value;
    const b = document.getElementById(bId);
    b.innerHTML = '<option value="">Select Branch</option>';
    memBranches.filter(x => x.societyCode === c).forEach(x => b.add(new Option(x.name, x.name)));
}
document.getElementById('society1').addEventListener('change', () => cascadeBranch('society1', 'branch1'));
document.getElementById('society2').addEventListener('change', () => cascadeBranch('society2', 'branch2'));
document.getElementById('visitType').addEventListener('change', (e) => {
    const isS = e.target.value === 'split';
    document.getElementById('visit2Group').style.display = isS ? 'block' : 'none';
    document.getElementById('society2').required = isS;
});

function addMaster(type, id) {
    const v = document.getElementById(id).value.trim(); if (!v) return;
    showLoading();
    fetch(googleScriptURL, { method: 'POST', body: JSON.stringify({ action: "add_master", type: "Works", email: currentUser.email, data: [v, "Open"] }) })
    .then(r => r.json()).then(() => { document.getElementById(id).value = ""; autoSync(); });
}

function toggleWorkStatus(w, s) {
    if (!confirm(`Mark ${w} as ${s}?`)) return;
    showLoading();
    fetch(googleScriptURL, { method: 'POST', body: JSON.stringify({ action: "update_work_status", email: currentUser.email, workName: w, status: s }) })
    .then(() => autoSync());
}

document.getElementById('auditForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const dVal = document.getElementById('auditDate').value;
    if(dVal > new Date().toISOString().split('T')[0]) return showToast("No future dates!");
    showLoading("Saving...");
    const work = document.getElementById('workSelect').value;
    const loc = document.getElementById('visitType').value === "full" ? 
        `${document.getElementById('branch1').value} (${document.getElementById('society1').value})` :
        `${document.getElementById('branch1').value} (${document.getElementById('society1').value}) / ${document.getElementById('branch2').value} (${document.getElementById('society2').value})`;
    const payload = { id: Date.now().toString(), workName: work, userName: currentUser.name, date: dVal, place: loc, manDay: 1, status: "Pending", isSynced: false };
    const tx = db.transaction("Attendance", "readwrite");
    tx.objectStore("Attendance").add(payload);
    tx.oncomplete = () => { document.getElementById('auditForm').reset(); autoSync(); showToast("Saved!"); };
});

let syncInterval = null, isSyncing = false;
function startAutoSync() { if (syncInterval) clearInterval(syncInterval); autoSync(); syncInterval = setInterval(autoSync, 60000); }

async function autoSync() {
    if (isSyncing || !currentUser || !navigator.onLine) return;
    isSyncing = true;
    try {
        const pending = await new Promise(res => { db.transaction("Attendance","readonly").objectStore("Attendance").getAll().onsuccess = e => res(e.target.result.filter(r => !r.isSynced)); });
        if (pending.length > 0) {
            await fetch(googleScriptURL, { method: 'POST', body: JSON.stringify({ action: "insert_attendance", email: currentUser.email, data: pending }) });
        }
        const f = await fetch(googleScriptURL, { method: 'POST', body: JSON.stringify({ action: "fetch_updates", email: currentUser.email }) });
        const res = await f.json();
        if (res.status === "success") {
            const tx = db.transaction(["Attendance","WorkMaster","SocietyMaster","BranchMaster","UserMaster"], "readwrite");
            const cloudIds = new Set(res.data.map(r => r.id.toString()));
            tx.objectStore("Attendance").getAll().onsuccess = e => { e.target.result.forEach(r => { if(r.isSynced && !cloudIds.has(r.id.toString())) tx.objectStore("Attendance").delete(r.id); }); };
            res.data.forEach(r => { r.isSynced = true; tx.objectStore("Attendance").put(r); });
            syncMastersToLocal(res.masters);
        }
    } catch (e) {} finally { isSyncing = false; hideLoading(); }
}

function updateSyncUI(s, t) { document.getElementById('syncStatusText').innerText = t; }

function renderReport() {
    db.transaction("Attendance", "readonly").objectStore("Attendance").getAll().onsuccess = (e) => {
        let recs = e.target.result;
        if (!isAdminUser()) recs = recs.filter(r => r.userName === currentUser.name);
        const groups = {};
        recs.forEach(r => {
            const k = isAdminUser() ? `${r.userName}_${r.workName}` : r.workName;
            if(!groups[k]) groups[k] = { u: r.userName, w: r.workName, total: 0, p: 0, r: [] };
            groups[k].total++; if(r.status === 'Pending') groups[k].p++; groups[k].r.push(r);
        });
        const arr = Object.values(groups).sort((a,b) => Math.max(...b.r.map(x=>getSortableDate(x.date))) - Math.max(...a.r.map(x=>getSortableDate(x.date))));
        document.querySelector('#reportTable tbody').innerHTML = arr.map(g => `<tr onclick="openBulkView('${g.u}','${g.w}')"><td><b>${isAdminUser()?g.u:''}</b><br>${g.w}</td><td>${g.total}</td><td><span class="badge ${g.p>0?'bg-pending':'bg-approved'}">${g.p>0?g.p+' Pending':'Approved'}</span></td><td>➔</td></tr>`).join('');
    };
}

function openBulkView(u, w) {
    currentBulkUser = u; currentBulkWork = w;
    switchPage('bulk-approval');
    document.getElementById('bulkViewTitle').innerHTML = `<b>${u}</b><br>${w}`;
    db.transaction("Attendance", "readonly").objectStore("Attendance").getAll().onsuccess = (e) => {
        const recs = e.target.result.filter(r => r.userName === u && r.workName === w).sort((a,b) => getSortableDate(b.date) - getSortableDate(a.date));
        let pen = recs.filter(r => r.status === 'Pending').length;
        document.getElementById('bulkSummaryInfo').innerHTML = `<span class="badge bg-pending">${pen} Pending</span> <span class="badge bg-approved">${recs.length - pen} Done</span>`;
        document.getElementById('bulkActionHeader').style.display = (isAdminUser() && pen > 0) ? 'flex' : 'none';
        document.getElementById('bulkListContainer').innerHTML = recs.map(r => `
            <div class="bulk-card ${isAdminUser()&&r.status==='Pending'?'selectable':''}" id="card-${r.id}" onclick="toggleCardSelection('${r.id}')">
                <div class="custom-cb"></div>
                <div style="flex:1"><b>${formatDisplayDate(r.date)}</b><br><small>${r.place}</small></div>
                <span class="badge ${r.status==='Approved'?'bg-approved':(r.status==='Rejected'?'bg-rejected':'bg-pending')}">${r.status}</span>
            </div>`).join('');
    };
}

window.toggleCardSelection = function(id) {
    const c = document.getElementById('card-' + id);
    if(c && c.classList.contains('selectable')) {
        c.classList.toggle('selected');
        const count = document.querySelectorAll('.bulk-card.selected').length;
        document.getElementById('bulkActionButtons').style.display = count > 0 ? 'flex' : 'none';
        document.getElementById('bulkSelectionCount').innerText = count + " Selected";
    }
};

window.toggleSelectAllCards = function() {
    const m = document.getElementById('masterCb'); m.classList.toggle('selected');
    document.querySelectorAll('.bulk-card.selectable').forEach(c => {
        if(m.classList.contains('selected')) c.classList.add('selected');
        else c.classList.remove('selected');
    });
    toggleCardSelection('dummy'); // Trigger UI update
};

function submitBulkUpdate(s) {
    const ids = Array.from(document.querySelectorAll('.bulk-card.selected')).map(c => ({ id: c.id.replace('card-',''), status: s }));
    showLoading();
    fetch(googleScriptURL, { method: 'POST', body: JSON.stringify({ action: "update_attendance", email: currentUser.email, data: ids }) })
    .then(() => { autoSync(); openBulkView(currentBulkUser, currentBulkWork); });
}

function closeBulkView() { switchPage('report'); }

if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js'); }

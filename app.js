// ==========================================
// CONFIGURATION (Pulls from const.js)
// ==========================================
const googleScriptURL = GsheetUrl; 

let currentUser = null;
let memSocieties = [];
let memBranches = [];

let currentBulkUser = null;
let currentBulkWork = null;

const dbName = "AuditAppDB_Final_v7"; 
let db;

const request = indexedDB.open(dbName, 1);
request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("Attendance")) db.createObjectStore("Attendance", { keyPath: "id" });
    if (!db.objectStoreNames.contains("WorkMaster")) db.createObjectStore("WorkMaster", { keyPath: "name" });
    if (!db.objectStoreNames.contains("SocietyMaster")) db.createObjectStore("SocietyMaster", { keyPath: "code" });
    if (!db.objectStoreNames.contains("BranchMaster")) db.createObjectStore("BranchMaster", { keyPath: "id" }); 
    if (!db.objectStoreNames.contains("UserMaster")) db.createObjectStore("UserMaster", { keyPath: "email" }); 
};
request.onsuccess = (e) => { 
    db = e.target.result; 
    loadAllMasters(); 
    checkSession(); 
};

// ==========================================
// DATE & SECURITY HELPERS
// ==========================================
function isAdminUser() {
    return currentUser && currentUser.role && currentUser.role.trim().toLowerCase() === 'admin';
}

function formatDisplayDate(dateStr) {
    if (!dateStr) return "";
    let cleanDate = dateStr.toString().replace("'", "");
    if (cleanDate.includes('T')) {
        const d = new Date(cleanDate);
        return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    }
    const parts = cleanDate.split('-');
    if (parts.length === 3) {
        if (parts[0].length === 4) return `${parts[2]}-${parts[1]}-${parts[0]}`;
        if (parts[2].length === 4) return cleanDate;
    }
    return cleanDate;
}

function getSortableDate(dateStr) {
    if (!dateStr) return "0";
    let cleanDate = dateStr.toString().replace("'", "");
    if (cleanDate.includes('T')) {
        const d = new Date(cleanDate);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    }
    const parts = cleanDate.split('-');
    if (parts.length === 3) {
        if (parts[0].length === 4) return `${parts[0]}${parts[1]}${parts[2]}`;
        if (parts[2].length === 4) return `${parts[2]}${parts[1]}${parts[0]}`;
    }
    return "0";
}

let toastTimeout;
function showToast(message) {
    const toast = document.getElementById('syncToast');
    if (!toast) return;
    toast.innerText = message; 
    toast.style.display = "block";
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => { toast.style.display = "none"; }, 3500);
}

function showLoading(text = "Processing...") {
    document.getElementById('loadingText').innerText = text;
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() { document.getElementById('loadingOverlay').classList.remove('active'); }

// ==========================================
// SECURE GOOGLE AUTH & SESSION
// ==========================================
function checkSession() {
    const savedSession = localStorage.getItem('audit_user_session');
    if (savedSession) {
        currentUser = JSON.parse(savedSession);
        document.getElementById('login-screen').classList.remove('active-screen');
        document.getElementById('app-screen').classList.add('active-screen');
        document.getElementById('userBadge').innerText = `${currentUser.name}`;

        if (isAdminUser()) {
            document.getElementById('nav-masters').style.display = ''; 
            document.getElementById('adminUserFilter').style.display = ''; 
        }
        
        const savedTab = localStorage.getItem('audit_active_tab') || 'attendance';
        switchPage(savedTab, document.getElementById('nav-' + savedTab));

        startAutoSync();
    }
}

function logout() {
    if(window.confirm("Are you sure you want to log out?")) {
        localStorage.removeItem('audit_user_session');
        localStorage.removeItem('audit_active_tab'); 
        if(syncInterval) clearInterval(syncInterval);
        location.reload(); 
    }
}

function decodeJwtResponse(token) {
    let base64Url = token.split('.')[1];
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')));
}

function handleGoogleLogin(response) {
    const payload = decodeJwtResponse(response.credential);
    const googleEmail = payload.email.toLowerCase();
    const errorText = document.getElementById('loginError');
    
    errorText.style.color = "#0f62fe";
    errorText.innerText = "Verifying Account...";
    errorText.style.display = 'block';
    
    showLoading("Authenticating...");

    fetch(googleScriptURL, {
        method: 'POST',
        body: JSON.stringify({ action: "login_and_sync", email: googleEmail, name: payload.name })
    }).then(res => res.json()).then(data => {
        hideLoading();
        if (data.status === "success") {
            currentUser = { email: googleEmail, name: data.userName, role: data.role };
            localStorage.setItem('audit_user_session', JSON.stringify(currentUser));
            syncMastersToLocal(data.masters);

            document.getElementById('login-screen').classList.remove('active-screen');
            document.getElementById('app-screen').classList.add('active-screen');
            document.getElementById('userBadge').innerText = `${currentUser.name}`;

            if (isAdminUser()) {
                document.getElementById('nav-masters').style.display = ''; 
                document.getElementById('adminUserFilter').style.display = ''; 
            }
            
            switchPage('attendance', document.getElementById('nav-attendance'));
            startAutoSync();
        } else {
            errorText.style.color = "red";
            errorText.innerText = "Unauthorized. Ask Admin for access.";
        }
    }).catch(err => {
        hideLoading();
        errorText.style.color = "red";
        errorText.innerText = "Network Error. Try again.";
    });
}

function syncMastersToLocal(cloudMasters) {
    const tx = db.transaction(["WorkMaster", "SocietyMaster", "BranchMaster", "UserMaster"], "readwrite");
    tx.objectStore("WorkMaster").clear(); cloudMasters.works.forEach(w => tx.objectStore("WorkMaster").put(w));
    tx.objectStore("SocietyMaster").clear(); cloudMasters.societies.forEach(s => tx.objectStore("SocietyMaster").put(s));
    
    tx.objectStore("BranchMaster").clear(); 
    cloudMasters.branches.forEach(b => { b.id = b.societyCode + "_" + b.name; tx.objectStore("BranchMaster").put(b); });
    
    tx.objectStore("UserMaster").clear();
    if(cloudMasters.users) cloudMasters.users.forEach(u => tx.objectStore("UserMaster").put(u));
    
    tx.oncomplete = () => loadAllMasters(); 
}

// ==========================================
// UI LOGIC & NAVIGATION
// ==========================================
function switchPage(pageId, navElement = null) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    document.getElementById('page-' + pageId).classList.add('active-page');
    
    if (!navElement) navElement = document.getElementById('nav-' + pageId);
    if (navElement) navElement.classList.add('active');
    
    localStorage.setItem('audit_active_tab', pageId);
    
    const titles = { 'attendance': 'Attendance', 'report': 'Audit Report', 'masters': 'Settings & Masters', 'bulk-approval': 'Review Details' };
    document.getElementById('headerTitle').innerText = titles[pageId];
    if(pageId === 'report') renderReport();
}

function loadAllMasters() {
    const currentSelections = {
        work: document.getElementById('workSelect').value,
        repWork: document.getElementById('reportWorkSelect').value,
        repUser: document.getElementById('reportUserSelect').value, 
        soc1: document.getElementById('society1').value,
        br1: document.getElementById('branch1').value,
        soc2: document.getElementById('society2').value,
        br2: document.getElementById('branch2').value,
        masterSoc: document.getElementById('masterSocSelect').value
    };

    db.transaction("WorkMaster", "readonly").objectStore("WorkMaster").getAll().onsuccess = (e) => {
        const wOpts = `<option value="">Select Work</option>` + e.target.result.map(w => `<option value="${w.name}">${w.name}</option>`).join('');
        document.getElementById('workSelect').innerHTML = wOpts;
        document.getElementById('reportWorkSelect').innerHTML = `<option value="ALL">-- All Audits --</option>` + e.target.result.map(w => `<option value="${w.name}">${w.name}</option>`).join('');
        if(currentSelections.work) document.getElementById('workSelect').value = currentSelections.work;
        if(currentSelections.repWork) document.getElementById('reportWorkSelect').value = currentSelections.repWork;
    };

    db.transaction("UserMaster", "readonly").objectStore("UserMaster").getAll().onsuccess = (e) => {
        const uOpts = `<option value="ALL">-- All Users --</option>` + e.target.result.map(u => `<option value="${u.name}">${u.name}</option>`).join('');
        document.getElementById('reportUserSelect').innerHTML = uOpts;
        if(currentSelections.repUser) document.getElementById('reportUserSelect').value = currentSelections.repUser;
    };

    db.transaction("SocietyMaster", "readonly").objectStore("SocietyMaster").getAll().onsuccess = (e) => {
        memSocieties = e.target.result;
        const sOpts = `<option value="">Select Society</option>` + memSocieties.map(s => `<option value="${s.code}">${s.name} (${s.code})</option>`).join('');
        document.getElementById('society1').innerHTML = sOpts;
        document.getElementById('society2').innerHTML = sOpts;
        document.getElementById('masterSocSelect').innerHTML = sOpts;

        if(currentSelections.soc1) { document.getElementById('society1').value = currentSelections.soc1; cascadeBranch('society1', 'branch1', currentSelections.br1); }
        if(currentSelections.soc2) { document.getElementById('society2').value = currentSelections.soc2; cascadeBranch('society2', 'branch2', currentSelections.br2); }
        if(currentSelections.masterSoc) document.getElementById('masterSocSelect').value = currentSelections.masterSoc;
    };
    db.transaction("BranchMaster", "readonly").objectStore("BranchMaster").getAll().onsuccess = (e) => memBranches = e.target.result;
}

const visitType = document.getElementById('visitType');
const visit2Group = document.getElementById('visit2Group');
visitType.addEventListener('change', (e) => {
    if (e.target.value === 'split') {
        visit2Group.style.display = 'block';
        document.getElementById('lblVisit1').innerText = "Morning Society & Branch";
        document.getElementById('society2').required = true; document.getElementById('branch2').required = true;
    } else {
        visit2Group.style.display = 'none';
        document.getElementById('lblVisit1').innerText = "Society & Branch";
        document.getElementById('society2').required = false; document.getElementById('branch2').required = false;
    }
});

function cascadeBranch(socSelectId, brSelectId, presetValue = null) {
    const code = document.getElementById(socSelectId).value;
    const brSelect = document.getElementById(brSelectId);
    brSelect.innerHTML = '<option value="">Select Branch</option>';
    memBranches.filter(b => b.societyCode === code).forEach(b => brSelect.add(new Option(b.name, b.name)));
    if (presetValue) brSelect.value = presetValue;
}
document.getElementById('society1').addEventListener('change', () => cascadeBranch('society1', 'branch1'));
document.getElementById('society2').addEventListener('change', () => cascadeBranch('society2', 'branch2'));

// ==========================================
// MASTER DATA MANAGEMENT
// ==========================================
function pushMasterToCloud(type, arrayData, successMsg, callback) {
    showLoading("Saving Master Data...");
    fetch(googleScriptURL, { method: 'POST', body: JSON.stringify({ action: "add_master", type: type, email: currentUser.email, data: arrayData }) })
    .then(r => r.json()).then(data => {
        hideLoading();
        if (data.status === "success") { showToast(successMsg); callback(); autoSync(); } else showToast("Error: " + data.message); 
    }).catch(() => { hideLoading(); showToast("Network Error"); });
}

function addUser() {
    const name = document.getElementById('newUserName').value.trim();
    const email = document.getElementById('newUserEmail').value.trim().toLowerCase();
    const role = document.getElementById('newUserRole').value;
    if (!name || !email) return showToast("Provide Name and Gmail.");
    pushMasterToCloud("Users", [email, name, role], `${name} Registered!`, () => { document.getElementById('newUserName').value = ""; document.getElementById('newUserEmail').value = ""; });
}
function addMaster(store, id1) {
    const val = document.getElementById(id1).value.trim();
    if (!val) return;
    pushMasterToCloud("Works", [val], "Work Added!", () => { document.getElementById(id1).value = ""; });
}
function addSociety() {
    const name = document.getElementById('newSocName').value.trim();
    const code = document.getElementById('newSocCode').value.trim().toUpperCase();
    if (!name || !code) return showToast("Provide Name and Code.");
    pushMasterToCloud("Societies", [name, code], "Society Added!", () => { document.getElementById('newSocName').value = ""; document.getElementById('newSocCode').value = ""; });
}
function addBranch() {
    const socCode = document.getElementById('masterSocSelect').value;
    const branchName = document.getElementById('newBranch').value.trim();
    if (!socCode || !branchName) return showToast("Select Society and provide Branch.");
    pushMasterToCloud("Branches", [socCode, branchName], "Branch Added!", () => { document.getElementById('newBranch').value = ""; });
                }
        // ==========================================
// SAVE ATTENDANCE LOCALLY & SYNC
// ==========================================
document.getElementById('auditForm').addEventListener('submit', (e) => {
    e.preventDefault();
    showLoading("Saving Record...");
    
    const dateVal = document.getElementById('auditDate').value;
    const work = document.getElementById('workSelect').value;
    const sType = visitType.value;
    const s1Code = document.getElementById('society1').value;
    const b1 = document.getElementById('branch1').value;
    let finalPlace = sType === "full" ? `${b1} (${s1Code})` : `${b1} (${s1Code}) / ${document.getElementById('branch2').value} (${document.getElementById('society2').value})`;

    const payload = {
        id: Date.now().toString() + Math.floor(Math.random() * 10000).toString(),
        workName: work, userName: currentUser.name, date: dateVal, place: finalPlace, manDay: 1, status: "Pending", isSynced: false
    };

    const tx = db.transaction("Attendance", "readwrite");
    tx.objectStore("Attendance").add(payload);
    
    tx.oncomplete = async () => {
        document.getElementById('auditForm').reset();
        visitType.dispatchEvent(new Event('change'));
        renderReport();
        if (navigator.onLine) { document.getElementById('loadingText').innerText = "Syncing with Cloud..."; await autoSync(); }
        hideLoading();
        showToast("Attendance Saved!");
    };
});

// ==========================================
// TWO-WAY BACKGROUND AUTO-SYNC ENGINE
// ==========================================
let syncInterval = null;
let isSyncing = false;

function startAutoSync() {
    if (syncInterval) clearInterval(syncInterval);
    autoSync(); 
    syncInterval = setInterval(autoSync, (typeof AutoSyncInterval !== 'undefined') ? AutoSyncInterval : 60000); 
}

async function autoSync() {
    if (isSyncing || !currentUser || !navigator.onLine) return;
    
    isSyncing = true;
    updateSyncUI("Syncing", "🟡 Syncing...");

    try {
        const pendingRecords = await new Promise((resolve) => {
            db.transaction("Attendance", "readonly").objectStore("Attendance").getAll().onsuccess = (e) => resolve(e.target.result.filter(r => !r.isSynced));
        });

        if (pendingRecords.length > 0) {
            const pushRes = await fetch(googleScriptURL, { method: 'POST', body: JSON.stringify({ action: "insert_attendance", email: currentUser.email, data: pendingRecords }) });
            const pushData = await pushRes.json();
            if (pushData.status === "success") {
                const pushTx = db.transaction("Attendance", "readwrite");
                pendingRecords.forEach(r => { r.isSynced = true; pushTx.objectStore("Attendance").put(r); });
            }
        }

        const fetchRes = await fetch(googleScriptURL, { method: 'POST', body: JSON.stringify({ action: "fetch_updates", email: currentUser.email }) });
        const fetchData = await fetchRes.json();

        if (fetchData.status === "success") {
            const tx = db.transaction("Attendance", "readwrite");
            const store = tx.objectStore("Attendance");
            
            store.getAll().onsuccess = (e) => {
                const localRecords = e.target.result;
                const cloudIds = new Set(fetchData.data.map(r => r.id.toString()));

                localRecords.forEach(r => {
                    if (r.isSynced && !cloudIds.has(r.id.toString())) store.delete(r.id);
                });

                fetchData.data.forEach(record => { record.isSynced = true; store.put(record); });
            };
            
            if (fetchData.masters) syncMastersToLocal(fetchData.masters);
            
            tx.oncomplete = () => {
                if(document.getElementById('page-report').classList.contains('active-page')) renderReport(); 
                
                if(document.getElementById('page-bulk-approval').classList.contains('active-page') && currentBulkUser && currentBulkWork) {
                    openBulkView(currentBulkUser, currentBulkWork);
                }
                
                updateSyncUI("Success", "🟢 Auto-Sync Active");
            };
        }
    } catch (error) { updateSyncUI("Error", "🔴 Sync Failed"); } 
    finally { isSyncing = false; }
}

function updateSyncUI(state, statusText) {
    const statusDiv = document.getElementById('syncStatusText');
    const timeDiv = document.getElementById('lastSyncTime');
    if (statusDiv) statusDiv.innerText = statusText;
    if (state === "Success") {
        if (timeDiv) timeDiv.innerText = "Last Synced: " + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
}

// ==========================================
// MAIN DASHBOARD (Report)
// ==========================================
function renderReport() {
    const selectedWork = document.getElementById('reportWorkSelect').value;
    const selectedUser = document.getElementById('reportUserSelect').value;

    db.transaction("Attendance", "readonly").objectStore("Attendance").getAll().onsuccess = (e) => {
        let records = e.target.result;
        
        if (!isAdminUser()) records = records.filter(r => r.userName === currentUser.name);
        else if (selectedUser !== "ALL") records = records.filter(r => r.userName === selectedUser);
        
        if (selectedWork !== "ALL") records = records.filter(r => r.workName === selectedWork);

        const approvedMD = records.filter(r => r.status === "Approved").reduce((sum, r) => sum + parseInt(r.manDay), 0);
        const pendingMD = records.filter(r => r.status === "Pending").reduce((sum, r) => sum + parseInt(r.manDay), 0);
        
        document.getElementById('approvedManDaysDisplay').innerText = approvedMD;
        document.getElementById('pendingManDaysDisplay').innerText = pendingMD;

        const tbody = document.querySelector('#reportTable tbody');
        if (records.length === 0) return tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; color:#888;">No records found.</td></tr>`;

        const groups = {};
        records.forEach(r => {
            const key = isAdminUser() ? `${r.userName}_${r.workName}` : `${r.workName}`;
            if(!groups[key]) {
                groups[key] = {
                    userName: r.userName, workName: r.workName,
                    records: [], totalMD: 0, pendingCount: 0, rejectedCount: 0
                };
            }
            groups[key].records.push(r);
            groups[key].totalMD += parseInt(r.manDay);
            if(r.status === 'Pending') groups[key].pendingCount++;
            else if(r.status === 'Rejected') groups[key].rejectedCount++;
        });

        const groupsArray = Object.values(groups);
        groupsArray.sort((a, b) => {
            const maxA = Math.max(...a.records.map(r => parseInt(getSortableDate(r.date)) || 0));
            const maxB = Math.max(...b.records.map(r => parseInt(getSortableDate(r.date)) || 0));
            return maxB - maxA;
        });

        let html = '';
        groupsArray.forEach(g => {
            let statusBadge = '';
            if(g.pendingCount > 0) statusBadge = `<span class="badge bg-pending">${g.pendingCount} Pending</span>`;
            else if(g.rejectedCount > 0) statusBadge = `<span class="badge bg-rejected">Has Rejected</span>`;
            else statusBadge = `<span class="badge bg-approved">All Approved</span>`;

            const title = isAdminUser() ? `<b style="color:var(--primary); font-size:14px;">${g.userName}</b><br><span style="font-size:12px; color:#555;">${g.workName}</span>` : `<b style="color:var(--primary); font-size:14px;">${g.workName}</b>`;

            html += `
            <tr style="cursor: pointer; background: #ffffff; border-bottom: 1px solid #eee; border-top: 4px solid var(--bg);" onclick="openBulkView('${g.userName}', '${g.workName}')">
                <td style="padding: 12px 10px;">${title}</td>
                <td style="font-size: 16px;"><b>${g.totalMD}</b></td>
                <td style="vertical-align: middle;">${statusBadge}</td>
                <td style="vertical-align: middle; text-align: center; color: #0f62fe; font-size: 14px; font-weight:bold;">➔</td>
            </tr>`;
        });

        tbody.innerHTML = html;
    };
}

// ==========================================
// BULK APPROVAL VIEW
// ==========================================
function closeBulkView() {
    currentBulkUser = null;
    currentBulkWork = null;
    switchPage('report', document.getElementById('nav-report'));
}

window.toggleCardSelection = function(cardId) {
    const card = document.getElementById('card-' + cardId);
    if(card && card.classList.contains('selectable')) {
        card.classList.toggle('selected');
        updateSelectionState();
    }
};

window.toggleSelectAllCards = function() {
    const masterCb = document.getElementById('masterCb');
    const isSelectingAll = !masterCb.classList.contains('selected');
    
    if(isSelectingAll) masterCb.classList.add('selected');
    else masterCb.classList.remove('selected');

    document.querySelectorAll('.bulk-card.selectable').forEach(card => {
        if(isSelectingAll) card.classList.add('selected');
        else card.classList.remove('selected');
    });
    
    updateSelectionState();
};

function updateSelectionState() {
    const selectedCount = document.querySelectorAll('.bulk-card.selected').length;
    const totalSelectable = document.querySelectorAll('.bulk-card.selectable').length;
    
    document.getElementById('bulkSelectionCount').innerText = selectedCount > 0 ? `${selectedCount} Selected` : '';
    document.getElementById('bulkActionButtons').style.display = selectedCount > 0 ? 'flex' : 'none';
    
    const masterCb = document.getElementById('masterCb');
    if (selectedCount === totalSelectable && totalSelectable > 0) masterCb.classList.add('selected');
    else masterCb.classList.remove('selected');
}

function openBulkView(userName, workName) {
    currentBulkUser = userName;
    currentBulkWork = workName;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
    document.getElementById('page-bulk-approval').classList.add('active-page');

    const titleHtml = isAdminUser() ? `<span style="color:var(--primary); font-weight: 800;">${userName}</span> <br><span style="font-size:14px; color:#666; font-weight: 600;">${workName}</span>` : `<span style="color:var(--primary); font-weight: 800;">${workName}</span>`;
    document.getElementById('bulkViewTitle').innerHTML = titleHtml;

    db.transaction("Attendance", "readonly").objectStore("Attendance").getAll().onsuccess = (e) => {
        let records = e.target.result.filter(r => r.userName === userName && r.workName === workName);

        records.sort((a, b) => {
            const dA = parseInt(getSortableDate(a.date)) || 0;
            const dB = parseInt(getSortableDate(b.date)) || 0;
            return dB - dA;
        });

        let pending = 0, approved = 0, rejected = 0, md = 0;
        records.forEach(r => {
            md += parseInt(r.manDay) || 0;
            if (r.status === 'Pending') pending++;
            else if (r.status === 'Approved') approved++;
            else rejected++;
        });

        document.getElementById('bulkSummaryInfo').innerHTML = `
            <div style="display:flex; gap:8px; font-size:11px; margin-top:8px;">
                <span class="badge" style="background:#eaedf1; color:#333;">Total MD: ${md}</span>
                ${pending > 0 ? `<span class="badge bg-pending">${pending} Pending</span>` : ''}
                ${approved > 0 ? `<span class="badge bg-approved">${approved} Approved</span>` : ''}
            </div>
        `;

        const hasPending = pending > 0;
        const showActions = isAdminUser() && hasPending;
        
        document.getElementById('bulkActionHeader').style.display = showActions ? 'flex' : 'none';
        document.getElementById('bulkActionButtons').style.display = 'none'; 
        document.getElementById('masterCb').classList.remove('selected');
        document.getElementById('bulkSelectionCount').innerText = '';

        const container = document.getElementById('bulkListContainer');
        
        container.innerHTML = records.map(r => {
            const badgeClass = r.status === 'Approved' ? 'bg-approved' : (r.status === 'Rejected' ? 'bg-rejected' : 'bg-pending');
            const syncIcon = r.isSynced ? `<span style="font-size:10px; opacity:0.6;" title="Synced">☁️</span>` : `<span style="font-size:10px;" title="Pending Sync">⏳</span>`;
            let displayDate = formatDisplayDate(r.date);

            const isSelectable = showActions && r.status === 'Pending';
            
            return `
            <div class="bulk-card ${isSelectable ? 'selectable' : ''}" id="card-${r.id}" ${isSelectable ? `onclick="toggleCardSelection('${r.id}')"` : ''}>
                ${isSelectable ? `<div class="custom-cb"></div>` : ``}
                <div style="flex-grow: 1;">
                    <div style="font-size: 14px; margin-bottom: 4px; display: flex; align-items: center;">
                        <b>${displayDate}</b> <span style="margin-left: 6px;">${syncIcon}</span>
                    </div>
                    <div style="font-size: 12px; color: #555; line-height: 1.4;">${r.place}</div>
                </div>
                <div style="margin-left: 10px;">
                    <span class="badge ${badgeClass}">${r.status}</span>
                </div>
            </div>`;
        }).join('');
    };
}

function submitBulkUpdate(newStatus) {
    if (!isAdminUser()) return showToast("Unauthorized action.");
    
    const selectedCards = document.querySelectorAll('.bulk-card.selected');
    if(selectedCards.length === 0) return showToast("Select at least one record.");

    showLoading(`Updating ${selectedCards.length} records...`);

    const updates = Array.from(selectedCards).map(card => {
        const id = card.id.replace('card-', '');
        return { id: id, status: newStatus };
    });

    fetch(googleScriptURL, {
        method: 'POST',
        body: JSON.stringify({ action: "update_attendance", email: currentUser.email, data: updates })
    })
    .then(res => res.json()).then(data => {
        if (data.status === "success") {
            const tx = db.transaction("Attendance", "readwrite");
            let completedCount = 0;

            updates.forEach(upd => {
                tx.objectStore("Attendance").get(upd.id).onsuccess = (e) => {
                    let rec = e.target.result;
                    rec.status = upd.status;
                    rec.isSynced = true;
                    
                    tx.objectStore("Attendance").put(rec);
                    completedCount++;
                    
                    if(completedCount === updates.length) {
                        hideLoading();
                        showToast(`Successfully marked ${updates.length} as ${newStatus}`);
                        openBulkView(currentBulkUser, currentBulkWork);
                        autoSync();
                    }
                };
            });
        } else {
            hideLoading();
            showToast("Failed to update cloud.");
        }
    }).catch(() => {
        hideLoading();
        showToast("Network Error");
    });
}

// ==========================================
// PWA SERVICE WORKER REGISTRATION
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.log('Service Worker registration failed: ', err);
        });
    });
    }
                                          

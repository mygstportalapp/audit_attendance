// ==========================================
// CONFIGURATION
// ==========================================
// ⚠️ PASTE YOUR GOOGLE APPS SCRIPT URL BELOW ⚠️
const googleScriptURL = "https://script.google.com/macros/s/AKfycbwBF8Ei3H-1ZjGZXnIVVgGACkTFIlF9jj3H6hucTZydXf-thPMB1JWXO3BQoRMQIuei/exec"; 

let currentUser = null;
let memSocieties = [];
let memBranches = [];

// Bumped to v6 for a perfectly clean install across devices
const dbName = "AuditAppDB_Final_v6"; 
let db;

const request = indexedDB.open(dbName, 1);
request.onupgradeneeded = (e) => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("Attendance")) db.createObjectStore("Attendance", { keyPath: "id" });
    if (!db.objectStoreNames.contains("WorkMaster")) db.createObjectStore("WorkMaster", { keyPath: "name" });
    if (!db.objectStoreNames.contains("SocietyMaster")) db.createObjectStore("SocietyMaster", { keyPath: "code" });
    if (!db.objectStoreNames.contains("BranchMaster")) db.createObjectStore("BranchMaster", { keyPath: ["name","societyCode"] });
    if (!db.objectStoreNames.contains("UserMaster")) db.createObjectStore("UserMaster", { keyPath: "email" }); 
};
request.onsuccess = (e) => { 
    db = e.target.result; 
    loadAllMasters(); 
    checkSession(); 
};

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

        if (currentUser.role === "Admin") {
            document.getElementById('nav-masters').style.display = ''; // Cleanly restores Flexbox visibility
            document.getElementById('colAction').style.display = 'table-cell'; 
            document.getElementById('adminUserFilter').style.display = ''; 
        }
        
        const savedTab = localStorage.getItem('audit_active_tab') || 'attendance';
        switchPage(savedTab, document.getElementById('nav-' + savedTab));

        startAutoSync();
    }
}

function logout() {
    if(confirm("Are you sure you want to log out?")) {
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

    fetch(googleScriptURL, {
        method: 'POST',
        body: JSON.stringify({ action: "login_and_sync", email: googleEmail, name: payload.name })
    }).then(res => res.json()).then(data => {
        if (data.status === "success") {
            currentUser = { email: googleEmail, name: data.userName, role: data.role };
            localStorage.setItem('audit_user_session', JSON.stringify(currentUser));
            syncMastersToLocal(data.masters);

            document.getElementById('login-screen').classList.remove('active-screen');
            document.getElementById('app-screen').classList.add('active-screen');
            document.getElementById('userBadge').innerText = `${currentUser.name}`;

            if (currentUser.role === "Admin") {
                document.getElementById('nav-masters').style.display = ''; 
                document.getElementById('colAction').style.display = 'table-cell'; 
                document.getElementById('adminUserFilter').style.display = ''; 
            }
            
            switchPage('attendance', document.getElementById('nav-attendance'));
            startAutoSync();
        } else {
            errorText.style.color = "red";
            errorText.innerText = "Unauthorized. Ask Admin for access.";
        }
    }).catch(err => {
        errorText.style.color = "red";
        errorText.innerText = "Network Error. Try again.";
    });
}

function syncMastersToLocal(cloudMasters) {
    const tx = db.transaction(["WorkMaster", "SocietyMaster", "BranchMaster", "UserMaster"], "readwrite");
    tx.objectStore("WorkMaster").clear(); cloudMasters.works.forEach(w => tx.objectStore("WorkMaster").put(w));
    tx.objectStore("SocietyMaster").clear(); cloudMasters.societies.forEach(s => tx.objectStore("SocietyMaster").put(s));
    tx.objectStore("BranchMaster").clear(); cloudMasters.branches.forEach(b => tx.objectStore("BranchMaster").put(b));
    if(cloudMasters.users) {
        tx.objectStore("UserMaster").clear(); cloudMasters.users.forEach(u => tx.objectStore("UserMaster").put(u));
    }
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
    
    const titles = { 'attendance': 'Attendance', 'report': 'Audit Report', 'masters': 'Settings & Masters' };
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
// MASTER DATA MANAGEMENT (Push to Cloud)
// ==========================================
function pushMasterToCloud(type, arrayData, successMsg, callback) {
    fetch(googleScriptURL, {
        method: 'POST',
        body: JSON.stringify({ action: "add_master", type: type, email: currentUser.email, data: arrayData })
    }).then(r => r.json()).then(data => {
        if (data.status === "success") { alert(successMsg); callback(); autoSync(); } 
        else { alert("Error: " + data.message); } 
    });
}

function addUser() {
    const name = document.getElementById('newUserName').value.trim();
    const email = document.getElementById('newUserEmail').value.trim().toLowerCase();
    const role = document.getElementById('newUserRole').value;
    if (!name || !email) return alert("Provide Name and Gmail.");
    pushMasterToCloud("Users", [email, name, role], `${name} Registered!`, () => {
        document.getElementById('newUserName').value = ""; document.getElementById('newUserEmail').value = "";
    });
}

function addMaster(store, id1) {
    const val = document.getElementById(id1).value.trim();
    if (!val) return;
    pushMasterToCloud("Works", [val], "Work Added!", () => { document.getElementById(id1).value = ""; });
}

function addSociety() {
    const name = document.getElementById('newSocName').value.trim();
    const code = document.getElementById('newSocCode').value.trim().toUpperCase();
    if (!name || !code) return alert("Provide Name and Code.");
    pushMasterToCloud("Societies", [name, code], "Society Added!", () => {
        document.getElementById('newSocName').value = ""; document.getElementById('newSocCode').value = "";
    });
}

function addBranch() {
    const socCode = document.getElementById('masterSocSelect').value;
    const branchName = document.getElementById('newBranch').value.trim();
    if (!socCode || !branchName) return alert("Select Society and provide Branch.");
    pushMasterToCloud("Branches", [socCode, branchName], "Branch Added!", () => { document.getElementById('newBranch').value = ""; });
}

// ==========================================
// SAVE ATTENDANCE LOCALLY
// ==========================================
document.getElementById('auditForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const dateVal = document.getElementById('auditDate').value;
    const work = document.getElementById('workSelect').value;
    const sType = visitType.value;
    const s1Code = document.getElementById('society1').value;
    const b1 = document.getElementById('branch1').value;

    let finalPlace = sType === "full" ? `${b1} (${s1Code})` : `${b1} (${s1Code}) / ${document.getElementById('branch2').value} (${document.getElementById('society2').value})`;

    const payload = {
        id: Date.now().toString() + Math.floor(Math.random() * 10000).toString(),
        workName: work, 
        userName: currentUser.name, 
        date: dateVal, 
        place: finalPlace, 
        manDay: 1, 
        status: "Pending", 
        isSynced: false
    };

    // FIXED: Properly attach oncomplete to the transaction variable
    const tx = db.transaction("Attendance", "readwrite");
    tx.objectStore("Attendance").add(payload);
    
    tx.oncomplete = () => {
        alert("Saved locally! Auto-syncing...");
        document.getElementById('auditForm').reset();
        visitType.dispatchEvent(new Event('change'));
        renderReport();
        autoSync(); 
    };
});

// ==========================================
// BACKGROUND AUTO-SYNC ENGINE
// ==========================================
let syncInterval = null;
let isSyncing = false;

function startAutoSync() {
    if (syncInterval) clearInterval(syncInterval);
    autoSync(); 
    syncInterval = setInterval(autoSync, 60000); 
}

async function autoSync() {
    if (isSyncing || !currentUser || !navigator.onLine) {
        if (!navigator.onLine) updateSyncUI("Offline", "🔴 Offline - Sync Paused");
        return;
    }
    
    isSyncing = true;
    updateSyncUI("Syncing", "🟡 Syncing...");

    try {
        const pendingRecords = await new Promise((resolve) => {
            db.transaction("Attendance", "readonly").objectStore("Attendance").getAll().onsuccess = (e) => {
                resolve(e.target.result.filter(r => !r.isSynced));
            };
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
            fetchData.data.forEach(record => { record.isSynced = true; tx.objectStore("Attendance").put(record); });
            
            if (fetchData.masters) syncMastersToLocal(fetchData.masters);
            
            tx.oncomplete = () => {
                renderReport(); 
                updateSyncUI("Success", "🟢 Auto-Sync Active");
            };
        }
    } catch (error) {
        updateSyncUI("Error", "🔴 Sync Failed - Retrying shortly");
    } finally {
        isSyncing = false; 
    }
}

function updateSyncUI(state, statusText) {
    const statusDiv = document.getElementById('syncStatusText');
    const timeDiv = document.getElementById('lastSyncTime');
    if (statusDiv) statusDiv.innerText = statusText;
    if (state === "Success") {
        const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        if (timeDiv) timeDiv.innerText = "Last Synced: " + timeStr;
        showToast("☁️ Synced at " + timeStr);
    }
}

function showToast(message) {
    const toast = document.getElementById('syncToast');
    if (!toast) return;
    toast.innerText = message; toast.style.display = "block";
    setTimeout(() => { toast.style.display = "none"; }, 3500);
}

function renderReport() {
    const selectedWork = document.getElementById('reportWorkSelect').value;
    const selectedUser = document.getElementById('reportUserSelect').value;

    db.transaction("Attendance", "readonly").objectStore("Attendance").getAll().onsuccess = (e) => {
        let records = e.target.result;
        
        // Filter by Role/User
        if (currentUser.role !== "Admin") {
            records = records.filter(r => r.userName === currentUser.name);
        } else {
            if (selectedUser !== "ALL") records = records.filter(r => r.userName === selectedUser);
        }

        // Filter by Work
        if (selectedWork !== "ALL") records = records.filter(r => r.workName === selectedWork);

        const approvedMD = records.filter(r => r.status === "Approved").reduce((sum, r) => sum + parseInt(r.manDay), 0);
        const pendingMD = records.filter(r => r.status === "Pending").reduce((sum, r) => sum + parseInt(r.manDay), 0);
        
        document.getElementById('approvedManDaysDisplay').innerText = approvedMD;
        document.getElementById('pendingManDaysDisplay').innerText = pendingMD;

        const tbody = document.querySelector('#reportTable tbody');
        if (records.length === 0) return tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 20px; color:#888;">No records found.</td></tr>`;

        records.sort((a, b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = records.map(r => {
            const badgeClass = r.status === 'Approved' ? 'bg-approved' : (r.status === 'Rejected' ? 'bg-rejected' : 'bg-pending');
            
            let actionHtml = (currentUser.role === 'Admin' && r.status === 'Pending') 
                ? `<td style="white-space: nowrap; vertical-align: middle;">
                     <button class="action-btn bg-approved" style="padding: 6px 10px;" onclick="updateCloudStatus('${r.id}', 'Approved')">✔</button>
                     <button class="action-btn bg-rejected" style="padding: 6px 10px; margin-right: 0;" onclick="updateCloudStatus('${r.id}', 'Rejected')">✖</button>
                   </td>` 
                : (currentUser.role === 'Admin' ? `<td style="vertical-align: middle;">-</td>` : '');

            const syncIcon = r.isSynced ? `<span style="font-size:10px; opacity:0.6;" title="Synced">☁️</span>` : `<span style="font-size:10px;" title="Pending Sync">⏳</span>`;
            const nameDisplay = currentUser.role === 'Admin' ? `<span style="font-size: 10px; background: #eee; padding: 2px 6px; border-radius: 4px; margin-left: 6px; color: #555;">${r.userName.split(' ')[0]}</span>` : '';

            // Cleanly format date without timezone overflow
            let displayDate = r.date;
            if (r.date) {
                const cleanDate = r.date.toString().split('T')[0]; 
                const dateParts = cleanDate.split('-');
                if (dateParts.length === 3) displayDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; 
            }

            return `<tr>
                <td>
                    <div style="font-size: 13px; margin-bottom: 4px; display: flex; align-items: center;">
                        <b>${displayDate}</b> <span style="margin-left: 4px;">${syncIcon}</span> ${nameDisplay}
                    </div>
                    <div style="font-size: 11.5px; color: #666; line-height: 1.4; max-width: 180px;">
                        ${r.place}
                    </div>
                </td>
                <td style="color: var(--primary); vertical-align: middle; font-size: 15px;"><b>${r.manDay}</b></td>
                <td style="vertical-align: middle;"><span class="badge ${badgeClass}">${r.status}</span></td>
                ${actionHtml}
            </tr>`;
        }).join('');
    };
}

function updateCloudStatus(recordId, newStatus) {
    if(!confirm(`Mark as ${newStatus}?`)) return;
    fetch(googleScriptURL, { method: 'POST', body: JSON.stringify({ action: "update_attendance", email: currentUser.email, data: { id: recordId, status: newStatus } }) })
    .then(res => res.json()).then(data => {
        if (data.status === "success") {
            const tx = db.transaction("Attendance", "readwrite");
            tx.objectStore("Attendance").get(recordId).onsuccess = (e) => {
                let rec = e.target.result; rec.status = newStatus; rec.isSynced = true;
                tx.objectStore("Attendance").put(rec);
                tx.oncomplete = () => { renderReport(); autoSync(); };
            };
        } else alert("Failed to update cloud.");
    });
}

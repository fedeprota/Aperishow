// ===== CONFIGURATION =====
const CONFIG = {
    passwordHash: '1700d645ebecea7618a6960832bb49b6e76f059d5bc8d6cd1517f08e2e35313d',
    webhookBase: 'https://marketinghfc.app.n8n.cloud/webhook',
    endpoints: {
        data: '/aperishow-data',
        approve: '/approve',
        reject: '/reject',
        manualPrompt: '/manual-prompt',
        regenerateMain: '/aperishow-main'
    },
    blockedPlaceholderId: '1JNkSv1-_auEFDbnIa5PUCStmxLEWL1GG',
    manualPromptPlaceholderId: '1CPb409gyx7QN93DQUasGXX1uNekTDI1D'
};

// ===== STATE =====
let allData = [];
let currentItem = null;
let pollInterval = null;
let regeneratingItems = {}; // uid -> original image URL
// Actions acknowledged by webhook but not yet reflected by the sheet.
// Prevents the polling loop from reverting the card's local status.
//   overrideStatus: { [uid]: { status: 'approved'|'regenerating', until: <epoch-ms> } }
let overrideStatus = {};
const OVERRIDE_TTL_MS = 180 * 1000; // 3 min — covers slow Gemini retries before sheet catches up

// ===== AUTH =====
function initAuth() {
    const loginBtn = document.getElementById('login-btn');
    const pwdInput = document.getElementById('password-input');
    const loginError = document.getElementById('login-error');

    async function tryLogin() {
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwdInput.value)))).map(b => b.toString(16).padStart(2, '0')).join('');
        if (hash === CONFIG.passwordHash) {
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('app').classList.remove('hidden');
            loadData();
        } else {
            loginError.classList.remove('hidden');
            pwdInput.value = '';
            pwdInput.focus();
        }
    }

    loginBtn.addEventListener('click', tryLogin);
    pwdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') tryLogin();
    });
}

// ===== OVERRIDE HELPERS =====
function setOverride(uid, status) {
    if (!uid) return;
    overrideStatus[uid] = { status, until: Date.now() + OVERRIDE_TTL_MS };
}
function applyOverrides(list) {
    const now = Date.now();
    // prune expired
    for (const k of Object.keys(overrideStatus)) {
        if (overrideStatus[k].until < now) delete overrideStatus[k];
    }
    for (const item of list) {
        const uid = String(item['Unique ID'] || '');
        const ov = overrideStatus[uid];
        if (!ov) continue;
        // If the server has moved past the override (e.g. sheet now says approved), drop it
        if (ov.status === 'approved' && item.Status === 'approved') {
            delete overrideStatus[uid];
            continue;
        }
        item.Status = ov.status;
    }
    return list;
}

// ===== DATA LOADING =====
async function loadData() {
    const btn = document.getElementById('refresh-btn');
    btn.disabled = true;
    btn.innerHTML = '&#x23F3; Caricamento...';
    btn.classList.add('loading');
    try {
        const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.data + '?_t=' + Date.now(), {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (!res.ok) throw new Error('Errore caricamento dati');
        allData = applyOverrides(await res.json());
        renderAll();
        // Auto-poll if any cards are waiting for image generation
        if (allData.some(d => ['regenerating', 'generating', 'approving'].includes(d.Status) || (d.Status === 'pending_review' && !d['FaceSwap Image URL']))) {
            startPolling();
        }
    } catch (err) {
        console.error('Errore:', err);
        document.getElementById('pending-grid').innerHTML =
            '<div class="empty-state">Errore nel caricamento dati. Verifica che il workflow WF2 sia attivo su n8n.</div>';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '&#x1F504; Refresh';
        btn.classList.remove('loading');
    }
}

// ===== RENDERING =====
function renderAll() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();

    const filtered = allData.filter(item => {
        if (!searchTerm) return true;
        const name = (item.Name || '').toLowerCase();
        return name.includes(searchTerm);
    });

    const toGenerate = filtered.filter(item => item.Status === 'needs_generation');
    const pending = filtered.filter(item => ['pending_review', 'regenerating', 'generating', 'blocked', 'needs_manual_prompt'].includes(item.Status));
    const approved = filtered.filter(item => ['approved', 'approving'].includes(item.Status));

    renderToGenerate(toGenerate);
    renderPending(pending);
    renderApproved(approved);

    document.getElementById('togenerate-count').textContent = toGenerate.length;
    document.getElementById('pending-count').textContent = pending.length;
    document.getElementById('approved-count').textContent = approved.length;
}

function renderToGenerate(items) {
    const grid = document.getElementById('togenerate-grid');
    if (!grid) return;
    if (items.length === 0) {
        grid.innerHTML = '<div class="empty-state">Nessuna richiesta da generare</div>';
        return;
    }
    grid.innerHTML = [...items].reverse().map(item => `
        <div class="card card-togenerate" data-uid="${item['Unique ID'] || ''}">
            <div class="card-togenerate-body">
                <div class="card-togenerate-name">${item.Name || 'N/A'}</div>
                <div class="card-togenerate-dream">"${item['How far will you go?'] || '(prompt vuoto)'}"</div>
                <div class="card-togenerate-cta">&#x1F528; Clicca per generare</div>
            </div>
        </div>
    `).join('');
    grid.querySelectorAll('.card').forEach(card => {
        card.addEventListener('click', () => {
            const uid = card.dataset.uid;
            const item = allData.find(d => d['Unique ID'] === uid);
            if (item) openGenerateModal(item);
        });
    });
}

function renderPending(items) {
    const grid = document.getElementById('pending-grid');

    if (items.length === 0) {
        grid.innerHTML = '<div class="empty-state">Nessuna immagine da approvare</div>';
        return;
    }

    grid.innerHTML = [...items].reverse().map(item => {
        const isRegenerating = item.Status === 'regenerating';
        const isGenerating = !item['FaceSwap Image URL'] && item.Status !== 'blocked';
        const isLocked = isRegenerating || isGenerating;
        return `
        <div class="card ${isLocked ? 'card-regenerating' : ''}" data-uid="${item['Unique ID'] || ''}">
            ${item['FaceSwap Image URL'] ? `
                <img class="card-img" src="${item['FaceSwap Image URL']}"
                     alt="${item.Name || 'Immagine'}"
                     onerror="this.outerHTML='<div class=\\'card-img-placeholder\\'><div class=\\'spinner\\'></div><span>Generazione in corso...</span></div>'">
            ` : `
                <div class="card-img-placeholder">
                    <div class="spinner"></div>
                    <span>Generazione in corso...</span>
                </div>
            `}
            ${isRegenerating ? '<div class="regenerating-overlay"><div class="spinner"></div><span>Rigenerazione...</span></div>' : ''}
            <div class="card-body">
                <div class="card-name">${item.Name || 'N/A'}</div>
                <div class="card-dream">"${truncate(item['How far will you go?'] || '', 40)}"</div>
                ${item['Review Feedback'] ? '<div class="card-revision-badge">Rivista</div>' : ''}
            </div>
        </div>
    `}).join('');

    grid.querySelectorAll('.card:not(.card-regenerating)').forEach(card => {
        card.addEventListener('click', () => {
            const uid = card.dataset.uid;
            const item = allData.find(d => d['Unique ID'] === uid);
            if (item) openModal(item);
        });
    });
}

function renderApproved(items) {
    const list = document.getElementById('approved-list');

    if (items.length === 0) {
        list.innerHTML = '<div class="empty-state">Nessuna immagine approvata</div>';
        return;
    }

    list.innerHTML = [...items].reverse().map(item => `
        <div class="approved-row" data-uid="${item['Unique ID'] || ''}" style="cursor:pointer;">
            <span class="status-icon">&#10003;</span>
            <span class="row-name">${item.Name || 'N/A'}</span>
            <span class="row-dream">"${truncate(item['How far will you go?'] || '', 60)}"</span>
            <span class="row-time">${formatDateTime(item['Added Time'])}</span>
        </div>
    `).join('');

    list.querySelectorAll('.approved-row').forEach(row => {
        row.addEventListener('click', () => {
            const uid = row.dataset.uid;
            const item = allData.find(d => String(d['Unique ID']) === String(uid));
            if (item) openModal(item);
        });
    });
}

// ===== MODAL =====
function isBlocked(item) {
    const url = item['FaceSwap Image URL'] || '';
    return url.includes(CONFIG.blockedPlaceholderId);
}

function isNeedsManualPrompt(item) {
    return item.Status === 'needs_manual_prompt';
}

function openGenerateModal(item) {
    currentItem = item;
    const modal = document.getElementById('modal');

    // Hide every non-generate UI element
    document.getElementById('modal-img').style.display = 'none';
    document.getElementById('toggle-before-after').style.display = 'none';
    document.getElementById('modal-feedback-history').classList.add('hidden');
    document.getElementById('modal-email-content').classList.add('hidden');
    document.getElementById('manual-prompt-section').classList.add('hidden');
    document.querySelector('.modal-actions').style.display = 'none';
    document.getElementById('btn-rerun-modal').style.display = 'none';

    document.getElementById('modal-name').textContent = item.Name || 'N/A';
    document.getElementById('modal-email').textContent = item.Email || '';
    document.getElementById('modal-dream').style.display = 'none';

    // Show generate section
    const genSection = document.getElementById('generate-section');
    genSection.classList.remove('hidden');
    const dreamInput = document.getElementById('generate-dream-input');
    dreamInput.value = item['How far will you go?'] || '';

    document.getElementById('modal-loading').classList.add('hidden');
    modal.classList.remove('hidden');
}

async function handleGenerate() {
    if (!currentItem) return;
    const dream = document.getElementById('generate-dream-input').value.trim();
    if (!dream) {
        alert('Scrivi un prompt prima di generare.');
        return;
    }
    const uid = String(currentItem['Unique ID'] || '');
    const rowNumber = getRowNumber(currentItem);
    regeneratingItems[uid] = '';
    setOverride(uid, 'regenerating');
    currentItem.Status = 'regenerating';
    closeModal();
    renderAll();
    startPolling();

    try {
        const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.regenerateMain, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                changeType: 'INSERT_ROW',
                row_number: rowNumber,
                dream,
                source: 'dashboard-generate'
            })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (err) {
        console.error('Errore generazione:', err);
        delete regeneratingItems[uid];
        delete overrideStatus[uid];
        alert('Errore durante la generazione. Riprova.');
    }
}

function openModal(item) {
    // Route to the correct modal based on card status
    if (item.Status === 'needs_generation') {
        return openGenerateModal(item);
    }

    currentItem = item;
    const modal = document.getElementById('modal');

    // Reset generate section visibility (in case we came from a generate modal)
    document.getElementById('generate-section').classList.add('hidden');
    document.getElementById('modal-img').style.display = '';
    document.getElementById('modal-dream').style.display = '';
    document.getElementById('btn-rerun-modal').style.display = '';
    const approveBtn = document.getElementById('btn-approve');
    const blocked = isBlocked(item);

    const modalImg = document.getElementById('modal-img');
    const toggleBtn = document.getElementById('toggle-before-after');
    const faceSwapUrl = item['FaceSwap Image URL'] || '';
    const selfieUrl = item['Selfie URL'] || '';
    modalImg.src = faceSwapUrl;
    toggleBtn.classList.remove('selfie-active');
    toggleBtn.querySelector('.toggle-label-left').classList.remove('active');
    toggleBtn.querySelector('.toggle-label-right').classList.add('active');
    if (selfieUrl && faceSwapUrl) {
        toggleBtn.style.display = '';
        toggleBtn.onclick = () => {
            const isSelfie = toggleBtn.classList.toggle('selfie-active');
            modalImg.src = isSelfie ? selfieUrl : faceSwapUrl;
            toggleBtn.querySelector('.toggle-label-left').classList.toggle('active', isSelfie);
            toggleBtn.querySelector('.toggle-label-right').classList.toggle('active', !isSelfie);
        };
    } else {
        toggleBtn.style.display = 'none';
    }
    document.getElementById('modal-name').textContent = item.Name || 'N/A';
    document.getElementById('modal-email').textContent = item.Email || '';
    document.getElementById('modal-dream').textContent = item['How far will you go?'] || '';
    const feedbackInput = document.getElementById('modal-feedback');
    feedbackInput.value = '';
    feedbackInput.removeEventListener('input', updateButtonStates);
    feedbackInput.addEventListener('input', updateButtonStates);
    document.getElementById('modal-loading').classList.add('hidden');

    // Feedback history
    const feedbackHistory = document.getElementById('modal-feedback-history');
    const prevFeedback = item['Review Feedback'] || '';
    if (prevFeedback) {
        const entries = prevFeedback.split('\n').filter(e => e.trim());
        feedbackHistory.innerHTML = '<h4>Cronologia revisioni</h4>' +
            entries.map(e => '<div class="feedback-entry">' + e + '</div>').join('');
        feedbackHistory.classList.remove('hidden');
    } else {
        feedbackHistory.innerHTML = '';
        feedbackHistory.classList.add('hidden');
    }

    // Email content for approved cards
    const emailSection = document.getElementById('modal-email-content');
    const emailRaw = item['Email Content'] || '';
    if (emailRaw && item.Status === 'approved') {
        try {
            const e = JSON.parse(emailRaw);
            emailSection.innerHTML =
                '<h4>Email inviata</h4>' +
                '<div class="email-field"><span class="email-label">Ruolo:</span> ' + (e.futureRole || '') + '</div>' +
                '<div class="email-field"><span class="email-label">Status:</span> ' + (e.futureStatus || '') + '</div>' +
                '<div class="email-field"><span class="email-label">Skills:</span> ' + (e.skills || '') + '</div>' +
                '<div class="email-field"><span class="email-label">Citazione:</span> <em>' + (e.quote || '') + '</em></div>' +
                '<div class="email-field"><span class="email-label">Perché tu:</span> ' + (e.whyYou || '') + '</div>';
            emailSection.classList.remove('hidden');
        } catch(err) {
            emailSection.classList.add('hidden');
        }
    } else {
        emailSection.innerHTML = '';
        emailSection.classList.add('hidden');
    }

    const modalActions = document.querySelector('.modal-actions');
    const manualSection = document.getElementById('manual-prompt-section');
    const needsManual = isNeedsManualPrompt(item);

    if (item.Status === 'approved') {
        modalActions.style.display = 'none';
        manualSection.classList.add('hidden');
    } else if (needsManual) {
        modalActions.style.display = 'none';
        manualSection.classList.remove('hidden');
        document.getElementById('manual-prompt-input').value = '';
        const manualBtn = document.getElementById('btn-manual');
        manualBtn.disabled = true;
        manualBtn.classList.add('btn-disabled');
        document.getElementById('manual-prompt-input').addEventListener('input', () => {
            const hasText = document.getElementById('manual-prompt-input').value.trim().length > 0;
            manualBtn.disabled = !hasText;
            manualBtn.classList.toggle('btn-disabled', !hasText);
        });
    } else {
        manualSection.classList.add('hidden');
        modalActions.style.display = '';
        const rejectBtn = document.getElementById('btn-reject');
        if (blocked) {
            approveBtn.disabled = true;
            approveBtn.classList.add('btn-disabled');
            approveBtn.title = 'Contenuto bloccato - impossibile approvare';
            rejectBtn.disabled = true;
            rejectBtn.classList.add('btn-disabled');
            // Allow reject when feedback is written (to regenerate blocked content)
            feedbackInput.addEventListener('input', () => {
                const hasText = feedbackInput.value.trim().length > 0;
                rejectBtn.disabled = !hasText;
                rejectBtn.classList.toggle('btn-disabled', !hasText);
            });
        } else {
            approveBtn.disabled = false;
            approveBtn.classList.remove('btn-disabled');
            approveBtn.title = '';
            rejectBtn.disabled = true;
            rejectBtn.classList.add('btn-disabled');
        }
    }

    modal.classList.remove('hidden');
}

function updateButtonStates() {
    const approveBtn = document.getElementById('btn-approve');
    const rejectBtn = document.getElementById('btn-reject');
    const feedback = document.getElementById('modal-feedback').value.trim();
    if (currentItem && currentItem.Status !== 'approved' && !isBlocked(currentItem)) {
        if (feedback) {
            approveBtn.disabled = true;
            approveBtn.classList.add('btn-disabled');
            approveBtn.title = 'Svuota il feedback per approvare';
            rejectBtn.disabled = false;
            rejectBtn.classList.remove('btn-disabled');
        } else {
            approveBtn.disabled = false;
            approveBtn.classList.remove('btn-disabled');
            approveBtn.title = '';
            rejectBtn.disabled = true;
            rejectBtn.classList.add('btn-disabled');
        }
    }
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    currentItem = null;
}

// ===== ACTIONS =====
async function handleManualPrompt() {
    if (!currentItem) return;
    const prompt = document.getElementById('manual-prompt-input').value.trim();
    if (!prompt) {
        alert('Scrivi un prompt prima di generare.');
        return;
    }
    // Capture & commit UI state BEFORE the fetch so operator sees instant feedback
    // and the currentItem=null from closeModal prevents same-card double-click.
    const uid = String(currentItem['Unique ID'] || '');
    const rowNumber = getRowNumber(currentItem);
    const selfieUrl = currentItem['Selfie URL'] || '';
    const prevFaceSwap = currentItem['FaceSwap Image URL'] || '';
    regeneratingItems[uid] = prevFaceSwap;
    setOverride(uid, 'regenerating');
    currentItem.Status = 'regenerating';
    closeModal();
    renderAll();
    startPolling();
    try {
        const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.manualPrompt, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rowNumber, prompt, selfieUrl })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (err) {
        console.error('Errore prompt manuale:', err);
        // rollback
        delete regeneratingItems[uid];
        delete overrideStatus[uid];
        alert('Errore durante la generazione manuale. Riprova.');
    }
}

async function rerunMainPipeline(rowNumber, { silent = false } = {}) {
    const rn = Number(rowNumber);
    if (!rn || rn < 2) {
        alert('Numero riga non valido.');
        return false;
    }
    try {
        const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.regenerateMain, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ changeType: 'INSERT_ROW', row_number: rn, source: 'dashboard-rerun' })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (!silent) alert('Pipeline rilanciata per la riga ' + rn + '. Torna tra qualche secondo.');
        return true;
    } catch (err) {
        console.error('Errore re-run main pipeline:', err);
        alert('Errore rilancio pipeline. Riprova.');
        return false;
    }
}

async function handleRerunFromModal() {
    if (!currentItem) return;
    const rn = getRowNumber(currentItem);
    if (!confirm('Rilancio la main pipeline per la riga ' + rn + ' (' + (currentItem.Name || '') + ')?\n\nQuesto rigenera l\'immagine da zero usando il selfie originale.')) return;
    const uid = String(currentItem['Unique ID'] || '');
    regeneratingItems[uid] = currentItem['FaceSwap Image URL'] || '';
    setOverride(uid, 'regenerating');
    currentItem.Status = 'regenerating';
    closeModal();
    renderAll();
    startPolling();
    const ok = await rerunMainPipeline(rn, { silent: true });
    if (!ok) {
        delete regeneratingItems[uid];
        delete overrideStatus[uid];
    }
}

async function handleRerunFromHeader() {
    const input = prompt('Numero riga Google Sheet da rilanciare (es. 42):');
    if (!input) return;
    await rerunMainPipeline(input.trim());
    setTimeout(loadData, 3000);
}

async function handleApprove() {
    if (!currentItem) return;

    const feedback = document.getElementById('modal-feedback').value.trim();
    if (feedback) {
        alert('Hai scritto un feedback nel campo di testo. Se vuoi rifiutare, clicca "Rifiuta e rigenera". Svuota il campo feedback per approvare.');
        return;
    }

    // Optimistic update BEFORE the fetch. Closing the modal also sets
    // currentItem=null, so a rapid second click is a no-op. Parallel
    // clicks on different rows are unaffected (different currentItem).
    const uid = String(currentItem['Unique ID'] || '');
    const rowNumber = getRowNumber(currentItem);
    const prevStatus = currentItem.Status;
    setOverride(uid, 'approved');
    currentItem.Status = 'approved';
    closeModal();
    renderAll();

    try {
        const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.approve, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uniqueId: uid, rowNumber })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (err) {
        console.error('Errore approvazione:', err);
        // rollback
        delete overrideStatus[uid];
        const row = allData.find(d => String(d['Unique ID']) === uid);
        if (row) row.Status = prevStatus;
        renderAll();
        alert('Errore durante l\'approvazione. La card è tornata in "Da approvare".');
    }
}

async function handleReject() {
    if (!currentItem) return;

    const feedback = document.getElementById('modal-feedback').value.trim();
    if (!feedback) {
        alert('Scrivi un feedback prima di rifiutare. Il feedback serve a Gemini per migliorare l\'immagine rigenerata.');
        return;
    }

    const uid = String(currentItem['Unique ID'] || '');
    const rowNumber = getRowNumber(currentItem);
    const prevFaceSwap = currentItem['FaceSwap Image URL'] || '';
    regeneratingItems[uid] = prevFaceSwap;
    setOverride(uid, 'regenerating');
    currentItem.Status = 'regenerating';
    closeModal();
    renderAll();
    startPolling();

    try {
        const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.reject, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uniqueId: uid, rowNumber, feedback })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
    } catch (err) {
        console.error('Errore rifiuto:', err);
        delete regeneratingItems[uid];
        delete overrideStatus[uid];
        alert('Errore durante il rifiuto. Riprova.');
    }
}

// ===== AUTO-REFRESH POLLING =====
function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.data + '?_t=' + Date.now(), {
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
            });
            if (!res.ok) return;
            const freshData = await res.json();

            // Check regenerating items: done when image URL changed
            for (const uid of Object.keys(regeneratingItems)) {
                const oldUrl = regeneratingItems[uid];
                const fresh = freshData.find(d => String(d['Unique ID']) === String(uid));
                if (fresh) {
                    const newUrl = fresh['FaceSwap Image URL'] || '';
                    if (newUrl && newUrl !== oldUrl && fresh.Status !== 'regenerating') {
                        delete regeneratingItems[uid];
                    }
                }
            }

            // Keep local "regenerating" for items still waiting
            for (const item of freshData) {
                const uid = String(item['Unique ID']);
                if (uid in regeneratingItems) {
                    item.Status = 'regenerating';
                }
            }
            allData = applyOverrides(freshData);
            renderAll();

            // Stop polling if no in-flight work remains
            const hasRegenerating = Object.keys(regeneratingItems).length > 0;
            const hasOverride = Object.keys(overrideStatus).length > 0;
            const hasInFlightStatus = allData.some(d => ['regenerating', 'generating', 'approving'].includes(d.Status) || (d.Status === 'pending_review' && !d['FaceSwap Image URL']));
            if (!hasRegenerating && !hasOverride && !hasInFlightStatus) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
        } catch(e) {}
    }, 10000);
}

// ===== COLLAPSIBLE SECTIONS =====
function initCollapsible() {
    const targets = {
        togenerate: 'togenerate-grid',
        pending: 'pending-grid',
        approved: 'approved-list'
    };
    document.querySelectorAll('.section-header').forEach(header => {
        header.addEventListener('click', () => {
            const key = header.dataset.toggle;
            const el = document.getElementById(targets[key] || 'pending-grid');
            if (!el) return;
            header.classList.toggle('collapsed');
            el.style.display = header.classList.contains('collapsed') ? 'none' : '';
        });
    });
}

// ===== HELPERS =====
function truncate(str, len) {
    return str.length > len ? str.substring(0, len) + '...' : str;
}

function formatTime(timeStr) {
    if (!timeStr) return '';
    try {
        const date = new Date(timeStr);
        return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

function formatDateTime(timeStr) {
    if (!timeStr) return '';
    try {
        const date = new Date(timeStr);
        return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) + ' ' +
               date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

function getRowNumber(item) {
    if (item.row_number) return item.row_number;
    const idx = allData.indexOf(item);
    return idx >= 0 ? idx + 2 : 0;
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initCollapsible();

    // Search
    document.getElementById('search-input').addEventListener('input', renderAll);

    // Refresh
    document.getElementById('refresh-btn').addEventListener('click', loadData);

    // Modal events
    document.querySelector('.modal-backdrop').addEventListener('click', closeModal);
    document.querySelector('.modal-close').addEventListener('click', closeModal);
    document.getElementById('btn-approve').addEventListener('click', handleApprove);
    document.getElementById('btn-reject').addEventListener('click', handleReject);
    document.getElementById('btn-manual').addEventListener('click', handleManualPrompt);
    document.getElementById('btn-rerun-modal').addEventListener('click', handleRerunFromModal);
    document.getElementById('btn-rerun-header').addEventListener('click', handleRerunFromHeader);
    document.getElementById('btn-generate').addEventListener('click', handleGenerate);

    // ESC to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
});

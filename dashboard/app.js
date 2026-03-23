// ===== CONFIGURATION =====
const CONFIG = {
    passwordHash: '1700d645ebecea7618a6960832bb49b6e76f059d5bc8d6cd1517f08e2e35313d',
    webhookBase: 'https://federicoprota.app.n8n.cloud/webhook',
    endpoints: {
        data: '/aperishow-data',
        approve: '/approve',
        reject: '/reject'
    },
    blockedPlaceholderId: '1JNkSv1-_auEFDbnIa5PUCStmxLEWL1GG'
};

// ===== STATE =====
let allData = [];
let currentItem = null;
let pollInterval = null;
let regeneratingItems = {}; // uid -> original image URL

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

// ===== DATA LOADING =====
async function loadData() {
    const btn = document.getElementById('refresh-btn');
    btn.disabled = true;
    btn.innerHTML = '&#x23F3; Caricamento...';
    btn.classList.add('loading');
    try {
        const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.data);
        if (!res.ok) throw new Error('Errore caricamento dati');
        allData = await res.json();
        renderAll();
        // Auto-poll if any cards are waiting for image generation
        if (allData.some(d => (d.Status === 'pending_review' && !d['FaceSwap Image URL']) || d.Status === 'regenerating')) {
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

    const pending = filtered.filter(item => item.Status === 'pending_review' || item.Status === 'regenerating');
    const approved = filtered.filter(item => item.Status === 'approved');

    renderPending(pending);
    renderApproved(approved);

    document.getElementById('pending-count').textContent = pending.length;
    document.getElementById('approved-count').textContent = approved.length;
}

function renderPending(items) {
    const grid = document.getElementById('pending-grid');

    if (items.length === 0) {
        grid.innerHTML = '<div class="empty-state">Nessuna immagine da approvare</div>';
        return;
    }

    grid.innerHTML = items.map(item => {
        const isRegenerating = item.Status === 'regenerating';
        const isGenerating = !item['FaceSwap Image URL'];
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

    list.innerHTML = items.map(item => `
        <div class="approved-row" data-uid="${item['Unique ID'] || ''}" style="cursor:pointer;">
            <span class="status-icon">&#10003;</span>
            <span class="row-name">${item.Name || 'N/A'}</span>
            <span class="row-dream">"${truncate(item['How far will you go?'] || '', 60)}"</span>
            <span class="row-time">${formatTime(item['Added Time'])}</span>
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

function openModal(item) {
    currentItem = item;
    const modal = document.getElementById('modal');
    const approveBtn = document.getElementById('btn-approve');
    const blocked = isBlocked(item);

    document.getElementById('modal-img').src = item['FaceSwap Image URL'] || '';
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

    const modalActions = document.querySelector('.modal-actions');
    if (item.Status === 'approved') {
        modalActions.style.display = 'none';
    } else {
        modalActions.style.display = '';
        const rejectBtn = document.getElementById('btn-reject');
        if (blocked) {
            approveBtn.disabled = true;
            approveBtn.classList.add('btn-disabled');
            approveBtn.title = 'Contenuto bloccato - impossibile approvare';
            rejectBtn.disabled = true;
            rejectBtn.classList.add('btn-disabled');
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
async function handleApprove() {
    if (!currentItem) return;

    const feedback = document.getElementById('modal-feedback').value.trim();
    if (feedback) {
        alert('Hai scritto un feedback nel campo di testo. Se vuoi rifiutare, clicca "Rifiuta e rigenera". Svuota il campo feedback per approvare.');
        return;
    }

    const loading = document.getElementById('modal-loading');
    loading.classList.remove('hidden');

    try {
        const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.approve, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uniqueId: currentItem['Unique ID'],
                rowNumber: getRowNumber(currentItem)
            })
        });

        if (!res.ok) throw new Error('Errore approvazione');

        // Update local state
        currentItem.Status = 'approved';
        closeModal();
        renderAll();
    } catch (err) {
        console.error('Errore approvazione:', err);
        loading.classList.add('hidden');
        alert('Errore durante l\'approvazione. Riprova.');
    }
}

async function handleReject() {
    if (!currentItem) return;

    const feedback = document.getElementById('modal-feedback').value.trim();
    if (!feedback) {
        alert('Scrivi un feedback prima di rifiutare. Il feedback serve a Gemini per migliorare l\'immagine rigenerata.');
        return;
    }

    const loading = document.getElementById('modal-loading');
    loading.classList.remove('hidden');

    try {
        const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.reject, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uniqueId: currentItem['Unique ID'],
                rowNumber: getRowNumber(currentItem),
                feedback: feedback
            })
        });

        if (!res.ok) throw new Error('Errore rifiuto');

        // Update local state — will reappear as pending after regeneration
        const uid = currentItem['Unique ID'];
        regeneratingItems[uid] = currentItem['FaceSwap Image URL'] || '';
        currentItem.Status = 'regenerating';
        closeModal();
        renderAll();
        startPolling();
    } catch (err) {
        console.error('Errore rifiuto:', err);
        loading.classList.add('hidden');
        alert('Errore durante il rifiuto. Riprova.');
    }
}

// ===== AUTO-REFRESH POLLING =====
function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.data);
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
            allData = freshData;
            renderAll();

            // Stop polling if no regenerating AND no pending generation
            const hasRegenerating = Object.keys(regeneratingItems).length > 0;
            const hasPendingGeneration = allData.some(d => d.Status === 'pending_review' && !d['FaceSwap Image URL']);
            if (!hasRegenerating && !hasPendingGeneration) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
        } catch(e) {}
    }, 10000);
}

// ===== COLLAPSIBLE SECTIONS =====
function initCollapsible() {
    document.querySelectorAll('.section-header').forEach(header => {
        header.addEventListener('click', () => {
            const targetId = header.dataset.toggle;
            const content = targetId === 'pending'
                ? document.getElementById('pending-grid')
                : document.getElementById('approved-list');

            header.classList.toggle('collapsed');
            content.style.display = header.classList.contains('collapsed') ? 'none' : '';
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

    // ESC to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
});

// ===== CONFIGURATION =====
const CONFIG = {
    password: 'hfarm2026',
    webhookBase: 'https://federicoprota.app.n8n.cloud/webhook',
    endpoints: {
        data: '/dashboard-data',
        approve: '/approve',
        reject: '/reject'
    }
};

// ===== STATE =====
let allData = [];
let currentItem = null;

// ===== AUTH =====
function initAuth() {
    const loginBtn = document.getElementById('login-btn');
    const pwdInput = document.getElementById('password-input');
    const loginError = document.getElementById('login-error');

    function tryLogin() {
        if (pwdInput.value === CONFIG.password) {
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
    try {
        const res = await fetch(CONFIG.webhookBase + CONFIG.endpoints.data);
        if (!res.ok) throw new Error('Errore caricamento dati');
        allData = await res.json();
        renderAll();
    } catch (err) {
        console.error('Errore:', err);
        document.getElementById('pending-grid').innerHTML =
            '<div class="empty-state">Errore nel caricamento dati. Verifica che il workflow WF2 sia attivo su n8n.</div>';
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

    const pending = filtered.filter(item => item.Status === 'pending_review');
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

    grid.innerHTML = items.map(item => `
        <div class="card" data-uid="${item['Unique ID'] || ''}">
            <img class="card-img" src="${item['FaceSwap Image URL'] || ''}"
                 alt="${item.Name || 'Immagine'}"
                 onerror="this.style.background='#2a2a2a'; this.alt='Immagine non disponibile'">
            <div class="card-body">
                <div class="card-name">${item.Name || 'N/A'}</div>
                <div class="card-dream">"${truncate(item['How far will you go?'] || '', 40)}"</div>
            </div>
        </div>
    `).join('');

    grid.querySelectorAll('.card').forEach(card => {
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
        <div class="approved-row">
            <span class="status-icon">&#10003;</span>
            <span class="row-name">${item.Name || 'N/A'}</span>
            <span class="row-dream">"${truncate(item['How far will you go?'] || '', 60)}"</span>
            <span class="row-time">${formatTime(item['Added Time'])}</span>
        </div>
    `).join('');
}

// ===== MODAL =====
function openModal(item) {
    currentItem = item;
    const modal = document.getElementById('modal');

    document.getElementById('modal-img').src = item['FaceSwap Image URL'] || '';
    document.getElementById('modal-name').textContent = item.Name || 'N/A';
    document.getElementById('modal-email').textContent = item.Email || '';
    document.getElementById('modal-dream').textContent = item['How far will you go?'] || '';
    document.getElementById('modal-feedback').value = '';
    document.getElementById('modal-loading').classList.add('hidden');

    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    currentItem = null;
}

// ===== ACTIONS =====
async function handleApprove() {
    if (!currentItem) return;

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

    const feedback = document.getElementById('modal-feedback').value;
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
        currentItem.Status = 'regenerating';
        closeModal();
        renderAll();
    } catch (err) {
        console.error('Errore rifiuto:', err);
        loading.classList.add('hidden');
        alert('Errore durante il rifiuto. Riprova.');
    }
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
    const idx = allData.indexOf(item);
    return idx >= 0 ? idx + 2 : 0; // +2: header row + 0-indexed
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

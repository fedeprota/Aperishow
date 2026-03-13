# Piano: Progetto Aperishow - Workflow n8n + Dashboard (v2)

## Context
**Evento:** Aperishow - Stand H-Farm College "How far will you go?"
**Volume:** ~3000 visitatori | **Deadline:** entro 1 settimana
**Obiettivo:** Ragazzi compilano un form → AI genera immagine del futuro → face swap col selfie → revisione umana via dashboard → invio email

**Automazione esistente (H-Farm):** Il form scrive dati su Google Sheet e carica il selfie in una **cartella Drive unica condivisa** (non cartelle individuali).
**Nostro compito:** Workflow n8n di processing + dashboard di revisione.

**Nota:** I nodi AI nel workflow verranno creati con placeholder — le credenziali saranno configurate manualmente dall'utente su n8n.

## Risorse
- **n8n Cloud:** `https://federicoprota.app.n8n.cloud` (credenziali Google già configurate)
- **Google Sheet:** `1sf2oPMPeaCrDJrOdiVAtsUamw-iXoluHfidj101G_9I`
- **Cartella Drive selfie (unica):** `https://drive.google.com/drive/folders/1j8fEI088-yHFDya-MuM7vcrlUsgzeWj_`
- **Image generation:** Nano Banana (configurato dall'utente su n8n)
- **Face swap:** fal.ai o altro (configurato dall'utente su n8n)
- **Dashboard:** HTML/JS/CSS su GitHub Pages (repo `fedeprota/Aperishow`)

## Colonne Google Sheet
**Esistenti:**
| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| Added Time | IP Address | Name | Email | Image Upload | How far will you go? | Unique ID |

**Da aggiungere (H in poi):**
| H | I | J | K |
|---|---|---|---|
| Status | AI Image URL | FaceSwap Image URL | Review Feedback |

---

## Architettura — 4 Workflow n8n + Dashboard

### WF1: Main Pipeline (processing automatico)

```
[1] Google Sheets Trigger (Row Added)
 ↓
[2] Google Sheets — Read row data
    (Name, Email, Image Upload, How far will you go, Unique ID)
 ↓
[3] Nano Banana — Image generation (nodo AI, configurato dall'utente)
    Prompt: genera immagine coerente col campo "How far will you go"
    La faccia nella scena deve essere facilmente swappabile
    Es: "astronauta" → persona con tuta spaziale, viso frontale/semi-frontale
 ↓
[4] Google Drive — Upload immagine AI nella cartella condivisa
    (folder ID: 1j8fEI088-yHFDya-MuM7vcrlUsgzeWj_)
    Naming: "{UniqueID}_ai_generated.png"
 ↓
[5] Google Drive — Download selfie dalla cartella condivisa
    (usa il link/file ID dal campo "Image Upload")
 ↓
[6] HTTP Request → Face swap API (nodo placeholder, configurato dall'utente)
    Input: selfie (source face) + immagine AI (target body)
    Output: immagine con il viso del ragazzo nella scena futura
 ↓
[7] Google Drive — Upload immagine face-swapped nella cartella condivisa
    Naming: "{UniqueID}_faceswap.png"
 ↓
[8] Google Sheets — Aggiorna riga:
    Status="pending_review", AI Image URL, FaceSwap Image URL
 ↓
 FINE — il workflow si ferma qui. La revisione avviene dalla dashboard.
```

### WF2: Dashboard Data API

```
[1] Webhook Trigger (GET /webhook/dashboard-data)
 ↓
[2] Google Sheets — Leggi tutte le righe
 ↓
[3] Respond to Webhook — JSON con tutti i dati
```

### WF3: Approve (triggerato dalla dashboard)

```
[1] Webhook Trigger (POST /webhook/approve)
    Body: { uniqueId: "...", rowNumber: ... }
 ↓
[2] Google Drive — Download immagine face-swapped
    (usa FaceSwap Image URL dalla riga)
 ↓
[3] Gmail — Invia email al ragazzo con immagine allegata
 ↓
[4] Google Sheets — Aggiorna riga: Status="approved"
```

### WF4: Reject (triggerato dalla dashboard)

```
[1] Webhook Trigger (POST /webhook/reject)
    Body: { uniqueId: "...", rowNumber: ..., feedback: "..." }
 ↓
[2] Google Sheets — Aggiorna riga:
    Status="regenerating", Review Feedback=feedback
 ↓
[3] Google Drive — Download selfie dalla cartella condivisa
 ↓
[4] HTTP Request → Face swap API (rigenera con parametri diversi/feedback)
 ↓
[5] Google Drive — Upload nuova immagine face-swapped (sovrascrive la precedente)
    Naming: "{UniqueID}_faceswap.png"
 ↓
[6] Google Sheets — Aggiorna riga: Status="pending_review", nuova FaceSwap Image URL
 ↓
 FINE — la card riappare nella dashboard in "Da Approvare"
```

> **Rigenerazioni illimitate** — nessun limite al numero di rifiuti.

---

### Dashboard Review (GitHub Pages)

**Target:** solo desktop. Password semplice all'accesso.

```
┌──────────────────────────────────────────────────────────────┐
│  APERISHOW - Review Dashboard    [🔍 Cerca...]  [🔄 Refresh] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ▼ DA APPROVARE (12)                        [collapsabile]   │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                │
│  │[img]   │ │[img]   │ │[img]   │ │[img]   │                │
│  │Mario R.│ │Anna B. │ │Luca V. │ │Sara M. │    ← GRIGLIA   │
│  │"Astro..│ │"Veter..│ │"Chef"  │ │"Pilo.. │                │
│  │[Dettagli]│[Dettagli]│[Dettagli]│[Dettagli]               │
│  └────────┘ └────────┘ └────────┘ └────────┘                │
│  ┌────────┐ ┌────────┐                                      │
│  │[img]   │ │[img]   │                                      │
│  │Giulia P│ │Marco T.│                                      │
│  │"Dott.. │ │"Archi..│                                      │
│  └────────┘ └────────┘                                      │
│                                                              │
│  Card espansa (click su una card):                           │
│  ┌──────────────────────────────────────────┐                │
│  │ [immagine grande face-swap]              │                │
│  │ Nome: Mario Rossi                        │                │
│  │ Email: mario@mail.it                     │                │
│  │ "Vorrei diventare un astronauta"         │                │
│  │ Feedback: [________________________]     │                │
│  │ [✅ Approva]  [❌ Rifiuta e rigenera]     │                │
│  └──────────────────────────────────────────┘                │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  ▼ APPROVATI (45)                           [collapsabile]   │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ ✅ Anna Bianchi  │ "Veterinaria"  │ 14:32           │    │
│  │ ✅ Paolo Verdi   │ "Ingegnere"    │ 14:28           │ ← LISTA
│  │ ✅ Maria Neri    │ "Artista"      │ 14:15           │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

**Funzionalità:**
1. **Password semplice** — prompt JavaScript all'apertura. Password hardcoded. Se sbagliata, non mostra nulla.
2. **Barra di ricerca** — filtra card per nome in tempo reale (tra titolo e refresh)
3. **Sezioni collapsabili** — click su "DA APPROVARE" o "APPROVATI" per chiudere/aprire
4. **Griglia "Da Approvare"** — card con immagine, nome, aspirazione. Click → espande dettaglio con feedback + bottoni
5. **Lista "Approvati"** — righe compatte: nome, aspirazione, orario. Più compatto per dare spazio alla sezione sopra
6. **Approva** → `POST /webhook/approve` con uniqueId → WF3 invia email → card si sposta in lista Approvati
7. **Rifiuta** → `POST /webhook/reject` con uniqueId + feedback → WF4 rigenera → card resta in griglia Da Approvare
8. **Refresh** → ricarica dati dal webhook senza ricaricare la pagina

**File:**
- `dashboard/index.html` — struttura + password prompt
- `dashboard/style.css` — layout orizzontale, griglia top, lista bottom, collapsabili
- `dashboard/app.js` — auth, fetch, render, search, approve/reject

---

## Piano di Implementazione

| # | Step | Dettaglio |
|---|------|-----------|
| 1 | Documentazione | Aggiornare `CLAUDE.md` + `docs/aperishow.md` con knowledge completa |
| 2 | WF1: Main Pipeline | Nodi Google Sheets/Drive + placeholder AI. Deploy su n8n Cloud |
| 3 | WF2: Dashboard API | Webhook GET → Sheet read → JSON. Deploy su n8n Cloud |
| 4 | WF3: Approve | Webhook POST → Drive download → Gmail → Sheet update. Deploy |
| 5 | WF4: Reject | Webhook POST → Sheet update → rigenera face swap → upload. Deploy |
| 6 | Dashboard | HTML/JS/CSS: password, griglia, lista, search, collapsabili |
| 7 | GitHub Pages | Push + attivare Pages. URL: `fedeprota.github.io/Aperishow/dashboard/` |
| 8 | Test | Riga test → pipeline → dashboard → approve → email |

## Domande aperte rimanenti
1. **Template email:** come deve apparire l'email al ragazzo? Solo immagine? Testo branded H-Farm?
2. **Prompt AI:** raffinare il prompt per Nano Banana — immagine coerente + faccia swappabile
3. **Face swap service:** quale API/servizio per il face swap? (fal.ai? altro?)
4. **Password dashboard:** quale password volete usare?

## Verifica
1. Inserire riga test nel Google Sheet → WF1 si triggera → status diventa "pending_review"
2. Dashboard mostra card nella griglia "Da Approvare"
3. Cliccare Approva → WF3 si triggera → email arriva → card si sposta in lista "Approvati"
4. Cliccare Rifiuta con feedback → WF4 si triggera → immagine rigenerata → card torna in griglia
5. Barra di ricerca filtra per nome
6. Sezioni collapsabili funzionano
7. Password blocca accesso non autorizzato
